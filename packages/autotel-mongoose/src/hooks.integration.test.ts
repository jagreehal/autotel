import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import type {
  CallbackWithoutResultAndOptionalError,
  PreSaveMiddlewareFunction,
} from 'mongoose';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { instrumentMongoose } from './instrumentation';
import type { InstrumentMongooseConfig } from './types';
import { canListenOnLoopback, startMongo } from './test-support';
import type { TestMongo } from './test-support';

let mongod: TestMongo | undefined;
let exporter: InMemorySpanExporter;
let provider: NodeTracerProvider;

const supportsLocalServer = await canListenOnLoopback();

// Use a separate mongoose instance to avoid polluting other test suites
const mongooseInstance = new mongoose.Mongoose();

beforeAll(async () => {
  exporter = new InMemorySpanExporter();
  provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  provider.register();

  if (!supportsLocalServer) {
    return;
  }

  mongod = await startMongo('hooks');
  const uri = mongod.uri;

  // Instrument with hooks enabled BEFORE connecting/defining models
  instrumentMongoose(mongooseInstance, { instrumentHooks: true });

  await mongooseInstance.connect(uri);
});

afterAll(async () => {
  await mongooseInstance.disconnect();
  await mongod?.stop();
  await provider.shutdown();
});

beforeEach(() => {
  exporter.reset();
});

describe('instrumentHooks: true with timestamps', () => {
  if (!supportsLocalServer) {
    it.skip('skips when the environment cannot open local TCP ports', () => {});
    return;
  }

  it('does not break mongoose internal timestampsPreSave hook (next callback)', async () => {
    // Schema with timestamps: true registers an internal pre('save') hook
    // that uses callback-style (next) — this is the hook that breaks
    const schema = new mongooseInstance.Schema(
      {
        title: { type: String, required: true },
      },
      { timestamps: true },
    );

    const TimestampModel = mongooseInstance.model('TimestampTest', schema);

    // This should NOT throw "TypeError: next is not a function"
    const doc = new TimestampModel({ title: 'test' });
    await doc.save();

    expect(doc.createdAt).toBeDefined();
    expect(doc.updatedAt).toBeDefined();
  });

  it('traces user-defined pre save hooks alongside timestamps', async () => {
    let hookCalled = false;

    const schema = new mongooseInstance.Schema(
      {
        name: { type: String, required: true },
      },
      { timestamps: true },
    );

    // User-defined async hook (promise-style)
    schema.pre('save', async function () {
      hookCalled = true;
    });

    const HookModel = mongooseInstance.model('HookTimestampTest', schema);

    const doc = new HookModel({ name: 'test' });
    await doc.save();

    expect(hookCalled).toBe(true);
    expect(doc.createdAt).toBeDefined();

    const spans = exporter.getFinishedSpans();
    const hookSpan = spans.find((s) => s.name.includes('pre.save'));
    expect(hookSpan).toBeDefined();
  });

  it('handles user-defined callback-style pre hooks correctly', async () => {
    let hookCalled = false;

    const schema = new mongooseInstance.Schema({
      value: { type: Number, required: true },
    });

    // Callback-style hook with explicit next parameter. Mongoose 9's public
    // types model only the promise form of pre('save') (PreSaveMiddlewareFunction
    // takes SaveOptions, not a `next` callback), but the runtime still supports
    // the legacy callback form this test pins — hence the cast at the boundary.
    const callbackPreSave = function (
      next: CallbackWithoutResultAndOptionalError,
    ) {
      hookCalled = true;
      next();
    };
    // SAFETY: mongoose overloads pre('save') by whether the handler declares a
    // `next` parameter; this one does, and the callback form is what the test
    // exercises. The overloads are not distinguishable without the assertion.
    schema.pre('save', callbackPreSave as unknown as PreSaveMiddlewareFunction);

    const CallbackModel = mongooseInstance.model('CallbackHookTest', schema);

    const doc = new CallbackModel({ value: 42 });
    await doc.save();

    expect(hookCalled).toBe(true);

    const spans = exporter.getFinishedSpans();
    const hookSpan = spans.find((s) => s.name.includes('pre.save'));
    expect(hookSpan).toBeDefined();
  });

  it('does not scramble positional args for post(query, (doc, next) => ...) hooks', async () => {
    // Mongoose invokes this shape without a real callback in the runtime
    // args (it awaits a returned promise instead) — the wrapper must still
    // place `doc` first and the synthetic callback last.
    let receivedDoc: any;
    let receivedNextType: string | undefined;

    const schema = new mongooseInstance.Schema({
      value: { type: Number, required: true },
    });

    schema.post('findOneAndUpdate', function (doc: any, next: any) {
      receivedDoc = doc;
      receivedNextType = typeof next;
      next();
    });

    const PostHookModel = mongooseInstance.model(
      'PostFindOneAndUpdateHookTest',
      schema,
    );

    const doc = await PostHookModel.create({ value: 1 });
    await PostHookModel.findOneAndUpdate(
      { _id: doc._id },
      { value: 2 },
      { new: true },
    );

    // If args were scrambled, `receivedDoc` would be a function (the
    // synthetic callback) and `receivedNextType` would be 'object'.
    expect(receivedDoc).not.toBeTypeOf('function');
    expect(receivedDoc?.value).toBe(2);
    expect(receivedNextType).toBe('function');
  });

  it('does not treat a single-arg post(init, (doc) => ...) hook as callback-style', async () => {
    // `init` is always synchronous and never supports a `next` callback, even
    // though `(doc) => {...}` has the same arity (1) as a callback-only hook
    // like `pre('validate', (next) => {...})`.
    let receivedDoc: any;

    const schema = new mongooseInstance.Schema({
      value: { type: Number, required: true },
    });

    schema.post('init', (doc: any) => {
      receivedDoc = doc;
    });

    const InitHookModel = mongooseInstance.model('PostInitHookTest', schema);

    const created = await InitHookModel.create({ value: 7 });
    await InitHookModel.findById(created._id);

    // If treated as callback-style, `receivedDoc` would be the synthetic
    // wrappedNext function instead of the real document.
    expect(receivedDoc).not.toBeTypeOf('function');
    expect(receivedDoc?.value).toBe(7);
  });
});

describe("Mongoose's own plugin hooks are not traced", () => {
  if (!supportsLocalServer) {
    it.skip('skips when the environment cannot open local TCP ports', () => {});
    return;
  }

  it('emits one span per document for a user post(init) hook, not two', async () => {
    // Compiling a model makes Mongoose register its own sharding-plugin hooks,
    // `shardingPluginPostInit` among them. Those are internals and must not be
    // traced: when they were, every document hydrated by a find carried a
    // second `post.init` span, so a query returning 200 documents shipped 400
    // hook spans and half of them described Mongoose rather than the app.
    const schema = new mongooseInstance.Schema({ value: Number });
    let handlerCalls = 0;
    schema.post('init', (_doc: unknown) => {
      handlerCalls += 1;
    });
    const Model = mongooseInstance.model('PostInitSpanVolume', schema);

    await Model.insertMany(
      Array.from({ length: 5 }, (_, index) => ({ value: index })),
    );
    exporter.reset();

    const found = await Model.find({});
    expect(found).toHaveLength(5);

    const initSpans = exporter
      .getFinishedSpans()
      .filter((span) => span.name.endsWith('post.init'));

    expect(handlerCalls).toBe(5);
    expect(initSpans).toHaveLength(5);
  });

  it("wraps only the application hook, leaving Mongoose's registered but untraced", async () => {
    const schema = new mongooseInstance.Schema({ value: Number });
    schema.post('init', (_doc: unknown) => {});
    mongooseInstance.model('PostInitRegistration', schema);

    // SAFETY: reaching into Kareem's registry is the only way to tell a hook
    // autotel wrapped from one it left alone. Mongoose registers its own
    // sharding hook here too, which is expected; what matters is that exactly
    // one entry carries autotel's wrapper marker.
    const registered =
      (
        schema as unknown as {
          s: { hooks: { _posts: Map<string, Array<{ fn?: unknown }>> } };
        }
      ).s.hooks._posts.get('init') ?? [];
    const wrapped = registered.filter((entry) =>
      Boolean(
        (entry.fn as { __autotelWrappedHook?: boolean } | undefined)
          ?.__autotelWrappedHook,
      ),
    );

    expect(registered.length).toBeGreaterThan(1);
    expect(wrapped).toHaveLength(1);
  });

  it('traces nothing when the schema declares no hooks of its own', async () => {
    const schema = new mongooseInstance.Schema({ value: Number });
    const Model = mongooseInstance.model('NoUserHooks', schema);

    exporter.reset();
    const doc = new Model({ value: 1 });
    await doc.save();
    await Model.findById(doc._id);

    const hookSpans = exporter
      .getFinishedSpans()
      .filter(
        (span) => span.name.includes('.pre.') || span.name.includes('.post.'),
      );

    expect(hookSpans.map((span) => span.name)).toEqual([]);
  });

  it('traces nothing for a timestamps schema with no hooks of its own', async () => {
    // `timestamps: true` makes Mongoose register `_setTimestampsOnUpdate` on
    // every update-shaped hook. Its leading underscore used to be what
    // excluded it, which also excluded application hooks named that way. It is
    // named explicitly now, so both can be right at once.
    const schema = new mongooseInstance.Schema(
      { value: Number },
      { timestamps: true },
    );
    const Model = mongooseInstance.model('TimestampsNoUserHooks', schema);

    const doc = new Model({ value: 1 });
    await doc.save();
    exporter.reset();
    await Model.updateOne({ _id: doc._id }, { value: 2 });
    await Model.findOneAndUpdate({ _id: doc._id }, { value: 3 });
    await Model.findById(doc._id);

    const hookSpans = exporter
      .getFinishedSpans()
      .filter(
        (span) => span.name.includes('.pre.') || span.name.includes('.post.'),
      );

    expect(hookSpans.map((span) => span.name)).toEqual([]);
  });

  it('traces application hooks whose names start with an underscore', async () => {
    const schema = new mongooseInstance.Schema({ value: Number });
    let handlerCalls = 0;
    schema.post('init', function _applicationInitHook() {
      handlerCalls += 1;
    });
    const Model = mongooseInstance.model('InternalLookingUserHook', schema);

    const created = await Model.create({ value: 1 });
    exporter.reset();
    await Model.findById(created._id);

    const initSpans = exporter
      .getFinishedSpans()
      .filter((span) => span.name.endsWith('post.init'));

    expect(handlerCalls).toBe(1);
    expect(initSpans).toHaveLength(1);
  });
});

describe('instrumentHooks selector', () => {
  if (!supportsLocalServer) {
    it.skip('skips when the environment cannot open local TCP ports', () => {});
    return;
  }

  /**
   * A selector narrows by hook name. Each case needs its own Mongoose
   * instance, because the hook patch is installed once per instance and reads
   * the config it was given.
   */
  async function tracedHookNames(
    instrumentHooks: InstrumentMongooseConfig['instrumentHooks'],
  ): Promise<Set<string>> {
    const instance = new mongoose.Mongoose();
    instrumentMongoose(instance, { instrumentHooks });
    await instance.connect(mongod!.uri);

    const schema = new instance.Schema({ value: Number });
    schema.post('init', (_doc: unknown) => {});
    schema.pre('save', async function () {});
    const Model = instance.model('SelectorCase', schema);

    exporter.reset();
    const doc = new Model({ value: 1 });
    await doc.save();
    await Model.findById(doc._id);
    await instance.disconnect();

    return new Set(
      exporter
        .getFinishedSpans()
        .map((span) => span.name)
        .filter((name) => name.includes('.pre.') || name.includes('.post.'))
        .map((name) => name.slice(name.lastIndexOf('.') + 1)),
    );
  }

  it('traces every hook when true', async () => {
    expect(await tracedHookNames(true)).toEqual(new Set(['init', 'save']));
  });

  it('traces nothing when false', async () => {
    expect(await tracedHookNames(false)).toEqual(new Set());
  });

  it('traces only the named hooks for an include list', async () => {
    expect(await tracedHookNames(['save'])).toEqual(new Set(['save']));
  });

  it('drops the named hooks for an exclude list', async () => {
    // The reason the selector exists: `init` fires per hydrated document,
    // where `save` fires once per operation.
    expect(await tracedHookNames({ exclude: ['init'] })).toEqual(
      new Set(['save']),
    );
  });

  it('treats an empty include list as no hooks', async () => {
    expect(await tracedHookNames({ include: [] })).toEqual(new Set());
  });
});

describe('array and RegExp hook registrations', () => {
  if (!supportsLocalServer) {
    it.skip('skips when the environment cannot open local TCP ports', () => {});
    return;
  }

  /** Span names for one `save`, from a schema registering an array of hooks. */
  async function arrayCase(
    instrumentHooks: InstrumentMongooseConfig['instrumentHooks'],
    modelName: string,
  ): Promise<{ names: string[]; calls: number }> {
    const instance = new mongoose.Mongoose();
    instrumentMongoose(instance, { instrumentHooks });
    await instance.connect(mongod!.uri);

    const schema = new instance.Schema({ value: Number });
    let calls = 0;
    schema.pre(['save', 'validate'], function () {
      calls += 1;
    });
    const Model = instance.model(modelName, schema);

    exporter.reset();
    await new Model({ value: 1 }).save();
    await instance.disconnect();

    return {
      names: exporter
        .getFinishedSpans()
        .map((span) => span.name)
        .filter((name) => name.includes('.pre.'))
        .map((name) => name.slice(name.lastIndexOf('.') + 1)),
      calls,
    };
  }

  /** Span names for a find and a findOne, from a `pre(/^find/)` registration. */
  async function regexCase(
    instrumentHooks: InstrumentMongooseConfig['instrumentHooks'],
    modelName: string,
  ): Promise<{ names: string[]; calls: number }> {
    const instance = new mongoose.Mongoose();
    instrumentMongoose(instance, { instrumentHooks });
    await instance.connect(mongod!.uri);

    const schema = new instance.Schema({ value: Number });
    let calls = 0;
    schema.pre(/^find/, function () {
      calls += 1;
    });
    const Model = instance.model(modelName, schema);
    await Model.create({ value: 1 });

    exporter.reset();
    await Model.find({});
    await Model.findOne({});
    await instance.disconnect();

    return {
      names: exporter
        .getFinishedSpans()
        .map((span) => span.name)
        .filter((name) => name.includes('.pre.'))
        .map((name) => name.slice(name.lastIndexOf('.') + 1)),
      calls,
    };
  }

  it('names one span per hook in an array, not one per registration', async () => {
    // Registered whole, the array reached the span name verbatim, so both
    // spans read `pre.save,validate` and neither said which hook ran.
    const { names, calls } = await arrayCase(true, 'ArrayHooksAll');
    expect(new Set(names)).toEqual(new Set(['save', 'validate']));
    expect(calls).toBe(2);
  });

  it('selects individual hooks out of an array registration', async () => {
    const included = await arrayCase(['save'], 'ArrayHooksInclude');
    const excluded = await arrayCase(
      { exclude: ['validate'] },
      'ArrayHooksExclude',
    );

    expect(included.names).toEqual(['save']);
    expect(excluded.names).toEqual(['save']);
  });

  it('names a RegExp hook after the operation that ran', async () => {
    // One `pre(/^find/)` covers find, findOne, findOneAndUpdate and more.
    // Naming them all `pre./^find/` said a hook ran and nothing else.
    const { names, calls } = await regexCase(true, 'RegexHooksAll');
    expect(new Set(names)).toEqual(new Set(['find', 'findOne']));
    expect(calls).toBe(2);
  });

  it('selects individual operations out of a RegExp registration', async () => {
    const included = await regexCase(['find'], 'RegexHooksInclude');
    const excluded = await regexCase(
      { exclude: ['findOne'] },
      'RegexHooksExclude',
    );

    expect(included.names).toEqual(['find']);
    expect(excluded.names).toEqual(['find']);
  });

  it('runs the handler whether or not the hook is traced', async () => {
    // Selection decides what is observed, never what the application does.
    const arrayOff = await arrayCase(false, 'ArrayHooksOff');
    const regexOff = await regexCase(false, 'RegexHooksOff');

    expect(arrayOff.calls).toBe(2);
    expect(regexOff.calls).toBe(2);
  });
});
