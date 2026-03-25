import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { instrumentMongoose } from './instrumentation';
import { canListenOnLoopback } from './test-support';

let mongod: MongoMemoryServer | undefined;
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

  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();

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

    // Callback-style hook with explicit next parameter
    schema.pre('save', function (next) {
      hookCalled = true;
      next();
    });

    const CallbackModel = mongooseInstance.model('CallbackHookTest', schema);

    const doc = new CallbackModel({ value: 42 });
    await doc.save();

    expect(hookCalled).toBe(true);

    const spans = exporter.getFinishedSpans();
    const hookSpan = spans.find((s) => s.name.includes('pre.save'));
    expect(hookSpan).toBeDefined();
  });
});
