import { nonEmptyString } from '../lib/values';
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

function tagString(span: SpanRecord, key: string): string | undefined {
  return nonEmptyString(span.tags[key]);
}

/**
 * The statement's identity. `db.statement.hash` is the cheap one and survives
 * suppressed query text; the statement itself is the fallback for spans that
 * carry text but no hash.
 */
/**
 * Group a trace's database spans by statement and return the ones that ran more
 * than once.
 *
 * find_root_cause answers "which single span was slowest", which is the wrong
 * question for an N+1: there the slowest span is one cheap query among hundreds
 * and fixing it buys nothing. The count is the finding.
 */
export function findRepeatedQueries(trace: TraceRecord): RepeatedQueriesResult {
  const groups = new Map<string, RepeatedQuery>();
  let dbSpansConsidered = 0;

  for (const span of trace.spans) {
    const statementHash = tagString(span, 'db.statement.hash');
    const statement =
      tagString(span, 'db.query.text') ?? tagString(span, 'db.statement');
    const key = statementHash ?? statement;
    if (key === undefined) continue;
    dbSpansConsidered += 1;

    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.totalDurationMs += span.durationMs;
      continue;
    }
    const group: RepeatedQuery = {
      statement,
      collection: tagString(span, 'db.collection.name'),
      count: 1,
      totalDurationMs: span.durationMs,
    };
    if (statementHash !== undefined) group.statementHash = statementHash;
    groups.set(key, group);
  }

  const repeated = [...groups.values()]
    .filter((group) => group.count > 1)
    .sort((a, b) => b.totalDurationMs - a.totalDurationMs);

  return { traceId: trace.traceId, repeated, dbSpansConsidered };
}
