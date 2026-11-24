import { trace } from '@opentelemetry/api';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb';
import {
  InMemorySpanExporter,
  TracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace';
import { planFromExplain, traceMongoCommands } from './index';

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
    const provider = new TracerProvider({
      spanProcessors: [new SimpleSpanProcessor({ exporter })],
    });
    trace.setGlobalTracerProvider(provider);
    const instrumentation = traceMongoCommands(
      new MongoDBInstrumentation({
        // A test has no request span to hang the queries under.
        requireParentSpan: false,
      }),
    );
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

  it('keeps written documents out of the text of every native write', async () => {
    const users = client.db(database).collection('writes');
    const wide = Object.fromEntries(
      Array.from({ length: 100 }, (_, n) => [`field${n}`, n]),
    );
    const secret = { secretField: 1 };
    exporter.reset();
    await users.insertOne({ ...secret });
    // Sent without an `_id`, and its first field reads like a command.
    await users.insertOne(
      { find: 'secretField', ...secret },
      { forceServerObjectId: true },
    );
    await users.insertMany([{ ...secret }, { ...secret }]);
    await users.replaceOne({ n: 1 }, { ...secret });
    await users.findOneAndReplace({ n: 1 }, { ...secret });
    await users.bulkWrite([
      { insertOne: { document: { ...secret } } },
      { replaceOne: { filter: { n: 1 }, replacement: { ...secret } } },
      { updateOne: { filter: { n: 1 }, update: { $set: { kept: 1 } } } },
    ]);
    const { version } = await client.db('admin').command({ buildInfo: 1 });
    const bulk = Number.parseInt(String(version), 10) >= 8;
    if (bulk) {
      const namespace = `${database}.writes`;
      await client.bulkWrite([
        { name: 'insertOne', namespace, document: { ...secret } },
        {
          name: 'replaceOne',
          namespace,
          filter: { n: 1 },
          replacement: { ...secret },
        },
        {
          name: 'updateOne',
          namespace,
          filter: { n: 1 },
          update: { $set: { kept: 1 } },
        },
      ]);
    }
    if (bulk) {
      const last = exporter.getFinishedSpans().at(-1);
      expect(last?.attributes['db.query.text']).toContain(
        `{"insert":"${database}.writes","document":"?"}`,
      );
    }
    await users.updateOne({ n: 1 }, { $set: wide });

    const written = exporter
      .getFinishedSpans()
      .map((span) => String(span.attributes['db.query.text']));
    expect(written.length).toBeGreaterThanOrEqual(bulk ? 10 : 9);
    expect(written.filter((text) => text.includes('secretField'))).toEqual([]);
    expect(Math.max(...written.map((text) => text.length))).toBe(513);
    expect(written.filter((text) => text.includes('"kept"'))).toHaveLength(
      bulk ? 2 : 1,
    );
  });

  it('names the collection of every command, sent through $cmd or not', async () => {
    const db = client.db(database);
    const texts = async (name: string) => {
      const users = db.collection(name);
      exporter.reset();
      await users.find({ n: 1 }).toArray();
      await users.aggregate([{ $match: { n: 1 } }]).toArray();
      await users.distinct('n');
      await users.estimatedDocumentCount();
      await users.findOneAndUpdate({ n: 1 }, { $set: { n: 2 } });
      await users.updateOne({ n: 1 }, { $set: { n: 2 } });
      await users.find({ n: 1 }).explain();
      await db.command({ find: name, filter: { n: 1 } });
      await db.command({ count: name, query: { n: 1 } });
      await db.command({ insert: name, documents: [{ secretField: 1 }] });
      await db.command({
        findAndModify: name,
        query: { n: 1 },
        update: { secretField: 1 },
      });
      const spans = exporter.getFinishedSpans();
      for (const span of spans) {
        expect(span.attributes['db.collection.name']).toBe(name);
        expect(span.name.endsWith(` ${name}`)).toBe(true);
      }
      return spans.map((span) => String(span.attributes['db.query.text']));
    };
    const orders = await texts('orders');
    const carts = await texts('carts');
    expect(orders).toHaveLength(11);
    for (const [index, text] of orders.entries()) {
      expect(text).toContain('"orders"');
      expect(carts[index]).toBe(text.replaceAll('"orders"', '"carts"'));
      expect(text).not.toContain('secretField');
    }
  });

  it('sends a command whose values describe themselves', async () => {
    const value = { toBSON: () => ({ kind: 'converted' }), self: {} };
    value.self = value;
    const users = client.db(database).collection('converted');
    await users.insertOne({ value });
    expect(await users.findOne({ value })).toMatchObject({
      value: { kind: 'converted' },
    });
  });

  it('sends the document it would without tracing', async () => {
    let reads = 0;
    const documents = Object.defineProperty([{}], 0, {
      get: () => ({ n: ++reads }),
      enumerable: true,
    });
    const db = client.db(database);
    await db.command({ insert: 'getters', documents });
    expect(await db.collection('getters').findOne()).toMatchObject({ n: 1 });
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
