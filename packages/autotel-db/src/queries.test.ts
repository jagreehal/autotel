import { describe, expect, it } from 'vitest';
import { groupQueries, queryIdentity, readPlan, type QuerySpan } from './index';

let id = 0;
function span(
  traceId: string,
  startMs: number,
  durationMs: number,
  attributes: Record<string, unknown>,
): QuerySpan {
  id += 1;
  return { traceId, spanId: `s${id}`, startMs, durationMs, attributes };
}

const COMMENTS = {
  'db.system.name': 'postgresql',
  'db.statement.hash': 'c',
  'db.query.text': 'select * from comments where post_id = $1',
  'db.collection.name': 'comments',
  'db.operation.name': 'SELECT',
};

describe('queryIdentity', () => {
  it('prefers the hash, then the text, then the operation on its collection', () => {
    expect(
      queryIdentity({ 'db.statement.hash': 'h', 'db.query.text': 't' }),
    ).toBe('hash:||h');
    expect(queryIdentity({ 'db.statement': 't' })).toBe('text:||t');
    expect(
      queryIdentity({ 'db.system.name': 'redis', 'db.operation.name': 'GET' }),
    ).toBe('op:redis||GET ');
    expect(queryIdentity({ 'http.method': 'GET' })).toBeUndefined();
  });

  it('keeps the same statement in two databases apart', () => {
    const statement = { 'db.system.name': 'mongodb', 'db.statement.hash': 'h' };
    expect(queryIdentity({ ...statement, 'db.namespace': 'shop' })).not.toBe(
      queryIdentity({ ...statement, 'db.namespace': 'billing' }),
    );
  });
});

describe('readPlan', () => {
  it('reads db.plan.* back, and nothing from a span never explained', () => {
    expect(
      readPlan({
        'db.plan.status': 'captured',
        'db.plan.mode': 'analyze',
        'db.plan.node': 'SORT',
        'db.plan.stages': ['SORT', 'COLLSCAN'],
        'db.plan.full_scan': true,
        'db.plan.blocking_sort': true,
        'db.plan.indexes': 'a_1,b_1',
        'db.plan.keys_examined': 0,
        'db.plan.rows_examined': 60,
        'db.plan.rows_returned': '16',
        'db.plan.index_suggestion': 'db.x.createIndex({ a: 1 })',
        'db.plan.index_suggestion.equality': ['a'],
        'db.plan.index_suggestion.sort': [],
        'db.plan.index_suggestion.range': [],
      }),
    ).toMatchObject({
      status: 'captured',
      mode: 'analyze',
      node: 'SORT',
      stages: ['SORT', 'COLLSCAN'],
      fullScan: true,
      blockingSort: true,
      indexes: ['a_1', 'b_1'],
      keysExamined: 0,
      rowsExamined: 60,
      rowsReturned: 16,
      indexSuggestion: 'db.x.createIndex({ a: 1 })',
      indexFields: { equality: ['a'], sort: [], range: [] },
    });
    expect(readPlan({ 'db.query.text': 'x' })).toBeUndefined();
  });

  it('reads a span from before db.plan.status as captured', () => {
    expect(
      readPlan({ 'db.plan.node': 'Seq Scan', 'db.plan.full_scan': true }),
    ).toMatchObject({ status: 'captured', stages: ['Seq Scan'] });
  });

  it('sanitises an error another producer exported raw', () => {
    expect(
      readPlan({
        'db.plan.status': 'failed',
        'db.plan.error': 'bad filter { email: "a@b.c" }',
      })?.error,
    ).toBe('bad filter {…}');
  });

  it('reads a failed explain with its reason', () => {
    expect(
      readPlan({ 'db.plan.status': 'failed', 'db.plan.error': 'no auth' }),
    ).toMatchObject({ status: 'failed', error: 'no auth', stages: [] });
  });
});

describe('groupQueries', () => {
  it('counts, times, and finds the trace that ran it in a loop', () => {
    const groups = groupQueries([
      span('t1', 10, 2, COMMENTS),
      span('t1', 11, 4, COMMENTS),
      span('t1', 12, 6, COMMENTS),
      span('t2', 5, 100, COMMENTS),
      span('t2', 6, 1, {
        ...COMMENTS,
        'db.statement.hash': 'p',
        'db.collection.name': 'posts',
      }),
      span('t2', 7, 9, { 'http.route': '/feed' }),
    ]);

    expect(groups.map((group) => group.statementHash)).toEqual(['c', 'p']);
    const [comments] = groups;
    expect(comments).toMatchObject({
      count: 4,
      totalMs: 112,
      avgMs: 28,
      maxMs: 100,
      p95Ms: 100,
      traceCount: 2,
      maxPerTrace: 3,
      maxPerTraceTraceId: 't1',
      collection: 'comments',
      system: 'postgresql',
      starts: [5, 10, 11, 12],
      firstSeenMs: 5,
      lastSeenMs: 12,
    });
    expect(comments!.slowest.map((run) => run.durationMs)).toEqual([
      100, 6, 4, 2,
    ]);
  });

  it('names the run its plan came from, apart from the runs it times', () => {
    const [group] = groupQueries([
      span('t1', 1, 50, {
        ...COMMENTS,
        'db.plan.status': 'captured',
        'db.plan.node': 'A',
      }),
      span('t2', 9, 2, {
        ...COMMENTS,
        'db.plan.status': 'captured',
        'db.plan.node': 'B',
      }),
      span('t3', 5, 7, COMMENTS),
    ]);
    expect(group!.count).toBe(3);
    expect(group!.plan?.node).toBe('B');
    expect(group!.planSample).toMatchObject({ traceId: 't2', startMs: 9 });
  });

  it('says why there is no plan, until a run captures one', () => {
    const failed = {
      ...COMMENTS,
      'db.plan.status': 'failed',
      'db.plan.error': 'no auth',
    };
    const [onlyFailed] = groupQueries([span('t1', 1, 1, failed)]);
    expect(onlyFailed!.plan).toBeUndefined();
    expect(onlyFailed!.planIssue).toMatchObject({
      status: 'failed',
      error: 'no auth',
    });

    const [recovered] = groupQueries([
      span('t1', 1, 1, failed),
      span('t2', 2, 1, {
        ...COMMENTS,
        'db.plan.status': 'captured',
        'db.plan.node': 'X',
      }),
    ]);
    expect(recovered!.planIssue).toBeUndefined();
    expect(recovered!.plan?.node).toBe('X');

    const [off] = groupQueries([span('t1', 1, 1, COMMENTS)]);
    expect(off!.plan).toBeUndefined();
    expect(off!.planIssue).toBeUndefined();
  });

  it('keeps the latest plan, counts full scans, and notices a plan change', () => {
    const [group] = groupQueries([
      span('t1', 1, 50, {
        ...COMMENTS,
        'db.plan.full_scan': true,
        'db.plan.node': 'Seq Scan',
        'db.plan.hash': 'a',
      }),
      span('t2', 2, 2, {
        ...COMMENTS,
        'db.plan.full_scan': false,
        'db.plan.node': 'Index Scan',
        'db.plan.hash': 'b',
      }),
    ]);
    expect(group!.fullScanCount).toBe(1);
    expect(group!.planHashes).toEqual(['a', 'b']);
    expect(group!.plan?.node).toBe('Index Scan');
  });
});
