import { describe, expect, it } from 'vitest';
import findSort from './__fixtures__/explain-find-sort.json';
import aggregate from './__fixtures__/explain-aggregate.json';
import {
  indexAdvice,
  planFromExplain,
  serializeMongoCommand,
  serializeMongoStatement,
  suggestIndex,
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
    expect(
      serializeMongoStatement({ documents: [{ a: 1 }, { a: 2 }, { a: 3 }] }),
    ).toBe('{"documents":[{"a":"?"}]}');
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

  it('keeps a command collection name and drops its session fields', () => {
    expect(
      serializeMongoCommand({
        find: 'users',
        filter: { email: 'a@b.c' },
        lsid: { id: 'x' },
        $clusterTime: {},
        txnNumber: 4,
        $db: 'app',
      }),
    ).toBe('{"find":"users","filter":{"email":"?"}}');
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
