/**
 * The operations Mongoose 9.7+ announces on its own tracing channels
 * (`mongoose:query`, `mongoose:aggregate`, `mongoose:model:*`,
 * `mongoose:cursor:next`), checked against a real server: each gets a span
 * here, with the server and database of the connection it ran on.
 */
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { context, trace } from '@opentelemetry/api';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import { instrumentMongoose } from './instrumentation';
import {
  canListenOnLoopback,
  startMongo,
  type TestMongo,
} from './test-support';
import {
  ATTR_DB_NAMESPACE,
  ATTR_DB_OPERATION_NAME,
  ATTR_DB_QUERY_TEXT,
  ATTR_SERVER_ADDRESS,
  ATTR_SERVER_PORT,
} from './constants';

interface Item {
  name: string;
  n: number;
}

const itemSchema = new mongoose.Schema<Item>({ name: String, n: Number });

const exporter = new InMemorySpanExporter();
const provider = new TracerProvider({
  spanProcessors: [new SimpleSpanProcessor({ exporter })],
});
const supportsLocalServer = await canListenOnLoopback();

let primary: TestMongo | undefined;
let secondary: TestMongo | undefined;
let other: mongoose.Connection | undefined;
let Items: mongoose.Model<Item>;
let OtherItems: mongoose.Model<Item>;

beforeAll(async () => {
  trace.setGlobalTracerProvider(provider);
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
  if (!supportsLocalServer) return;

  primary = await startMongo('coverage');
  secondary = await startMongo('coverage_other');
  instrumentMongoose(mongoose);
  await mongoose.connect(primary.uri);
  Items = mongoose.model<Item>('Item', itemSchema);
  other = await mongoose.createConnection(secondary.uri).asPromise();
  OtherItems = other.model<Item>('Item', itemSchema);

  await Items.insertMany(
    Array.from({ length: 5 }, (_, n) => ({ name: `item-${n}`, n })),
  );
  await OtherItems.create({ name: 'elsewhere', n: 0 });
});

afterAll(async () => {
  await other?.close();
  await mongoose.disconnect();
  await primary?.stop();
  await secondary?.stop();
  await provider.shutdown();
});

beforeEach(() => exporter.reset());

const spansNamed = (name: string) =>
  exporter.getFinishedSpans().filter((s) => s.name === name);

describe.skipIf(!supportsLocalServer)('cursors', () => {
  it('end the find span once a query cursor is read to the end', async () => {
    const names: string[] = [];
    const cursor = Items.find({ n: { $gte: 0 } })
      .sort({ n: 1 })
      .cursor();
    for (let doc = await cursor.next(); doc; doc = await cursor.next()) {
      names.push(doc.name);
    }

    expect(names).toHaveLength(5);
    const [span] = spansNamed('find items');
    expect(span?.attributes[ATTR_DB_QUERY_TEXT]).toContain('$gte');
    expect(spansNamed('find items')).toHaveLength(1);
  });

  it('end it when the cursor is closed early', async () => {
    const cursor = Items.find().cursor();
    await cursor.next();
    await cursor.close();

    expect(spansNamed('find items')).toHaveLength(1);
  });

  it('cover for await and eachAsync, which read through a cursor', async () => {
    let seen = 0;
    for await (const _doc of Items.find()) seen += 1;
    await Items.find()
      .cursor()
      .eachAsync(() => {
        seen += 1;
      });

    expect(seen).toBe(10);
    expect(spansNamed('find items')).toHaveLength(2);
  });

  it('end it for a stream reader, which never calls next()', async () => {
    const cursor = Items.find().cursor();
    let seen = 0;
    cursor.on('data', () => (seen += 1));
    await new Promise((resolve) => cursor.once('end', resolve));

    expect(seen).toBe(5);
    await expect.poll(() => spansNamed('find items')).toHaveLength(1);
  });

  it('mark a stream reader failed when the stream errors', async () => {
    const cursor = Items.find({ $where: 'this is not javascript(' }).cursor();
    cursor.on('data', () => {});
    await new Promise((resolve) => cursor.once('error', resolve));

    await expect.poll(() => spansNamed('find items')[0]?.status.code).toBe(2);
  });

  it('end the aggregate span once an aggregation cursor is exhausted', async () => {
    const cursor = Items.aggregate([{ $match: { n: { $lt: 3 } } }]).cursor();
    let seen = 0;
    for await (const _doc of cursor) seen += 1;

    expect(seen).toBe(3);
    const [span] = spansNamed('aggregate items');
    expect(span?.attributes[ATTR_DB_QUERY_TEXT]).toContain('$match');
  });

  it('mark the span failed when the cursor errors', async () => {
    const cursor = Items.find({ $where: 'this is not javascript(' }).cursor();
    await expect(cursor.next()).rejects.toThrow();

    const [span] = spansNamed('find items');
    expect(span?.status.code).toBe(2);
  });
});

describe.skipIf(!supportsLocalServer)('operations', () => {
  it('trace replaceOne and distinct', async () => {
    await Items.replaceOne({ n: 4 }, { name: 'replaced', n: 4 });
    const distinct = await Items.distinct('n');

    expect(distinct).toHaveLength(5);
    expect(spansNamed('replaceOne items')[0]?.attributes).toMatchObject({
      [ATTR_DB_OPERATION_NAME]: 'replaceOne',
    });
    expect(spansNamed('distinct items')).toHaveLength(1);
  });
});

describe.skipIf(!supportsLocalServer)('connection.aggregate()', () => {
  const pipeline = [
    {
      $documents: [
        { sku: 'a', qty: 2 },
        { sku: 'b', qty: 3 },
      ],
    },
    { $match: { qty: { $gt: 2 } } },
  ];

  it('traces a database-level pipeline, with no model behind it', async () => {
    const rows = await mongoose.connection.aggregate(pipeline);

    expect(rows).toEqual([{ sku: 'b', qty: 3 }]);
    const [span] = spansNamed('mongoose.aggregate');
    expect(span?.attributes).toMatchObject({
      [ATTR_DB_OPERATION_NAME]: 'aggregate',
      [ATTR_DB_NAMESPACE]: new URL(primary!.uri).pathname.slice(1),
    });
    expect(span?.attributes[ATTR_DB_QUERY_TEXT]).toContain('$documents');
  });

  it('ends its span when read through a cursor, and marks a failure', async () => {
    let seen = 0;
    for await (const _row of mongoose.connection.aggregate(pipeline).cursor()) {
      seen += 1;
    }
    await expect(
      mongoose.connection.aggregate([
        { $documents: [{ qty: 1 }] },
        { $project: { ratio: { $divide: ['$qty', 0] } } },
      ]),
    ).rejects.toThrow();

    expect(seen).toBe(1);
    const [read, failed] = spansNamed('mongoose.aggregate');
    expect(read?.status.code).not.toBe(2);
    expect(failed?.status.code).toBe(2);
  });

  it('opens one span however many times mongoose is instrumented', async () => {
    instrumentMongoose(new mongoose.Mongoose());
    await mongoose.connection.aggregate(pipeline);

    expect(spansNamed('mongoose.aggregate')).toHaveLength(1);
  });
});

describe.skipIf(!supportsLocalServer)('server and database', () => {
  it('come from the connection each model uses, when config names none', async () => {
    await Items.findOne({ n: 1 });
    await OtherItems.findOne({ n: 0 });

    const [first, second] = spansNamed('findOne items');
    const { hostname, port, pathname } = new URL(primary!.uri);
    expect(first?.attributes).toMatchObject({
      [ATTR_SERVER_ADDRESS]: hostname,
      [ATTR_SERVER_PORT]: Number(port),
      [ATTR_DB_NAMESPACE]: pathname.slice(1),
    });
    expect(second?.attributes[ATTR_DB_NAMESPACE]).toBe(
      new URL(secondary!.uri).pathname.slice(1),
    );
  });
});
