import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb';
import { Int32 } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import findSort from './__fixtures__/explain-find-sort.json';
import aggregate from './__fixtures__/explain-aggregate.json';
import {
  indexAdvice,
  planFromExplain,
  serializeMongoCommand,
  mongoPayloadKey,
  serializeMongoPayload,
  serializeMongoStatement,
  suggestIndex,
  traceMongoCommands,
} from './index';

describe('serializeMongoStatement', () => {
  it('keeps the shape and drops every value', () => {
    class ObjectId {}
    const text = serializeMongoStatement({
      condition: {
        email: 'a@b.c',
        _id: new ObjectId(),
        age: { $gt: 30 },
        at: new Date(),
      },
      updates: { $set: { name: 'Alice' } },
    });
    expect(text).toBe(
      '{"condition":{"email":"?","_id":"?","age":{"$gt":"?"},"at":"?"},"updates":{"$set":{"name":"?"}}}',
    );
    expect(text).not.toContain('a@b.c');
  });

  it('gives the same text to the same query with different values', () => {
    expect(serializeMongoStatement({ status: { $in: [1, 2, 3] } })).toBe(
      serializeMongoStatement({ status: { $in: [9] } }),
    );
  });

  it('keeps every pipeline stage, in order, however alike', () => {
    expect(serializeMongoStatement([{ $match: { a: 1 } }])).not.toBe(
      serializeMongoStatement([{ $match: { a: 1 } }, { $match: { a: 2 } }]),
    );
    expect(
      serializeMongoStatement({
        aggregatePipeline: [
          { $match: { a: 1 } },
          { $match: { b: 1 } },
          { $match: { a: 2 } },
        ],
      }),
    ).toBe(
      '{"aggregatePipeline":[{"$match":{"a":"?"}},{"$match":{"b":"?"}},{"$match":{"a":"?"}}]}',
    );
  });

  it('collapses batches and logical branches, not ordered arrays', () => {
    expect(
      serializeMongoStatement({ $or: [{ a: 1 }, { a: 2 }, { b: 1 }] }),
    ).toBe('{"$or":[{"a":"?"},{"b":"?"}]}');
    expect(serializeMongoStatement({ tags: ['x', 'y'], empty: [] })).toBe(
      '{"tags":["?"],"empty":[]}',
    );
  });

  it('keeps distinct pipeline stages in order', () => {
    expect(
      serializeMongoStatement([
        { $match: { a: 1 } },
        { $group: { _id: '$a' } },
      ]),
    ).toBe('[{"$match":{"a":"?"}},{"$group":{"_id":"?"}}]');
  });

  it('treats a filter field named like a command as data', () => {
    expect(serializeMongoStatement({ find: 'secret', $db: 'x' })).toBe(
      '{"find":"?","$db":"?"}',
    );
  });

  it('leaves out undefined fields', () => {
    expect(
      serializeMongoStatement({ condition: { a: 1 }, updates: undefined }),
    ).toBe('{"condition":{"a":"?"}}');
  });

  it('collapses extended JSON wrappers', () => {
    expect(serializeMongoStatement({ _id: { $oid: '65f0' } })).toBe(
      '{"_id":"?"}',
    );
  });
});

describe('writes', () => {
  interface Fields {
    [key: string]: number | Fields;
  }
  const text = (updates: Fields | Fields[], operation = 'updateOne') =>
    serializeMongoPayload(operation, { condition: { _id: 1 }, updates });
  const key = (updates: Fields | Fields[], operation = 'updateOne') =>
    mongoPayloadKey(operation, { condition: { _id: 1 }, updates });

  it('leaves a bare filter alone, whatever its fields are called', () => {
    for (const field of ['document', 'documents', 'update', 'updates', 'u']) {
      expect(serializeMongoStatement({ [field]: { kind: 1 } })).toBe(
        `{"${field}":{"kind":"?"}}`,
      );
    }
    expect(
      serializeMongoPayload('find', { condition: { document: { a: 1 } } }),
    ).toBe('{"condition":{"document":{"a":"?"}}}');
  });

  it('shows written documents as one value', () => {
    expect(serializeMongoPayload('save', { document: { a: 1 } })).toBe(
      '{"document":"?"}',
    );
    expect(
      serializeMongoPayload('insertMany', { documents: [{ a: 1 }, { b: 1 }] }),
    ).toBe('{"documents":"?"}');
    expect(text({ a: 1 }, 'replaceOne')).toBe(
      '{"condition":{"_id":"?"},"updates":"?"}',
    );
  });

  it('reads Mongoose shorthand as the $set it becomes', () => {
    expect(text({ a: 1 })).toBe(text({ $set: { a: 1 } }));
    expect(key({ a: 1 })).toBe(key({ $set: { b: 1, c: 2 } }));
    expect(text({ a: 1, $inc: { n: 1 }, $set: { b: 1 } })).toBe(
      '{"condition":{"_id":"?"},"updates":{"$inc":{"n":"?"},"$set":{"b":"?","a":"?"}}}',
    );
    expect(key({ a: 1, $inc: { n: 1 } })).toBe(
      key({ $set: { z: 1 }, $inc: { n: 1 } }),
    );
    expect(key({ $inc: { a: 1 } })).not.toBe(key({ $set: { a: 1 } }));
  });

  it('keeps every stage of an update pipeline', () => {
    const add = { $set: { n: { $add: 1 } } };
    expect(
      serializeMongoPayload('updateOne', { updatePipeline: [add, add] }),
    ).toBe(
      '{"updatePipeline":[{"$set":{"n":{"$add":"?"}}},{"$set":{"n":{"$add":"?"}}}]}',
    );
    expect(text([add, add])).not.toBe(text([add]));
    expect(key([add, add])).not.toBe(key([add]));
    expect(serializeMongoStatement({ updates: [add, add] })).not.toBe(
      serializeMongoStatement({ updates: [add] }),
    );
  });

  it('collapses bulk writes to their distinct operations', () => {
    const operations = [
      { insertOne: { document: { a: 1 } } },
      { insertOne: { document: { b: 1 } } },
      { replaceOne: { filter: { update: 1 }, replacement: { a: 1 } } },
      { updateOne: { filter: { _id: 1 }, update: { a: 1 } } },
      { updateOne: { filter: { _id: 1 }, update: { $set: { a: 1 } } } },
    ];
    expect(serializeMongoPayload('bulkWrite', { operations })).toBe(
      '{"operations":[{"insertOne":{"document":"?"}},' +
        '{"replaceOne":{"filter":{"update":"?"},"replacement":"?"}},' +
        '{"updateOne":{"filter":{"_id":"?"},"update":{"$set":{"a":"?"}}}}]}',
    );
  });

  it('caps the text of an update', () => {
    const $set = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`field${i}`, 1]),
    );
    expect(text({ $set })).toHaveLength(513);
  });
});

describe('traceMongoCommands', () => {
  interface Command {
    [key: string]: string | number | boolean | Command | Command[];
  }
  /** Upstream's own method for describing a span, called as upstream calls it. */
  const describing = (
    instrumentation: MongoDBInstrumentation,
    driver: 3 | 4,
  ) => {
    // SAFETY: private upstream, called here as upstream calls them.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- private methods
    const describers = traceMongoCommands(instrumentation) as object as Record<
      '_getV4SpanAttributes' | '_getV3SpanAttributes',
      (
        first: string | { address: string },
        second:
          | { db: string; collection: string }
          | { s: { options: { host: string; port: number } } },
        command: Command,
        operation: string | undefined,
      ) => Record<string, string>
    >;
    return (
      operation: string | undefined,
      collection: string,
      command: Command,
    ) =>
      driver === 4
        ? describers._getV4SpanAttributes(
            { address: 'localhost:27017' },
            { db: 'd', collection },
            command,
            operation,
          )
        : describers._getV3SpanAttributes(
            `d.${collection}`,
            { s: { options: { host: 'localhost', port: 27017 } } },
            command,
            operation,
          );
  };
  const describeSpan = (
    driver: 3 | 4,
    operation: string | undefined,
    collection: string,
    command: Command,
    config = {},
  ) =>
    describing(
      new MongoDBInstrumentation({ enabled: false, ...config }),
      driver,
    )(operation, collection, command);
  const text = (...args: Parameters<typeof describeSpan>) =>
    describeSpan(...args)['db.query.text'];

  it('names the collection of a command sent through $cmd', () => {
    for (const name of ['find', 'count', 'findAndModify', 'insert']) {
      const span = describeSpan(4, name, '$cmd', { [name]: 'orders' });
      expect(span['db.collection.name']).toBe('orders');
      expect(span['db.query.text']).toBe(`{"${name}":"orders"}`);
    }
    expect(
      describeSpan(4, 'explain', '$cmd', { explain: { find: 'orders' } }),
    ).toMatchObject({
      'db.collection.name': 'orders',
      'db.query.text': '{"explain":{"find":"orders"}}',
    });
    expect(text(4, 'createUser', '$cmd', { createUser: 'secret' })).toBe(
      '{"createUser":"?"}',
    );
  });

  it('drops session fields and every value', () => {
    expect(
      text(4, 'find', 'users', {
        find: 'users',
        filter: { email: 'a@b.c', updates: { a: 1 } },
        lsid: { id: 'x' },
        $db: 'app',
      }),
    ).toBe('{"find":"users","filter":{"email":"?","updates":{"a":"?"}}}');
  });

  it('shows written documents as one value', () => {
    expect(
      text(4, 'insert', 'users', {
        insert: 'users',
        documents: [{ find: 'secret' }],
      }),
    ).toBe('{"insert":"users","documents":"?"}');
    expect(
      text(4, 'findAndModify', '$cmd', {
        findAndModify: 'users',
        query: { a: 1 },
        update: { secret: 1 },
      }),
    ).toBe('{"findAndModify":"users","query":{"a":"?"},"update":"?"}');
    expect(
      text(4, 'bulkWrite', '$cmd', {
        bulkWrite: 1,
        ops: {
          field: 'ops',
          documents: [
            { insert: 0, document: { secret: 1 } },
            { insert: 1, document: { other: 1 } },
            { update: 0, filter: { a: 1 }, updateMods: { secret: 1 } },
            { update: 0, filter: { a: 1 }, updateMods: { $set: { b: 1 } } },
          ],
        },
        nsInfo: { documents: [{ ns: 'd.users' }, { ns: 'd.orders' }] },
      }),
    ).toBe(
      '{"bulkWrite":"?","ops":[{"insert":"d.users","document":"?"},' +
        '{"insert":"d.orders","document":"?"},' +
        '{"update":"d.users","filter":{"a":"?"},"updateMods":"?"},' +
        '{"update":"d.users","filter":{"a":"?"},"updateMods":{"$set":{"b":"?"}}}]}',
    );
    expect(
      text(4, 'explain', '$cmd', {
        explain: { update: 'c', updates: [{ q: {}, u: { secret: 1 } }] },
      }),
    ).toBe('{"explain":{"update":"c","updates":[{"q":{},"u":"?"}]}}');
  });

  it('keeps every stage of a pipeline, and caps the text of an update', () => {
    const add = { $set: { n: { $add: 1 } } };
    const update = (u: Command | Command[]) =>
      text(4, 'update', 'c', { update: 'c', updates: [{ q: {}, u }] });
    expect(update([add, add])).not.toBe(update([add]));
    const $set = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`field${i}`, 1]),
    );
    expect(update({ $set })).toHaveLength(513);
  });

  it('reads what driver 3 passes, whose filters can look like commands', () => {
    expect(text(3, 'insert', 'users', { find: 'secret' })).toBe(
      '{"insert":"users","documents":"?"}',
    );
    const find = (query: Command) =>
      text(3, 'find', 'users', { find: 'd.users', query, slaveOk: true });
    expect(find({ find: 'secret', _id: 1 })).toBe(
      '{"find":"users","slaveOk":"?","filter":{"find":"?","_id":"?"}}',
    );
    expect(find({ findAndModify: 'x', update: { a: 1 } })).not.toBe(
      find({ findAndModify: 'x', update: { b: 1 } }),
    );
    expect(
      text(3, 'update', 'users', { q: { update: 'secret' }, u: { secret: 1 } }),
    ).toBe('{"update":"users","updates":[{"q":{"update":"?"},"u":"?"}]}');
    expect(
      describeSpan(3, undefined, '$cmd', {
        findAndModify: 'users',
        query: { findAndModify: 'secret', update: { a: 1 } },
      }),
    ).toMatchObject({
      'db.collection.name': 'users',
      'db.query.text':
        '{"findAndModify":"users","query":{"findAndModify":"?","update":{"a":"?"}}}',
    });
  });

  it('reads the commands driver 3 sends as queries', () => {
    const named = {
      'db.collection.name': 'orders',
      'db.query.text': '{"find":"orders","filter":{"n":"?"}}',
    };
    const command = { find: 'orders', filter: { n: 1 } };
    // Captured from mongodb 3.7.4: a topology cursor, then a `$cmd` query.
    expect(describeSpan(3, 'find', '$cmd', command)).toMatchObject(named);
    expect(describeSpan(3, 'find', 'orders', command)).toMatchObject(named);
    for (const query of [command, { $query: command }]) {
      expect(
        describeSpan(3, 'find', '$cmd', { find: 'd.$cmd', skip: 0, query }),
      ).toMatchObject(named);
    }
  });

  it('knows a command by the other names the server takes', () => {
    for (const driver of [3, 4] as const) {
      expect(
        describeSpan(driver, 'findAndModify', '$cmd', {
          findandmodify: 'orders',
          query: { n: 1 },
          update: { secret: 1 },
        }),
      ).toMatchObject({
        'db.collection.name': 'orders',
        'db.query.text':
          '{"findandmodify":"orders","query":{"n":"?"},"update":"?"}',
      });
    }
    expect(
      describeSpan(3, undefined, '$cmd', { mapreduce: 'orders' }),
    ).toMatchObject({ 'db.collection.name': 'orders' });
  });

  it('never fails the command it describes', () => {
    const cyclic: Command = {};
    cyclic.self = cyclic;
    expect(
      describeSpan(4, 'find', '$cmd', { find: 'orders', filter: cyclic }),
    ).toMatchObject({ 'db.collection.name': 'orders' });
    const explain: Command = {};
    explain.explain = explain;
    expect(() => describeSpan(4, 'explain', '$cmd', explain)).not.toThrow();
    const withToBson = Object.assign(cyclic, { toBSON: () => ({ n: 1 }) });
    expect(
      text(4, 'find', '$cmd', { find: 'orders', filter: { a: withToBson } }),
    ).toBe('{"find":"orders","filter":{"a":"?"}}');
  });

  it('keeps the dots in a collection name, whatever driver 3 runs', () => {
    const name = 'archive.orders';
    for (const [operation, command] of [
      ['insert', { a: 1 }],
      ['update', { q: {}, u: {} }],
      ['remove', { q: {}, limit: 1 }],
      ['find', { find: `d.${name}`, query: {} }],
      ['getMore', { find: `d.${name}`, query: {} }],
    ] as const) {
      const span = describeSpan(3, operation, name, command);
      expect(span['db.collection.name']).toBe(name);
      expect(span['db.query.text']).toContain(`"${name}"`);
    }
  });

  it('names the collection of a getMore, which is not its first field', () => {
    const getMore = { getMore: 42, collection: 'orders', batchSize: 1 };
    for (const driver of [3, 4] as const) {
      const operation = driver === 4 ? 'getMore' : undefined;
      expect(describeSpan(driver, operation, '$cmd', getMore)).toMatchObject({
        'db.collection.name': 'orders',
        'db.query.text':
          '{"getMore":"?","collection":"orders","batchSize":"?"}',
      });
    }
  });

  it('reads no collection from a command that has none', () => {
    for (const driver of [3, 4] as const) {
      expect(
        describeSpan(driver, 'ping', '$cmd', { ping: 1, '': 'secret' }),
      ).toMatchObject({
        'db.collection.name': '$cmd',
        'db.query.text': '{"ping":"?","":"?"}',
      });
    }
    expect(
      describeSpan(4, '', '$cmd', { '': 'secret' })['db.collection.name'],
    ).toBe('$cmd');
  });

  it('looks inside an explain only when that is the command', () => {
    for (const driver of [3, 4] as const) {
      const ping = { ping: 1, explain: { find: 'secret' } };
      const span = describeSpan(driver, 'ping', '$cmd', ping);
      expect(span['db.collection.name']).toBe('$cmd');
      expect(JSON.stringify(span)).not.toContain('secret');
    }
    expect(
      describeSpan(4, 'explain', '$cmd', { explain: { find: 'orders' } }),
    ).toMatchObject({ 'db.collection.name': 'orders' });
  });

  it('never runs application code to read a command', () => {
    const code = vi.fn(() => 0);
    // An index BSON can write, whose every method counts as application code.
    const index: Command = Object.assign(Object.create(null), {
      toBSON: code,
      toJSON: code,
      valueOf: code,
      toString: code,
      [Symbol.toPrimitive]: code,
    });
    const getter = (field: string): Command =>
      Object.defineProperty({}, field, { get: code, enumerable: true });
    const bulk = (op: Command, ops: Command | Command[] = [op]) =>
      text(4, 'bulkWrite', '$cmd', {
        bulkWrite: 1,
        ops,
        nsInfo: [{ ns: 'd.users' }, getter('ns')],
      });
    expect(bulk({ insert: index, document: { name: 'secret' } })).toBe(
      '{"bulkWrite":"?","ops":[{"insert":"?","document":"?"}]}',
    );
    expect(bulk(getter('insert'))).toBe('{"bulkWrite":"?","ops":["?"]}');
    expect(bulk({}, getter('documents'))).toBe('{"bulkWrite":"?","ops":[]}');
    expect(text(4, 'find', '$cmd', getter('find'))).toBe('"?"');
    expect(
      text(4, 'find', '$cmd', { find: 'a', filter: { b: getter('toBSON') } }),
    ).toBe('{"find":"a","filter":{"b":"?"}}');
    const array = (...elements: Command[]): Command[] =>
      Object.assign(elements, {
        map: code,
        every: code,
        [Symbol.iterator]: code,
        constructor: code,
      });
    const pipeline = array({ $match: { a: 1 } });
    expect(text(4, 'aggregate', '$cmd', { aggregate: 'a', pipeline })).toBe(
      '{"aggregate":"a","pipeline":[{"$match":{"a":"?"}}]}',
    );
    const updates = array({ q: {}, u: array({ $set: { a: 1 } }) });
    expect(text(4, 'update', '$cmd', { update: 'a', updates })).toBe(
      '{"update":"a","updates":[{"q":{},"u":[{"$set":{"a":"?"}}]}]}',
    );
    expect(
      text(4, 'bulkWrite', '$cmd', {
        bulkWrite: 1,
        ops: array({ delete: 0 }),
        nsInfo: array({ ns: 'd.users' }),
      }),
    ).toBe('{"bulkWrite":"?","ops":[{"delete":"d.users"}]}');
    const accessor = Object.defineProperty([{ a: 1 }], 0, { get: code });
    // Upstream reads these.
    for (const command of [
      { insert: 'a', documents: accessor },
      getter('documents'),
      getter('cursors'),
    ]) {
      expect(describeSpan(4, 'insert', '$cmd', command)).toMatchObject({
        'db.operation.name': 'insert',
        'db.namespace': 'd',
        'db.query.text': expect.any(String),
      });
    }
    for (const field of ['q', 'query']) {
      expect(text(3, 'insert', 'a', getter(field))).toBe('"?"');
    }
    expect(
      text(4, 'find', '$cmd', { find: 'a', filter: { $or: accessor } }),
    ).toBe('{"find":"a","filter":{"$or":["?"]}}');
    expect(code).not.toHaveBeenCalled();
  });

  it('reads a BSON Int32 index, but none that could have code of its own', () => {
    class Subclass extends Int32 {
      override valueOf() {
        return 1;
      }
    }
    class Posing extends Subclass {
      override get _bsontype() {
        return 'Int32' as const;
      }
    }
    const patched = Object.assign(new Int32(0), { valueOf: () => 1 });
    const target = (index: Int32) =>
      text(4, 'bulkWrite', '$cmd', {
        bulkWrite: 1,
        // SAFETY: a BSON value, which Command leaves out.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- test input
        ops: [{ delete: index as object as Command }],
        nsInfo: [{ ns: 'd.users' }, { ns: 'd.orders' }],
      });
    const named = (name: string) =>
      `{"bulkWrite":"?","ops":[{"delete":"${name}"}]}`;
    expect(target(new Int32(0))).toBe(named('d.users'));
    expect(target(new Int32(1))).toBe(named('d.orders'));
    for (const index of [
      new Int32(9),
      new Int32(-1),
      new Subclass(0),
      new Posing(0),
      patched,
    ]) {
      expect(target(index)).toBe(named('?'));
    }
  });

  it('masks what it cannot read, however it is reconfigured', () => {
    const documents = [{ name: 'secret' }];
    const cyclic: Command = {};
    cyclic.self = cyclic;
    const instrumentation = new MongoDBInstrumentation({ enabled: false });
    const describe = describing(instrumentation, 4);
    const enhanced = { enhancedDatabaseReporting: true };
    for (const config of [
      enhanced,
      { ...enhanced, dbStatementSerializer: undefined },
      // An untyped caller can pass null.
      JSON.parse(
        '{"enhancedDatabaseReporting":true,"dbStatementSerializer":null}',
      ),
    ]) {
      instrumentation.setConfig(config);
      for (const unread of [
        { insert: 'users', documents, comment: cyclic },
        Object.assign(Object.create({}), { insert: 'users', documents }),
      ]) {
        const span = describe('insert', '$cmd', unread);
        expect(span['db.query.text']).toBe('"?"');
      }
    }
    expect(instrumentation.getConfig()).toMatchObject(enhanced);
  });

  it('leaves the text to a serializer you configured', () => {
    const span = describeSpan(
      4,
      'find',
      '$cmd',
      { find: 'orders' },
      { dbStatementSerializer: () => 'mine' },
    );
    expect(span).toMatchObject({
      'db.collection.name': 'orders',
      'db.query.text': 'mine',
    });
  });

  it('follows a serializer set, or dropped, later', () => {
    const instrumentation = new MongoDBInstrumentation({ enabled: false });
    const describe = describing(instrumentation, 4);
    const find = () =>
      describe('find', '$cmd', { find: 'orders', filter: { n: 1 } })[
        'db.query.text'
      ];
    const own = '{"find":"orders","filter":{"n":"?"}}';
    expect(find()).toBe(own);
    instrumentation.setConfig({ dbStatementSerializer: () => 'mine' });
    expect(find()).toBe('mine');
    instrumentation.setConfig({
      dbStatementSerializer: serializeMongoStatement,
    });
    expect(find()).toBe('{"find":"?","filter":{"n":"?"}}');
    instrumentation.setConfig({});
    expect(find()).toBe(own);
  });

  it('names the collection each bulk write op targets', () => {
    const bulk = (index: number, ns: Command | string = 'd.orders') =>
      text(4, 'bulkWrite', '$cmd', {
        bulkWrite: 1,
        ops: [{ update: index, filter: { a: 1 }, updateMods: { $set: {} } }],
        nsInfo: [{ ns: 'd.users' }, { ns }],
      });
    expect(bulk(0)).not.toBe(bulk(1));
    expect(bulk(1)).toContain('{"update":"d.orders",');
    // MongoDB rejects these after the span has started.
    expect(bulk(1, { nested: 'secret' })).toContain('{"update":"?",');
    expect(bulk(1, { nested: 'secret' })).not.toContain('secret');
    expect(bulk(9)).toContain('{"update":"?",');
  });

  it('says so when upstream has renamed what it replaces', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setConfig = vi.fn();
    traceMongoCommands({ getConfig: () => ({}), setConfig });
    expect(warn).toHaveBeenCalledTimes(2);
    const { dbStatementSerializer } = setConfig.mock.lastCall?.[0] ?? {};
    expect(dbStatementSerializer?.({ name: 'secret' })).toBe('"?"');
    warn.mockRestore();
  });
});

describe('serializeMongoCommand', () => {
  it('keeps no value, whatever it is handed', () => {
    expect(
      serializeMongoCommand({
        find: 'users',
        filter: { a: 1 },
        lsid: { id: 'x' },
      }),
    ).toBe('{"find":"?","filter":{"a":"?"}}');
    for (const handed of [
      { find: 'secret' },
      { explain: { find: 'secret' } },
      { bulkWrite: 1, nsInfo: [{ ns: 'secret' }] },
      ['secret'],
      'secret',
    ]) {
      expect(serializeMongoCommand(handed)).not.toContain('secret');
    }
  });
});

describe('planFromExplain', () => {
  it('reads a find that sorts in memory, and suggests the ESR index', () => {
    expect(planFromExplain(findSort)).toEqual({
      nodes: ['SORT', 'FETCH', 'IXSCAN'],
      fullScan: false,
      blockingSort: true,
      indexes: ['age_1'],
      keysExamined: 46,
      rowsExamined: 46,
      rowsReturned: 23,
      executionMs: 1,
      indexSuggestion:
        'db.users.createIndex({ status: 1, createdAt: -1, age: 1 })',
      indexFields: {
        equality: ['status'],
        sort: ['createdAt:-1'],
        range: ['age'],
      },
    });
  });

  it('reads an aggregate through its $cursor stage', () => {
    expect(planFromExplain(aggregate)).toEqual({
      nodes: ['PROJECTION_SIMPLE', 'COLLSCAN', '$group'],
      fullScan: true,
      blockingSort: false,
      indexes: [],
      keysExamined: 0,
      rowsExamined: 50,
      rowsReturned: 25,
      executionMs: 0,
      indexSuggestion: 'db.users.createIndex({ status: 1 })',
      indexFields: { equality: ['status'], sort: [], range: [] },
    });
  });

  it('unwraps the slot-based engine and walks every shard', () => {
    const plan = planFromExplain({
      queryPlanner: {
        namespace: 'app.orders',
        parsedQuery: {},
        winningPlan: {
          stage: 'SHARD_MERGE',
          shards: [
            {
              winningPlan: { queryPlan: { stage: 'IXSCAN', indexName: 'a_1' } },
            },
            { winningPlan: { stage: 'COLLSCAN' } },
          ],
        },
      },
    });
    expect(plan).toEqual({
      nodes: ['SHARD_MERGE', 'IXSCAN', 'COLLSCAN'],
      fullScan: true,
      blockingSort: false,
      indexes: ['a_1'],
    });
  });

  it('names the _id index an _id lookup used', () => {
    expect(
      planFromExplain({
        queryPlanner: {
          namespace: 'app.users',
          winningPlan: { stage: 'IDHACK' },
        },
      })?.indexes,
    ).toEqual(['_id_']);
  });

  it('returns nothing for something that is not an explain', () => {
    expect(planFromExplain({ ok: 1 })).toBeUndefined();
    expect(planFromExplain(null)).toBeUndefined();
  });
});

describe('indexAdvice', () => {
  it('says which job each key does, and a key keeps its first job', () => {
    expect(
      indexAdvice(
        'app.orders',
        { $and: [{ status: { $eq: 1 } }, { total: { $gt: 1 } }] },
        { status: 1, createdAt: -1 },
      ),
    ).toEqual({
      command: 'db.orders.createIndex({ status: 1, createdAt: -1, total: 1 })',
      fields: {
        equality: ['status'],
        sort: ['createdAt:-1'],
        range: ['total'],
      },
    });
  });
});

describe('suggestIndex', () => {
  it('orders equality, sort, then range, and treats $in as range under a sort', () => {
    const parsed = {
      $and: [{ tag: { $in: [1, 2] } }, { n: { $lt: 5 } }, { s: { $eq: 1 } }],
    };
    expect(suggestIndex('app.users', parsed)).toBe(
      'db.users.createIndex({ tag: 1, s: 1, n: 1 })',
    );
    expect(suggestIndex('app.users', parsed, { at: -1 })).toBe(
      'db.users.createIndex({ s: 1, at: -1, tag: 1, n: 1 })',
    );
  });

  it('quotes what mongosh would not parse, and skips an $or', () => {
    expect(suggestIndex('app.user-events', { 'a.b': { $eq: 1 } })).toBe(
      'db.getCollection("user-events").createIndex({ "a.b": 1 })',
    );
    expect(
      suggestIndex('app.users', { $or: [{ a: { $eq: 1 } }] }),
    ).toBeUndefined();
  });
});
