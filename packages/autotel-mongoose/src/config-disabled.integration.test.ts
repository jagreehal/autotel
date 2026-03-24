import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { instrumentMongoose } from './instrumentation';
import { ATTR_DB_QUERY_TEXT, ATTR_DB_OPERATION_NAME } from './constants';
import { canListenOnLoopback } from './test-support';

let mongod: MongoMemoryServer | undefined;
let exporter: InMemorySpanExporter;
let provider: NodeTracerProvider;

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
});

let User: mongoose.Model<any>;

const supportsLocalServer = await canListenOnLoopback();

beforeAll(async () => {
  exporter = new InMemorySpanExporter();
  // Use the same NodeTracerProvider pattern as the main integration test
  provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  provider.register();

  if (!supportsLocalServer) {
    return;
  }

  mongod = await MongoMemoryServer.create();
  instrumentMongoose(mongoose, { dbStatementSerializer: false });
  await mongoose.connect(mongod.getUri());
  User = mongoose.model('User', userSchema);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
  await provider.shutdown();
});

beforeEach(() => exporter.reset());

describe('dbStatementSerializer: false', () => {
  if (!supportsLocalServer) {
    it.skip('skips disabled-config mongoose integration tests when the environment cannot open local TCP ports', () => {});
    return;
  }

  it('does not set db.query.text on spans', async () => {
    await User.find({ name: 'Alice' }).exec();

    const spans = exporter.getFinishedSpans();
    const findSpan = spans.find(
      (s) => s.attributes[ATTR_DB_OPERATION_NAME] === 'find',
    );
    expect(findSpan).toBeDefined();
    expect(findSpan!.attributes[ATTR_DB_QUERY_TEXT]).toBeUndefined();
  });

  it('still creates spans with correct operation name', async () => {
    await User.findOne({ name: 'Bob' }).exec();

    const spans = exporter.getFinishedSpans();
    const span = spans.find(
      (s) => s.attributes[ATTR_DB_OPERATION_NAME] === 'findOne',
    );
    expect(span).toBeDefined();
    expect(span!.name).toBe('findOne users');
  });
});
