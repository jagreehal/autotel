import { describe, it, expect } from 'vitest';
import { findRepeatedQueries } from './repeated-queries';
import type { SpanRecord, TraceRecord } from '../types';

function dbSpan(
  spanId: string,
  durationMs: number,
  tags: Record<string, string>,
): SpanRecord {
  return {
    traceId: 't1',
    spanId,
    parentSpanId: 'root',
    operationName: 'drizzle.select',
    serviceName: 'evidence-loop',
    startTimeUnixMs: 0,
    durationMs,
    statusCode: 'OK',
    tags,
    hasError: false,
  };
}

const COMMENTS = {
  'db.statement.hash': 'comments-hash',
  'db.statement': 'select "id" from "comments" where "post_id" = $1',
  'db.collection.name': 'comments',
};
const POSTS = {
  'db.statement.hash': 'posts-hash',
  'db.statement': 'select "id" from "posts"',
  'db.collection.name': 'posts',
};

/** The shape from the demo: one posts query, then the same comments query per post. */
function nPlusOneTrace(): TraceRecord {
  return {
    traceId: 't1',
    spans: [
      {
        ...dbSpan('root', 60, {}),
        parentSpanId: null,
        operationName: 'GET /feed',
      },
      dbSpan('s1', 2, POSTS),
      dbSpan('s2', 1, COMMENTS),
      dbSpan('s3', 2, COMMENTS),
      dbSpan('s4', 3, COMMENTS),
    ],
  };
}

describe('findRepeatedQueries()', () => {
  it('groups identical statements and counts the repeats', () => {
    const result = findRepeatedQueries(nPlusOneTrace());

    expect(result.repeated).toHaveLength(1);
    expect(result.repeated[0]?.statementHash).toBe('comments-hash');
    expect(result.repeated[0]?.count).toBe(3);
    expect(result.repeated[0]?.collection).toBe('comments');
  });

  it('totals the time the repeats spent', () => {
    const result = findRepeatedQueries(nPlusOneTrace());

    // 1ms + 2ms + 3ms, worked by hand from the fixture above.
    expect(result.repeated[0]?.totalDurationMs).toBe(6);
  });

  it('quotes the statement so the count can be checked', () => {
    const result = findRepeatedQueries(nPlusOneTrace());

    expect(result.repeated[0]?.statement).toBe(
      'select "id" from "comments" where "post_id" = $1',
    );
  });

  it('does not label raw fallback text as a statement hash', () => {
    const statement = 'select * from comments';
    const trace: TraceRecord = {
      traceId: 't2',
      spans: [
        dbSpan('s1', 2, { 'db.statement': statement }),
        dbSpan('s2', 3, { 'db.statement': statement }),
      ],
    };

    const repeated = findRepeatedQueries(trace).repeated[0];
    expect(repeated).toMatchObject({ statement });
    expect(repeated).not.toHaveProperty('statementHash');
  });

  it('reports nothing when every statement runs once', () => {
    const trace: TraceRecord = {
      traceId: 't2',
      spans: [dbSpan('s1', 2, POSTS), dbSpan('s2', 40, COMMENTS)],
    };

    expect(findRepeatedQueries(trace).repeated).toEqual([]);
  });
});
