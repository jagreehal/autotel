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
import {
  ATTR_DB_QUERY_TEXT,
  ATTR_DB_OPERATION_NAME,
  ATTR_DB_SYSTEM_NAME,
  ATTR_DB_COLLECTION_NAME,
  DB_SYSTEM_NAME_VALUE_MONGODB,
} from './constants';

let mongod: MongoMemoryServer | undefined;
let exporter: InMemorySpanExporter;
let provider: NodeTracerProvider;

interface IUser {
  name: string;
  email: string;
  age: number;
}

const userSchema = new mongoose.Schema<IUser>({
  name: { type: String, required: true },
  email: { type: String, required: true },
  age: { type: Number, required: true },
});

let User: mongoose.Model<IUser>;

const supportsLocalServer = await canListenOnLoopback();

beforeAll(async () => {
  // Set up OTel
  exporter = new InMemorySpanExporter();
  provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  provider.register();

  if (!supportsLocalServer) {
    return;
  }

  // Start in-memory MongoDB
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();

  // Instrument BEFORE connecting
  instrumentMongoose(mongoose);

  await mongoose.connect(uri);
  User = mongoose.model<IUser>('User', userSchema);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
  await provider.shutdown();
});

beforeEach(() => {
  exporter.reset();
});

describe('instrumentMongoose integration', () => {
  if (!supportsLocalServer) {
    it.skip('skips mongoose integration tests when the environment cannot open local TCP ports', () => {});
    return;
  }

  it('captures db.query.text for find operations', async () => {
    await User.find({ name: 'Alice' }).exec();

    const spans = exporter.getFinishedSpans();
    const findSpan = spans.find(
      (s) => s.attributes[ATTR_DB_OPERATION_NAME] === 'find',
    );
    expect(findSpan).toBeDefined();
    expect(findSpan!.attributes[ATTR_DB_SYSTEM_NAME]).toBe(
      DB_SYSTEM_NAME_VALUE_MONGODB,
    );
    expect(findSpan!.attributes[ATTR_DB_COLLECTION_NAME]).toBe('users');

    const queryText = findSpan!.attributes[ATTR_DB_QUERY_TEXT] as string;
    expect(queryText).toBeDefined();
    expect(queryText).toContain('Alice');
  });

  it('redacts PII in db.query.text by default', async () => {
    await User.find({ email: 'alice@example.com' }).exec();

    const spans = exporter.getFinishedSpans();
    const findSpan = spans.find(
      (s) => s.attributes[ATTR_DB_OPERATION_NAME] === 'find',
    );
    const queryText = findSpan!.attributes[ATTR_DB_QUERY_TEXT] as string;
    expect(queryText).not.toContain('alice@example.com');
    expect(queryText).toContain('[REDACTED]');
  });

  it('captures db.query.text for save operations', async () => {
    const user = new User({ name: 'Bob', email: 'bob@test.com', age: 30 });
    await user.save();

    const spans = exporter.getFinishedSpans();
    const saveSpan = spans.find(
      (s) => s.attributes[ATTR_DB_OPERATION_NAME] === 'save',
    );
    expect(saveSpan).toBeDefined();
    const queryText = saveSpan!.attributes[ATTR_DB_QUERY_TEXT] as string;
    expect(queryText).toBeDefined();
    expect(queryText).toContain('Bob');
    // Email should be redacted
    expect(queryText).not.toContain('bob@test.com');
  });

  it('captures db.query.text for aggregate operations', async () => {
    await User.aggregate([
      { $match: { age: { $gte: 18 } } },
      { $group: { _id: '$name', count: { $sum: 1 } } },
    ]).exec();

    const spans = exporter.getFinishedSpans();
    const aggSpan = spans.find(
      (s) => s.attributes[ATTR_DB_OPERATION_NAME] === 'aggregate',
    );
    expect(aggSpan).toBeDefined();
    const queryText = aggSpan!.attributes[ATTR_DB_QUERY_TEXT] as string;
    expect(queryText).toContain('$match');
    expect(queryText).toContain('$group');
  });

  it('captures db.query.text for insertMany', async () => {
    await User.insertMany([
      { name: 'Charlie', email: 'c@test.com', age: 25 },
      { name: 'Diana', email: 'd@test.com', age: 28 },
    ]);

    const spans = exporter.getFinishedSpans();
    const insertSpan = spans.find(
      (s) => s.attributes[ATTR_DB_OPERATION_NAME] === 'insertMany',
    );
    expect(insertSpan).toBeDefined();
    const queryText = insertSpan!.attributes[ATTR_DB_QUERY_TEXT] as string;
    expect(queryText).toContain('Charlie');
    expect(queryText).toContain('Diana');
  });

  it('captures db.query.text for bulkWrite', async () => {
    await User.bulkWrite([
      {
        insertOne: {
          document: { name: 'Eve', email: 'eve@test.com', age: 22 },
        },
      },
      { updateOne: { filter: { name: 'Eve' }, update: { $set: { age: 23 } } } },
    ]);

    const spans = exporter.getFinishedSpans();
    const bulkSpan = spans.find(
      (s) => s.attributes[ATTR_DB_OPERATION_NAME] === 'bulkWrite',
    );
    expect(bulkSpan).toBeDefined();
    const queryText = bulkSpan!.attributes[ATTR_DB_QUERY_TEXT] as string;
    expect(queryText).toContain('insertOne');
    expect(queryText).toContain('updateOne');
    expect(queryText).toContain('Eve');
  });

  it('captures db.query.text for updateOne with updates payload', async () => {
    await User.updateOne({ name: 'Bob' }, { $set: { age: 31 } }).exec();

    const spans = exporter.getFinishedSpans();
    const updateSpan = spans.find(
      (s) => s.attributes[ATTR_DB_OPERATION_NAME] === 'updateOne',
    );
    expect(updateSpan).toBeDefined();
    const queryText = updateSpan!.attributes[ATTR_DB_QUERY_TEXT] as string;
    expect(queryText).toBeDefined();
    // Should contain both condition and update fields
    expect(queryText).toContain('Bob');
    expect(queryText).toContain('$set');
  });

  it('uses stable semantic convention span names', async () => {
    await User.findOne({ name: 'Alice' }).exec();

    const spans = exporter.getFinishedSpans();
    const span = spans.find(
      (s) => s.attributes[ATTR_DB_OPERATION_NAME] === 'findOne',
    );
    // Stable convention: "operation collection"
    expect(span!.name).toBe('findOne users');
  });
});
