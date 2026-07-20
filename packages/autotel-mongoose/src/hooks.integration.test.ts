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
    expect(typeof receivedDoc).not.toBe('function');
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
    expect(typeof receivedDoc).not.toBe('function');
    expect(receivedDoc?.value).toBe(7);
  });
});
