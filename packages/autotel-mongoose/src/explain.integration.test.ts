import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';
import mongoose from 'mongoose';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-node';
import { instrumentMongoose } from './instrumentation';
import { ATTR_DB_OPERATION_NAME } from './constants';
import { canListenOnLoopback, startMongo } from './test-support';
import type { TestMongo } from './test-support';

let mongod: TestMongo | undefined;
let exporter: InMemorySpanExporter;
let provider: NodeTracerProvider;

const orderSchema = new mongoose.Schema({
  status: String,
  total: Number,
  createdAt: Date,
});
// Counts how often application middleware runs, to prove explain adds none.
const hookRuns = { find: 0, aggregate: 0 };
orderSchema.pre('find', function () {
  hookRuns.find += 1;
});
orderSchema.pre('aggregate', function () {
  hookRuns.aggregate += 1;
});

const orderModel = () => mongoose.model('Order', orderSchema);
let Order: ReturnType<typeof orderModel>;

const supportsLocalServer = await canListenOnLoopback();

beforeAll(async () => {
  exporter = new InMemorySpanExporter();
  provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  provider.register();
  if (!supportsLocalServer) return;

  mongod = await startMongo('explain');
  instrumentMongoose(mongoose, { explain: 'analyze' });
  await mongoose.connect(mongod.uri);
  Order = orderModel();
  // The schema declares no indexes; build nothing behind the test's back.
  await Order.createCollection();
  await Order.insertMany(
    Array.from({ length: 60 }, (_, n) => ({
      status: n % 3 === 0 ? 'open' : 'closed',
      total: n,
      createdAt: new Date(2026, 0, 1 + n),
    })),
  );
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
  await provider.shutdown();
});

beforeEach(() => exporter.reset());

/** The span for `operation`, once its plan has arrived and it has ended. */
async function spanFor(operation: string): Promise<ReadableSpan> {
  return vi.waitFor(() => {
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.attributes[ATTR_DB_OPERATION_NAME] === operation);
    if (!span) throw new Error(`no ${operation} span yet`);
    return span;
  });
}

describe('explain', () => {
  if (!supportsLocalServer) {
    it.skip('skips when the environment cannot open local TCP ports', () => {});
    return;
  }

  it('puts the plan and the index that fixes it on a find', async () => {
    const found = await Order.find({ status: 'open', total: { $gte: 10 } })
      .sort({ createdAt: -1 })
      .exec();
    expect(found).toHaveLength(16);

    const span = await spanFor('find');
    expect(span.attributes).toMatchObject({
      'db.plan.full_scan': true,
      'db.plan.rows_examined': 60,
      'db.plan.rows_returned': 16,
      'db.plan.index_suggestion':
        'db.orders.createIndex({ status: 1, createdAt: -1, total: 1 })',
    });
    expect(span.attributes['db.plan.node']).toBe('SORT');
  });

  it('follows the suggestion: the same query then uses the index', async () => {
    await Order.collection.createIndex({ status: 1, createdAt: -1, total: 1 });
    onTestFinished(async () => {
      await Order.collection.dropIndexes();
    });
    await Order.find({ status: 'open', total: { $gte: 10 } })
      .sort({ createdAt: -1 })
      .exec();

    const span = await spanFor('find');
    expect(span.attributes).toMatchObject({
      'db.plan.full_scan': false,
      'db.plan.indexes': 'status_1_createdAt_-1_total_1',
      'db.plan.rows_returned': 16,
    });
    expect(span.attributes['db.plan.index_suggestion']).toBeUndefined();
  });

  it('explains an update without applying it twice', async () => {
    await Order.updateMany(
      { status: 'open' },
      { $inc: { total: 1000 } },
    ).exec();

    const span = await spanFor('updateMany');
    expect(span.attributes['db.plan.full_scan']).toBe(true);
    expect(span.attributes['db.plan.node']).toBe('UPDATE');
    expect(await Order.countDocuments({ total: { $gte: 2000 } })).toBe(0);
    await Order.updateMany(
      { status: 'open' },
      { $inc: { total: -1000 } },
    ).exec();
  });

  it('explains an aggregate pipeline', async () => {
    const groups = await Order.aggregate([
      { $match: { status: 'closed' } },
      { $group: { _id: null, n: { $sum: 1 } } },
    ]).exec();
    expect(groups).toEqual([{ _id: null, n: 40 }]);

    const span = await spanFor('aggregate');
    expect(span.attributes['db.plan.full_scan']).toBe(true);
    expect(span.attributes['db.plan.index_suggestion']).toBe(
      'db.orders.createIndex({ status: 1 })',
    );
  });

  it('runs application middleware once: explain bypasses Mongoose', async () => {
    hookRuns.find = 0;
    hookRuns.aggregate = 0;
    await Order.find({ status: 'open' }).exec();
    await Order.aggregate([{ $match: { status: 'open' } }]).exec();
    await spanFor('find');
    await spanFor('aggregate');
    expect(hookRuns).toEqual({ find: 1, aggregate: 1 });
  });

  it('explains the filter as chained after the call', async () => {
    await Order.find().where('total').gte(55).exec();
    const span = await spanFor('find');
    expect(span.attributes['db.plan.rows_returned']).toBe(5);
  });

  it('explains the plan a hint forced, not the one the planner would pick', async () => {
    await Order.collection.createIndex({ total: 1 });
    onTestFinished(async () => {
      await Order.collection.dropIndexes();
    });
    await Order.find({ total: 7 }).hint({ $natural: 1 }).exec();

    const span = await spanFor('find');
    expect(span.attributes['db.plan.full_scan']).toBe(true);
    expect(span.attributes['db.plan.rows_examined']).toBe(60);
  });

  it('explains and hashes an aggregate as chained', async () => {
    await Order.aggregate([]).match({ status: 'open' }).exec();
    await Order.aggregate([]).match({ total: 1 }).exec();

    const spans = await vi.waitFor(() => {
      const found = exporter
        .getFinishedSpans()
        .filter((s) => s.attributes[ATTR_DB_OPERATION_NAME] === 'aggregate');
      if (found.length < 2) throw new Error('waiting for both aggregates');
      return found;
    });
    const [byStatus, byTotal] = spans;
    expect(byStatus!.attributes['db.query.text']).toContain('"status"');
    expect(byTotal!.attributes['db.query.text']).toContain('"total"');
    expect(byStatus!.attributes['db.statement.hash']).not.toBe(
      byTotal!.attributes['db.statement.hash'],
    );
    // The explain saw the chained $match: 20 open orders out of 60.
    expect(byStatus!.attributes['db.plan.rows_returned']).toBe(20);
  });

  it('records the stages, keys read, and the mode the plan was captured in', async () => {
    await Order.find({ status: 'open' }).sort({ createdAt: -1 }).exec();
    const span = await spanFor('find');
    expect(span.attributes).toMatchObject({
      'db.plan.status': 'captured',
      'db.plan.mode': 'analyze',
      'db.plan.stages': ['SORT', 'COLLSCAN'],
      'db.plan.blocking_sort': true,
      'db.plan.keys_examined': 0,
      'db.plan.index_suggestion.equality': ['status'],
      'db.plan.index_suggestion.sort': ['createdAt:-1'],
    });
  });

  it('says an operation has no plan rather than looking switched off', async () => {
    await Order.estimatedDocumentCount().exec();
    await Order.create({ status: 'open', total: 1 });
    onTestFinished(async () => {
      await Order.deleteOne({ total: 1, status: 'open', createdAt: null });
    });
    const count = await spanFor('estimatedDocumentCount');
    expect(count.attributes).toMatchObject({
      'db.plan.status': 'unsupported',
      'db.plan.mode': 'analyze',
    });
    const created = await spanFor('create');
    expect(created.attributes['db.plan.status']).toBe('unsupported');
  });

  it('records why an explain failed, and still ends the span', async () => {
    const db = Order.db.db!;
    const command = db.command.bind(db);
    // What a user without explain privileges gets back.
    db.command = (async (doc: Record<string, unknown>, ...rest: unknown[]) => {
      if ('explain' in doc)
        throw new Error(
          'not authorized on app to execute command { explain: { find: "orders", filter: { email: "alice@example.com" } } }',
        );
      return command(doc as never, ...(rest as []));
    }) as typeof db.command;
    onTestFinished(() => {
      db.command = command;
    });

    const found = await Order.find({ status: 'open' }).exec();
    expect(found).toHaveLength(20);
    const span = await spanFor('find');
    expect(span.attributes).toMatchObject({
      'db.plan.status': 'failed',
      // The command, and the email in its filter, never reach the span.
      'db.plan.error': 'not authorized on app to execute command {…}',
    });
  });

  it('ends the span when the query settled, not when the explain did', async () => {
    const before = performance.timeOrigin + performance.now();
    await Order.find({ status: 'open' }).exec();
    const after = performance.timeOrigin + performance.now();

    const span = await spanFor('find');
    const endMs = span.endTime[0] * 1000 + span.endTime[1] / 1e6;
    expect(endMs).toBeGreaterThanOrEqual(before);
    expect(endMs).toBeLessThanOrEqual(after + 1);
    expect(span.attributes['db.plan.node']).toBeDefined();
  });
});
