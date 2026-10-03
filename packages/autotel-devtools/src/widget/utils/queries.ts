/**
 * The Queries tab's reading of database spans: which statements ran, how often,
 * how slowly, and what the database did to answer them.
 *
 * The grouping itself is autotel-db's `groupQueries`, the same one the MCP
 * server's repeated-queries tool uses, so "the same query" means one thing
 * everywhere. What lives here is presentation: severity, trend buckets, and
 * how a statement is laid out.
 */
import { groupQueries, queryIdentity, type QueryGroup } from 'autotel-db';
import type { MetricPoint } from '../../server/metric-streams';
import type { TraceData } from '../types';

export type { QueryGroup } from 'autotel-db';

export function buildQueryGroups(traces: readonly TraceData[]): QueryGroup[] {
  return groupQueries(
    traces.flatMap((trace) =>
      trace.spans.map((span) => ({
        traceId: span.traceId,
        spanId: span.spanId,
        startMs: span.startTime,
        durationMs: span.duration,
        attributes: span.attributes,
        scope: span.scope?.name,
      })),
    ),
  );
}

export type Severity = 'ok' | 'warn' | 'bad';

/**
 * How much a read examined for what it returned. 20 to 1 is worth a look; 500
 * to 1 is a query reading a table to find a handful of rows. The thresholds
 * follow MongoDB's guidance on examined-to-returned ratios.
 */
export function examinedSeverity(examined: number, returned: number): Severity {
  const ratio = examined / Math.max(returned, 1);
  if (ratio >= 500) return 'bad';
  if (ratio >= 20) return 'warn';
  return 'ok';
}

export function examinedRatioLabel(examined: number, returned: number): string {
  const ratio = examined / Math.max(returned, 1);
  return `${ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10}:1`;
}

/** Group sort keys, worst first for each. */
export type QuerySort = 'total' | 'count' | 'avg' | 'p95' | 'plan';

/** A group's plan as a rank: full scans first, then unexplained, then indexed. */
function planRank(group: QueryGroup): number {
  if (group.fullScanCount > 0) return 0;
  if (!group.plan) return 1;
  return 2;
}

export function sortQueryGroups(
  groups: readonly QueryGroup[],
  sort: QuerySort,
): QueryGroup[] {
  const by: Record<QuerySort, (a: QueryGroup, b: QueryGroup) => number> = {
    total: (a, b) => b.totalMs - a.totalMs,
    count: (a, b) => b.count - a.count,
    avg: (a, b) => b.avgMs - a.avgMs,
    p95: (a, b) => b.p95Ms - a.p95Ms,
    plan: (a, b) => planRank(a) - planRank(b) || b.totalMs - a.totalMs,
  };
  return [...groups].sort(by[sort]);
}

/** Runs per bucket across `[from, to]`, as the points Sparkline draws. */
export function trendPoints(
  starts: readonly number[],
  from: number,
  to: number,
  buckets = 24,
): MetricPoint[] {
  const span = Math.max(to - from, 1);
  const counts = Array.from({ length: buckets }, () => 0);
  for (const start of starts) {
    const index = Math.min(
      buckets - 1,
      Math.floor(((start - from) / span) * buckets),
    );
    if (index >= 0) counts[index]! += 1;
  }
  return counts.map((value, index) => ({
    timestamp: from + (span / buckets) * index,
    value,
    attributes: {},
  }));
}

/**
 * A statement laid out for reading. MongoDB statements are JSON and read
 * better indented; SQL is shown as written.
 */
export function prettyStatement(statement: string): {
  text: string;
  isJson: boolean;
} {
  const trimmed = statement.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return {
        text: JSON.stringify(JSON.parse(statement), null, 2),
        isJson: true,
      };
    } catch {
      // Truncated or not JSON after all: show it as it came.
    }
  }
  return { text: statement, isJson: false };
}

/**
 * For each database span in a trace, how many spans in the same trace ran the
 * same statement, when that is more than one. The waterfall marks those rows:
 * a loop issuing one query per item is an N+1.
 */
export function repeatedStatementCounts(trace: TraceData): Map<string, number> {
  const bySpan = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const span of trace.spans) {
    const identity = queryIdentity(span.attributes);
    if (identity === undefined) continue;
    bySpan.set(span.spanId, identity);
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  const repeated = new Map<string, number>();
  for (const [spanId, identity] of bySpan) {
    const count = counts.get(identity) ?? 0;
    if (count > 1) repeated.set(spanId, count);
  }
  return repeated;
}

export type StageTone = 'scan' | 'sort' | 'index' | 'other';

const SCAN_STAGES = new Set(['COLLSCAN', 'Seq Scan']);
const SORT_STAGES = new Set(['SORT', '$sort', 'Sort', 'Incremental Sort']);

/**
 * How a plan stage reads at a glance: a full scan and a blocking sort are the
 * two a missing index causes, so they stand out; index stages read as good.
 */
export function stageTone(stage: string): StageTone {
  if (SCAN_STAGES.has(stage)) return 'scan';
  if (SORT_STAGES.has(stage)) return 'sort';
  if (/IXSCAN|IDHACK|Index|COUNT_SCAN|DISTINCT_SCAN/u.test(stage))
    return 'index';
  return 'other';
}

/**
 * How a reader can get plans for spans from a given source.
 *
 * - `setup`: an autotel instrumentation that explains; one option turns it on.
 * - `manual`: the official MongoDB driver plugin, which cannot explain on its
 *   own; the plan has to be fetched and attached by the application.
 * - `unavailable`: nothing in autotel captures plans for this source.
 */
export type ExplainGuidance =
  | { kind: 'setup'; source: string; code: string }
  | { kind: 'manual'; source: string; code: string }
  | { kind: 'unavailable'; source: string; reason: string };

// Kept in a .ts file: Vite's dep scanner reads import statements inside
// .svelte strings as real imports.
// What a first run needs: telemetry flowing here, a database instrumented,
// and explain on so plans arrive with the queries.
// Mongoose shown; autotel-drizzle takes the same `explain` option.
export const SETUP = `import { init } from 'autotel';
import { instrumentMongoose } from 'autotel-mongoose';

init({ service: 'my-app', endpoint: 'http://localhost:4318' });
instrumentMongoose(mongoose, { explain: 'plan' });`;

const MANUAL_MONGODB = `import { planAttributes } from 'autotel-db';
import { planFromExplain } from 'autotel-mongodb';

const plan = planFromExplain(await cursor.explain('queryPlanner'));
if (plan) span.setAttributes(planAttributes(plan));`;

/**
 * The guidance for turning plans on, chosen by the instrumentation that
 * emitted the spans (`scope`), falling back to the database system when the
 * scope is unknown. Never suggests a library that cannot explain the source.
 */
export function explainGuidance(
  scope: string | undefined,
  system: string | undefined,
): ExplainGuidance {
  const database = system ?? 'this database';
  if (scope === 'autotel-mongoose') {
    return {
      kind: 'setup',
      source: 'autotel-mongoose',
      code: "instrumentMongoose(mongoose, { explain: 'plan' });",
    };
  }
  if (scope?.includes('drizzle')) {
    return system === undefined || system === 'postgresql'
      ? {
          kind: 'setup',
          source: 'autotel-drizzle',
          code: "instrumentDrizzleClient(db, { dbSystem: 'postgresql', explain: 'plan' });",
        }
      : {
          kind: 'unavailable',
          source: 'autotel-drizzle',
          reason: `autotel-drizzle explains Postgres only; ${database} has no plan capture yet.`,
        };
  }
  if (
    scope === '@opentelemetry/instrumentation-mongodb' ||
    (scope === undefined && system === 'mongodb')
  ) {
    return {
      kind: 'manual',
      source: 'the MongoDB driver',
      code: MANUAL_MONGODB,
    };
  }
  return {
    kind: 'unavailable',
    source: scope ?? database,
    reason:
      system === 'postgresql'
        ? 'This instrumentation does not capture plans. autotel-drizzle does, for queries made through Drizzle.'
        : `No autotel instrumentation captures ${database} plans yet.`,
  };
}

/**
 * Why a plan earned an index suggestion, in one sentence a reader can check
 * against the numbers beside it.
 */
export function indexReason(plan: {
  fullScan: boolean;
  blockingSort: boolean;
  rowsExamined?: number;
  rowsReturned?: number;
}): string {
  const problems = [
    plan.fullScan ? 'read the whole collection' : undefined,
    plan.blockingSort ? 'sorted the results in memory' : undefined,
  ].filter(Boolean);
  const what =
    problems.length > 0 ? problems.join(' and ') : 'did avoidable work';
  const counts =
    plan.rowsExamined !== undefined && plan.rowsReturned !== undefined
      ? `, examining ${plan.rowsExamined} to return ${plan.rowsReturned}`
      : '';
  return `This run ${what}${counts}.`;
}
