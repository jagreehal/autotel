import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { planFromExplain, serializeMongoCommand } from './index';

/**
 * Against a real server, with the real driver and the upstream instrumentation
 * this package's serializer plugs into:
 * `MONGO_TEST_URI=mongodb://127.0.0.1:27017 pnpm test:integration`.
 */
const uri = process.env.MONGO_TEST_URI;

describe.skipIf(!uri)('against MongoDB', () => {
  const exporter = new InMemorySpanExporter();
  const database = `autotel_mongodb_${Math.random().toString(36).slice(2, 10)}`;
  let client: import('mongodb').MongoClient;

  beforeAll(async () => {
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
    const instrumentation = new MongoDBInstrumentation({
      dbStatementSerializer: serializeMongoCommand,
      // A test has no request span to hang the queries under.
      requireParentSpan: false,
    });
    instrumentation.setTracerProvider(provider);
    instrumentation.enable();

    // Loaded after the instrumentation is enabled, which is when it can patch.
    // SAFETY: require() returns the mongodb module this file type-imports.
    const { MongoClient } = createRequire(import.meta.url)(
      'mongodb',
    ) as typeof import('mongodb');
    client = await new MongoClient(uri!).connect();
    const users = client.db(database).collection('users');
    await users.insertMany(
      Array.from({ length: 40 }, (_, n) => ({
        status: n % 2 ? 'a' : 'b',
        age: n,
      })),
    );
  });

  afterAll(async () => {
    await client?.db(database).dropDatabase();
    await client?.close();
  });

  it('gives upstream spans value-free text that is the same across values', async () => {
    const users = client.db(database).collection('users');
    exporter.reset();
    await users.findOne({ status: 'a', email: 'alice@example.com' });
    await users.findOne({ status: 'b', email: 'bob@example.com' });

    const texts = exporter
      .getFinishedSpans()
      .filter((span) => span.attributes['db.operation.name'] === 'find')
      .map((span) => span.attributes['db.query.text']);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toBe(texts[1]);
    expect(texts[0]).toContain('"find":"users"');
    expect(texts[0]).toContain('"filter":{"status":"?","email":"?"}');
    expect(texts[0]).not.toContain('lsid');
    expect(texts[0]).not.toContain('example.com');
  });

  it('reads a live explain: a collection scan, and the index that fixes it', async () => {
    const explain = await client
      .db(database)
      .collection('users')
      .find({ status: 'a', age: { $gte: 10 } })
      .sort({ age: -1 })
      .explain('executionStats');

    const plan = planFromExplain(explain);
    expect(plan?.fullScan).toBe(true);
    expect(plan?.nodes).toContain('COLLSCAN');
    expect(plan?.rowsExamined).toBe(40);
    expect(plan?.rowsReturned).toBe(15);
    expect(plan?.indexSuggestion).toBe(
      'db.users.createIndex({ status: 1, age: -1 })',
    );
  });

  it('sees the suggested index used once it exists', async () => {
    const users = client.db(database).collection('users');
    await users.createIndex({ status: 1, age: -1 });
    const plan = planFromExplain(
      await users
        .find({ status: 'a', age: { $gte: 10 } })
        .sort({ age: -1 })
        .explain('executionStats'),
    );
    expect(plan?.fullScan).toBe(false);
    expect(plan?.indexes).toEqual(['status_1_age_-1']);
    expect(plan?.rowsExamined).toBe(15);
    expect(plan?.indexSuggestion).toBeUndefined();
  });
});
