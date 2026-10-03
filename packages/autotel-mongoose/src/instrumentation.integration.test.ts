import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { instrumentMongoose } from './instrumentation';
import { canListenOnLoopback, startMongo } from './test-support';
import type { TestMongo } from './test-support';
import {
  ATTR_DB_QUERY_TEXT,
  ATTR_DB_OPERATION_NAME,
  ATTR_DB_SYSTEM_NAME,
  ATTR_DB_COLLECTION_NAME,
  DB_SYSTEM_NAME_VALUE_MONGODB,
} from './constants';

let mongod: TestMongo | undefined;
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
  mongod = await startMongo('instrumentation');
  const uri = mongod.uri;

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

/** The serialized statement a span recorded, which is always a string when set. */
function queryTextOf(span: { attributes: Record<string, unknown> }): string {
  // SAFETY: the instrumentation writes db.query.text with a serialized
  // statement; a span that never recorded one fails the expectation that
  // precedes each of these reads.
  return span.attributes[ATTR_DB_QUERY_TEXT] as string;
}

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

    expect(queryTextOf(findSpan!)).toBe(
      '{"condition":{"name":"?"},"options":{}}',
    );
  });

  it('captures no values in db.query.text by default', async () => {
    await User.find({ email: 'alice@example.com' }).exec();

    const spans = exporter.getFinishedSpans();
    const findSpan = spans.find(
      (s) => s.attributes[ATTR_DB_OPERATION_NAME] === 'find',
    );
    expect(queryTextOf(findSpan!)).not.toContain('alice');
  });

  it('hashes the query as chained, not as first called', async () => {
    await User.find().where('age').gt(0).exec();
    await User.find().where('age').lt(0).exec();

    const [gt, lt] = exporter.getFinishedSpans();
    expect(queryTextOf(gt!)).toContain('"$gt"');
    expect(queryTextOf(lt!)).toContain('"$lt"');
    expect(gt!.attributes['db.statement.hash']).not.toBe(
      lt!.attributes['db.statement.hash'],
    );
  });

  it('gives the same query the same db.statement.hash, whatever its values', async () => {
    await User.find({ name: 'Alice' }).exec();
    await User.find({ name: 'Bob' }).exec();
    await User.find({ email: 'x' }).exec();
    await User.findOne({ name: 'Alice' }).exec();

    const hashes = exporter
      .getFinishedSpans()
      .map((span) => span.attributes['db.statement.hash']);
    expect(hashes).toHaveLength(4);
    expect(hashes[0]).toBe(hashes[1]);
    expect(new Set(hashes).size).toBe(3);
  });

  it('captures db.query.text for save operations', async () => {
    const user = new User({ name: 'Bob', email: 'bob@test.com', age: 30 });
    await user.save();

    const spans = exporter.getFinishedSpans();
    const saveSpan = spans.find(
      (s) => s.attributes[ATTR_DB_OPERATION_NAME] === 'save',
    );
    expect(saveSpan).toBeDefined();
    expect(queryTextOf(saveSpan!)).toBe(
      '{"document":{"name":"?","email":"?","age":"?","_id":"?"}}',
    );
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
    const queryText = queryTextOf(aggSpan!);
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
    // Two documents of one shape are one entry: the text does not grow with
    // the batch, so batches of any size group together.
    expect(queryTextOf(insertSpan!)).toBe(
      '{"documents":[{"name":"?","email":"?","age":"?"}]}',
    );
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
    const queryText = queryTextOf(bulkSpan!);
    expect(queryText).toContain('insertOne');
    expect(queryText).toContain('updateOne');
    expect(queryText).not.toContain('Eve');
  });

  it('captures db.query.text for updateOne with updates payload', async () => {
    await User.updateOne({ name: 'Bob' }, { $set: { age: 31 } }).exec();

    const spans = exporter.getFinishedSpans();
    const updateSpan = spans.find(
      (s) => s.attributes[ATTR_DB_OPERATION_NAME] === 'updateOne',
    );
    expect(updateSpan).toBeDefined();
    expect(queryTextOf(updateSpan!)).toBe(
      '{"condition":{"name":"?"},"updates":{"$set":{"age":"?"}},"options":{}}',
    );
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

describe('instrumenting more than once', () => {
  if (!supportsLocalServer) {
    it.skip('skips when the environment cannot open local TCP ports', () => {});
    return;
  }

  it('opens one span per operation however often instrumentMongoose runs', async () => {
    // `Model`, `Query.prototype` and `Model.prototype` come from the mongoose
    // module, so every `new mongoose.Mongoose()` shares them. An app with two
    // init paths, or a suite building an instance per case, therefore patched
    // the same methods repeatedly, and one find() opened a span per layer.
    const counts: number[] = [];

    for (const round of [1, 2, 3]) {
      const instance = new mongoose.Mongoose();
      instrumentMongoose(instance, { instrumentHooks: true });
      await instance.connect(mongod!.uri);

      const schema = new instance.Schema({ value: Number });
      const Model = instance.model(`RepeatInstrumentation${round}`, schema);
      await Model.create({ value: round });

      exporter.reset();
      await Model.find({});
      counts.push(
        exporter
          .getFinishedSpans()
          .filter((span) => span.name.startsWith('find ')).length,
      );

      await Model.deleteMany({});
      await instance.disconnect();
    }

    expect(counts).toEqual([1, 1, 1]);
  });
});

describe('methods Mongoose implements with other methods', () => {
  if (!supportsLocalServer) {
    it.skip('skips when the environment cannot open local TCP ports', () => {});
    return;
  }

  it('opens one span for findById, not one per delegation', async () => {
    // `Model.findById` calls `Model.findOne`. Both are public API and both are
    // traced, so one round trip used to arrive as two spans, the delegate
    // nested inside its caller.
    const created = await User.create({
      name: 'Delegation',
      email: 'delegation@example.com',
      age: 30,
    });

    exporter.reset();
    await User.findById(created._id);

    const names = exporter.getFinishedSpans().map((span) => span.name);
    expect(names).toEqual(['findById users']);
  });

  it('keeps the span for a query a hook issues', async () => {
    // The delegate is built while the caller assembles its Query. A query that
    // starts later, from a hook, is a separate round trip and keeps its span —
    // the distinction a blunt "suppress nested queries" rule would lose.
    const instance = new mongoose.Mongoose();
    instrumentMongoose(instance, { instrumentHooks: true });
    await instance.connect(mongod!.uri);

    const Counter = instance.model(
      'DelegationCounter',
      new instance.Schema({ n: Number }),
    );
    const schema = new instance.Schema({ value: Number });
    schema.pre('save', async function () {
      await Counter.countDocuments({});
    });
    const Model = instance.model('DelegationHost', schema);

    exporter.reset();
    await new Model({ value: 1 }).save();

    const names = exporter.getFinishedSpans().map((span) => span.name);
    expect(names).toContain('countDocuments delegationcounters');
    expect(names).toContain('save delegationhosts');

    await Model.deleteMany({});
    await Counter.deleteMany({});
    await instance.disconnect();
  });
});
