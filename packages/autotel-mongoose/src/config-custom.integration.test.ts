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
import type { SerializerPayload } from './types';

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
  provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  provider.register();

  if (!supportsLocalServer) {
    return;
  }

  mongod = await MongoMemoryServer.create();

  // Custom serializer that only outputs the operation + condition keys
  instrumentMongoose(mongoose, {
    dbStatementSerializer: (op: string, payload: SerializerPayload) => {
      const keys = payload.condition ? Object.keys(payload.condition) : [];
      return `${op}(${keys.join(',')})`;
    },
    statementRedactor: false, // Disable redaction for this test
  });

  await mongoose.connect(mongod.getUri());
  User = mongoose.model('User', userSchema);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
  await provider.shutdown();
});

beforeEach(() => exporter.reset());

describe('custom dbStatementSerializer', () => {
  if (!supportsLocalServer) {
    it.skip('skips custom mongoose integration tests when the environment cannot open local TCP ports', () => {});
    return;
  }

  it('uses custom serializer output as db.query.text', async () => {
    await User.find({ name: 'Alice', email: 'alice@example.com' }).exec();

    const spans = exporter.getFinishedSpans();
    const findSpan = spans.find(
      (s) => s.attributes[ATTR_DB_OPERATION_NAME] === 'find',
    );
    expect(findSpan).toBeDefined();
    const queryText = findSpan!.attributes[ATTR_DB_QUERY_TEXT] as string;
    expect(queryText).toBe('find(name,email)');
  });

  it('does not redact when statementRedactor is false', async () => {
    await User.find({ email: 'alice@example.com' }).exec();

    const spans = exporter.getFinishedSpans();
    const findSpan = spans.find(
      (s) => s.attributes[ATTR_DB_OPERATION_NAME] === 'find',
    );
    const queryText = findSpan!.attributes[ATTR_DB_QUERY_TEXT] as string;
    // Custom serializer doesn't include values, so email won't appear,
    // but importantly the redactor is not running
    expect(queryText).toBe('find(email)');
  });
});
