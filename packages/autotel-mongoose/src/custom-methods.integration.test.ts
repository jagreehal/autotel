import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  NodeTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { instrumentMongoose } from './instrumentation';
import {
  ATTR_MONGOOSE_METHOD_TYPE,
  ATTR_MONGOOSE_METHOD_NAME,
  ATTR_MONGOOSE_METHOD_PARAMETERS,
  ATTR_MONGOOSE_METHOD_PARAMETER_COUNT,
} from './constants';
import type { InstrumentMongooseConfig } from './types';
import { canListenOnLoopback } from './test-support';

const supportsLocalServer = await canListenOnLoopback();

let mongod: MongoMemoryServer | undefined;
let exporter: InMemorySpanExporter;
let provider: NodeTracerProvider;
let uri: string;
let modelCounter = 0;

beforeAll(async () => {
  exporter = new InMemorySpanExporter();
  provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  provider.register();

  if (!supportsLocalServer) {
    return;
  }

  mongod = await MongoMemoryServer.create();
  uri = mongod.getUri();
});

afterAll(async () => {
  await mongod?.stop();
  await provider.shutdown();
});

beforeEach(() => {
  exporter.reset();
});

/**
 * Builds an isolated Mongoose instance + connection so each test can configure
 * `customMethods` independently. Defines a model with a static, an instance
 * method, and a query helper.
 */
async function setup(config?: InstrumentMongooseConfig) {
  const m = new mongoose.Mongoose();
  instrumentMongoose(m, config);
  await m.connect(uri);

  const schema = new m.Schema({
    name: { type: String },
    email: { type: String, required: true },
  });

  // Static: returns a Query (span finalizes on exec)
  schema.statics.findByEmail = function findByEmail(
    this: any,
    email: string,
  ): any {
    return this.findOne({ email });
  };

  // Static: async, returns a Promise
  schema.statics.countByDomain = async function countByDomain(
    this: any,
    domain: string,
  ): Promise<number> {
    return this.countDocuments({ email: new RegExp(`@${domain}$`) });
  };

  // Instance method: synchronous value
  schema.methods.describe = function describe(this: any): string {
    return `${this.name} <${this.email}>`;
  };

  // Query helper: chainable
  schema.query.byDomain = function byDomain(this: any, domain: string): any {
    return this.where({ email: new RegExp(`@${domain}$`) });
  };

  // Unique model name per call to avoid OverwriteModelError across tests
  const Model = m.model(`CM_${(modelCounter += 1)}`, schema) as any;

  return { m, Model };
}

const methodSpans = () =>
  exporter
    .getFinishedSpans()
    .filter((s) => s.attributes[ATTR_MONGOOSE_METHOD_NAME] !== undefined);

const spanByMethod = (name: string) =>
  methodSpans().find((s) => s.attributes[ATTR_MONGOOSE_METHOD_NAME] === name);

describe('custom method instrumentation', () => {
  if (!supportsLocalServer) {
    it.skip('skips when the environment cannot open local TCP ports', () => {});
    return;
  }

  it('wraps statics, instance methods, and query helpers by default', async () => {
    const { m, Model } = await setup();
    try {
      await Model.create({ name: 'Ada', email: 'ada@example.com' });
      exporter.reset();

      // Static returning a Query
      const found = await Model.findByEmail('ada@example.com');
      expect(found).not.toBeNull();
      expect(found.email).toBe('ada@example.com');

      // Instance method
      expect(found.describe()).toBe('Ada <ada@example.com>');

      // Async static
      const count = await Model.countByDomain('example.com');
      expect(count).toBe(1);

      // Query helper
      const list = await Model.find().byDomain('example.com');
      expect(list).toHaveLength(1);

      const staticSpan = spanByMethod('findByEmail');
      expect(staticSpan).toBeDefined();
      expect(staticSpan!.attributes[ATTR_MONGOOSE_METHOD_TYPE]).toBe('static');

      const methodSpan = spanByMethod('describe');
      expect(methodSpan).toBeDefined();
      expect(methodSpan!.attributes[ATTR_MONGOOSE_METHOD_TYPE]).toBe(
        'instance',
      );

      const countSpan = spanByMethod('countByDomain');
      expect(countSpan).toBeDefined();
      expect(countSpan!.attributes[ATTR_MONGOOSE_METHOD_TYPE]).toBe('static');

      const querySpan = spanByMethod('byDomain');
      expect(querySpan).toBeDefined();
      expect(querySpan!.attributes[ATTR_MONGOOSE_METHOD_TYPE]).toBe('query');
    } finally {
      await m.disconnect();
    }
  });

  it('captures (and redacts) parameters by default', async () => {
    const { m, Model } = await setup();
    try {
      await Model.findByEmail('ada@example.com');

      const span = spanByMethod('findByEmail');
      expect(span).toBeDefined();
      expect(span!.attributes[ATTR_MONGOOSE_METHOD_PARAMETER_COUNT]).toBe(1);

      const params = span!.attributes[
        ATTR_MONGOOSE_METHOD_PARAMETERS
      ] as string;
      expect(params).toBeDefined();
      // Default redactor masks email addresses
      expect(params).not.toContain('ada@example.com');
    } finally {
      await m.disconnect();
    }
  });

  it('does not break return values or `this` (no side effects)', async () => {
    const { m, Model } = await setup();
    try {
      const doc = await Model.create({ name: 'Grace', email: 'grace@x.io' });
      exporter.reset();

      // Instance method still bound to the right document
      expect(doc.describe()).toBe('Grace <grace@x.io>');

      // Query helper returns a chainable Query
      const q = Model.find().byDomain('x.io');
      expect(typeof q.exec).toBe('function');
      const results = await q;
      expect(results).toHaveLength(1);
    } finally {
      await m.disconnect();
    }
  });

  it('honors exclude (opt-out) for privacy/compliance', async () => {
    const { m, Model } = await setup({
      customMethods: { statics: { exclude: ['findByEmail'] } },
    });
    try {
      await Model.create({ name: 'Edsger', email: 'e@example.com' });
      exporter.reset();

      await Model.findByEmail('e@example.com');
      await Model.countByDomain('example.com');

      // Excluded static is not traced...
      expect(spanByMethod('findByEmail')).toBeUndefined();
      // ...but other statics still are.
      expect(spanByMethod('countByDomain')).toBeDefined();
    } finally {
      await m.disconnect();
    }
  });

  it('honors include (opt-in) — only named functions are traced', async () => {
    const { m, Model } = await setup({
      customMethods: {
        statics: ['countByDomain'],
        methods: false,
        query: false,
      },
    });
    try {
      const doc = await Model.create({ name: 'Linus', email: 'l@example.com' });
      exporter.reset();

      await Model.findByEmail('l@example.com');
      await Model.countByDomain('example.com');
      doc.describe();
      await Model.find().byDomain('example.com');

      expect(spanByMethod('countByDomain')).toBeDefined();
      expect(spanByMethod('findByEmail')).toBeUndefined();
      expect(spanByMethod('describe')).toBeUndefined();
      expect(spanByMethod('byDomain')).toBeUndefined();
    } finally {
      await m.disconnect();
    }
  });

  it('can disable parameter capture while still tracing', async () => {
    const { m, Model } = await setup({
      customMethods: { captureParameters: false },
    });
    try {
      await Model.findByEmail('ada@example.com');

      const span = spanByMethod('findByEmail');
      expect(span).toBeDefined();
      expect(span!.attributes[ATTR_MONGOOSE_METHOD_PARAMETERS]).toBeUndefined();
      expect(
        span!.attributes[ATTR_MONGOOSE_METHOD_PARAMETER_COUNT],
      ).toBeUndefined();
    } finally {
      await m.disconnect();
    }
  });

  it('wraps nothing when customMethods is false', async () => {
    const { m, Model } = await setup({ customMethods: false });
    try {
      const doc = await Model.create({ name: 'Ken', email: 'k@example.com' });
      exporter.reset();

      await Model.findByEmail('k@example.com');
      doc.describe();
      await Model.find().byDomain('example.com');

      expect(methodSpans()).toHaveLength(0);
    } finally {
      await m.disconnect();
    }
  });

  // Regression: Mongoose-internal functions (e.g. the initializeTimestamps
  // method injected by `timestamps: true`) must not be wrapped/traced.
  it('skips Mongoose-internal injected functions', async () => {
    const m = new mongoose.Mongoose();
    instrumentMongoose(m);
    await m.connect(uri);

    const schema = new m.Schema(
      { email: { type: String } },
      { timestamps: true },
    );
    const Model = m.model(`TS_${(modelCounter += 1)}`, schema) as any;

    try {
      const doc = await Model.create({ email: 'ts@example.com' });
      await Model.findOneAndUpdate(
        { _id: doc._id },
        { email: 'ts2@example.com' },
      );

      expect(spanByMethod('initializeTimestamps')).toBeUndefined();
    } finally {
      await m.disconnect();
    }
  });

  // Regression: a schema object reused across two instances with different
  // configs must respect each instance's config (not bind to the first one).
  it('resolves config per instance for a shared schema object', async () => {
    const a = new mongoose.Mongoose();
    const b = new mongoose.Mongoose();
    // Instance A traces everything; instance B opts findByEmail out.
    instrumentMongoose(a);
    instrumentMongoose(b, {
      customMethods: { statics: { exclude: ['findByEmail'] } },
    });
    await a.connect(uri);
    await b.connect(uri);

    // One shared schema object compiled on BOTH instances.
    const shared = new mongoose.Schema({ email: { type: String } });
    shared.statics.findByEmail = function findByEmail(
      this: any,
      email: string,
    ): any {
      return this.findOne({ email });
    };

    const name = `Shared_${(modelCounter += 1)}`;
    const ModelA = a.model(name, shared) as any;
    const ModelB = b.model(name, shared) as any;

    try {
      await ModelA.create({ email: 'shared@example.com' });
      exporter.reset();

      await ModelA.findByEmail('shared@example.com');
      await ModelB.findByEmail('shared@example.com');

      const spans = methodSpans().filter(
        (s) => s.attributes[ATTR_MONGOOSE_METHOD_NAME] === 'findByEmail',
      );
      // Exactly one span — from instance A. Instance B passed through.
      expect(spans).toHaveLength(1);
    } finally {
      await a.disconnect();
      await b.disconnect();
    }
  });
});
