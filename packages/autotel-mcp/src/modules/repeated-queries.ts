import { groupQueries } from 'autotel-db';
import type { SpanRecord, TraceRecord } from '../types';

export interface RepeatedQuery {
  statementHash?: string;
  statement?: string;
  collection?: string;
  count: number;
  totalDurationMs: number;
}

export interface RepeatedQueriesResult {
  traceId: string;
  /** Statements that ran more than once, slowest total first. */
  repeated: RepeatedQuery[];
  dbSpansConsidered: number;
}

/**
 * Group a trace's database spans by statement and return the ones that ran more
 * than once.
 *
 * find_root_cause answers "which single span was slowest", which is the wrong
 * question for an N+1: there the slowest span is one cheap query among hundreds
 * and fixing it buys nothing. The count is the finding.
 *
 * The grouping is autotel-db's, the same devtools' Queries tab uses: the
 * statement hash, else the query text, else the operation on its collection.
 */
export function findRepeatedQueries(trace: TraceRecord): RepeatedQueriesResult {
  const groups = groupQueries(
    trace.spans.map((span: SpanRecord) => ({
      traceId: span.traceId,
      spanId: span.spanId,
      startMs: span.startTimeUnixMs,
      durationMs: span.durationMs,
      attributes: span.tags,
    })),
  );

  const repeated = groups
    .filter((group) => group.count > 1)
    .map((group): RepeatedQuery => {
      const query: RepeatedQuery = {
        statement: group.statement,
        collection: group.collection,
        count: group.count,
        totalDurationMs: group.totalMs,
      };
      if (group.statementHash !== undefined) {
        query.statementHash = group.statementHash;
      }
      return query;
    });

  return {
    traceId: trace.traceId,
    repeated,
    dbSpansConsidered: groups.reduce((sum, group) => sum + group.count, 0),
  };
}
