import {
  ATTR_DB_PLAN_BLOCKING_SORT,
  ATTR_DB_PLAN_COST,
  ATTR_DB_PLAN_ERROR,
  ATTR_DB_PLAN_EXECUTION_MS,
  ATTR_DB_PLAN_FULL_SCAN,
  ATTR_DB_PLAN_HASH,
  ATTR_DB_PLAN_INDEX_EQUALITY,
  ATTR_DB_PLAN_INDEX_RANGE,
  ATTR_DB_PLAN_INDEX_SORT,
  ATTR_DB_PLAN_INDEX_SUGGESTION,
  ATTR_DB_PLAN_INDEXES,
  ATTR_DB_PLAN_KEYS_EXAMINED,
  ATTR_DB_PLAN_MODE,
  ATTR_DB_PLAN_NODE,
  ATTR_DB_PLAN_ROWS_ESTIMATED,
  ATTR_DB_PLAN_ROWS_EXAMINED,
  ATTR_DB_PLAN_ROWS_RETURNED,
  ATTR_DB_PLAN_STAGES,
  ATTR_DB_PLAN_STATUS,
  ATTR_DB_STATEMENT_HASH,
  type ExplainMode,
  type IndexFields,
  type PlanStatus,
  sanitizePlanError,
} from './index';

function errorReason(error: string | undefined): string | undefined {
  return error === undefined
    ? undefined
    : sanitizePlanError(error) || undefined;
}

/** Span attributes as any reader holds them. */
export type SpanAttributeBag = Readonly<Record<string, unknown>>;

/** The parts of a span {@link groupQueries} reads, whatever the reader's span type. */
export interface QuerySpan {
  traceId: string;
  spanId: string;
  startMs: number;
  durationMs: number;
  attributes: SpanAttributeBag;
  /** The instrumentation that emitted the span (its scope name), if known. */
  scope?: string;
}

/**
 * What a span's `db.plan.*` attributes say, read back. `status` is
 * `captured` with the plan's facts, or `failed` / `unsupported` with only
 * `error` and `mode`.
 */
export interface PlanSummary {
  status: PlanStatus;
  mode?: ExplainMode;
  error?: string;
  node?: string;
  /** Every plan operation, root first. */
  stages: string[];
  fullScan: boolean;
  blockingSort: boolean;
  indexes: string[];
  keysExamined?: number;
  rowsExamined?: number;
  rowsReturned?: number;
  rowsEstimated?: number;
  cost?: number;
  executionMs?: number;
  planHash?: string;
  indexSuggestion?: string;
  indexFields?: IndexFields;
}

/** The run a group's plan was read from. */
export interface PlanSample {
  traceId: string;
  spanId: string;
  startMs: number;
}

/** One statement, every time it ran. */
export interface QueryGroup {
  /** What the spans were grouped by. */
  key: string;
  statementHash?: string;
  statement?: string;
  system?: string;
  /** The database (`db.namespace`): the same statement in two is two groups. */
  namespace?: string;
  /**
   * The instrumentation that emitted it, which decides how plans can be
   * turned on: an autotel instrumentation, the official driver plugin, or
   * nothing that explains.
   */
  scope?: string;
  operation?: string;
  collection?: string;
  count: number;
  totalMs: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  traceCount: number;
  /**
   * The most times the statement ran inside one trace. Above 1 it is a loop
   * issuing the query, which is what an N+1 looks like, though a legitimate
   * retry or batch looks the same.
   */
  maxPerTrace: number;
  /** The trace where it ran `maxPerTrace` times. */
  maxPerTraceTraceId: string;
  /** Runs whose plan read a whole table or collection. */
  fullScanCount: number;
  /**
   * The most recent captured plan. It describes one run, `planSample`, not
   * the group: the latencies above cover every run.
   */
  plan?: PlanSummary;
  planSample?: PlanSample;
  /**
   * Why there is no plan, when no run captured one: the latest `failed` or
   * `unsupported` explain. Neither `plan` nor this means explain is off.
   */
  planIssue?: PlanSummary;
  /** Distinct `db.plan.hash` values. More than one: the planner changed its mind. */
  planHashes: string[];
  /** Start time of every run, oldest first, for a trend line. */
  starts: number[];
  /** The slowest runs, slowest first: where to look. */
  slowest: Array<{ traceId: string; spanId: string; durationMs: number }>;
  firstSeenMs: number;
  lastSeenMs: number;
}

const SLOWEST_KEPT = 5;

function text(
  attributes: SpanAttributeBag,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function number(attributes: SpanAttributeBag, key: string): number | undefined {
  const value = attributes[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function flag(attributes: SpanAttributeBag, key: string): boolean {
  const value = attributes[key];
  return value === true || value === 'true';
}

/** A string array attribute, or a comma-separated string for older spans. */
function list(attributes: SpanAttributeBag, key: string): string[] {
  const value = attributes[key];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  return typeof value === 'string' && value.length > 0 ? value.split(',') : [];
}

const STATUSES = new Set<PlanStatus>(['captured', 'failed', 'unsupported']);
const MODES = new Set<ExplainMode>(['plan', 'analyze']);

/** A span's `db.plan.*` attributes, or `undefined` when it was never explained. */
export function readPlan(
  attributes: SpanAttributeBag,
): PlanSummary | undefined {
  const rawStatus = text(attributes, ATTR_DB_PLAN_STATUS);
  const node = text(attributes, ATTR_DB_PLAN_NODE);
  const hasFacts =
    attributes[ATTR_DB_PLAN_FULL_SCAN] !== undefined || node !== undefined;
  // A span from before `db.plan.status` existed has the facts and no status.
  const status: PlanStatus | undefined =
    rawStatus && STATUSES.has(rawStatus as PlanStatus)
      ? (rawStatus as PlanStatus)
      : hasFacts
        ? 'captured'
        : undefined;
  if (status === undefined) return undefined;

  const rawMode = text(attributes, ATTR_DB_PLAN_MODE);
  const stages = list(attributes, ATTR_DB_PLAN_STAGES);
  const suggestion = text(attributes, ATTR_DB_PLAN_INDEX_SUGGESTION);
  const equality = list(attributes, ATTR_DB_PLAN_INDEX_EQUALITY);
  const sort = list(attributes, ATTR_DB_PLAN_INDEX_SORT);
  const range = list(attributes, ATTR_DB_PLAN_INDEX_RANGE);
  return {
    status,
    mode: MODES.has(rawMode as ExplainMode)
      ? (rawMode as ExplainMode)
      : undefined,
    // Sanitised again on the way in: a span from another producer, or an
    // older one, may carry an error that still quotes values.
    error: errorReason(text(attributes, ATTR_DB_PLAN_ERROR)),
    node,
    stages: stages.length > 0 ? stages : node ? [node] : [],
    fullScan: flag(attributes, ATTR_DB_PLAN_FULL_SCAN),
    blockingSort: flag(attributes, ATTR_DB_PLAN_BLOCKING_SORT),
    indexes: list(attributes, ATTR_DB_PLAN_INDEXES),
    keysExamined: number(attributes, ATTR_DB_PLAN_KEYS_EXAMINED),
    rowsExamined: number(attributes, ATTR_DB_PLAN_ROWS_EXAMINED),
    rowsReturned: number(attributes, ATTR_DB_PLAN_ROWS_RETURNED),
    rowsEstimated: number(attributes, ATTR_DB_PLAN_ROWS_ESTIMATED),
    cost: number(attributes, ATTR_DB_PLAN_COST),
    executionMs: number(attributes, ATTR_DB_PLAN_EXECUTION_MS),
    planHash: text(attributes, ATTR_DB_PLAN_HASH),
    indexSuggestion: suggestion,
    indexFields:
      suggestion && equality.length + sort.length + range.length > 0
        ? { equality, sort, range }
        : undefined,
  };
}

/**
 * Which statement a span ran, as a grouping key: the statement hash when the
 * instrumentation set one, else the query text, else the operation on its
 * collection, scoped to the database system and namespace so the same
 * statement against two databases stays two statements. `undefined` for a
 * span that is not a database call.
 */
export function queryIdentity(
  attributes: SpanAttributeBag,
): string | undefined {
  const system = text(attributes, 'db.system.name', 'db.system');
  const scope = `${system ?? ''}|${text(attributes, 'db.namespace', 'db.name') ?? ''}`;
  const hash = text(attributes, ATTR_DB_STATEMENT_HASH);
  if (hash) return `hash:${scope}|${hash}`;
  const statement = text(attributes, 'db.query.text', 'db.statement');
  if (statement) return `text:${scope}|${statement}`;
  if (!system) return undefined;
  const operation = text(attributes, 'db.operation.name', 'db.operation') ?? '';
  const collection =
    text(attributes, 'db.collection.name', 'db.sql.table') ?? '';
  return `op:${scope}|${operation} ${collection}`;
}

type Building = QueryGroup & {
  durations: number[];
  perTrace: Map<string, number>;
};

/**
 * Group database spans by statement. Spans that are not database calls are
 * skipped. Groups come back with the most total time first, the order a
 * "what is the database costing me" list wants.
 */
export function groupQueries(spans: Iterable<QuerySpan>): QueryGroup[] {
  const groups = new Map<string, Building>();

  for (const span of spans) {
    const key = queryIdentity(span.attributes);
    if (key === undefined) continue;

    let group = groups.get(key);
    if (!group) {
      const attributes = span.attributes;
      group = {
        key,
        statementHash: text(attributes, ATTR_DB_STATEMENT_HASH),
        statement: text(attributes, 'db.query.text', 'db.statement'),
        system: text(attributes, 'db.system.name', 'db.system'),
        namespace: text(attributes, 'db.namespace', 'db.name'),
        scope: span.scope,
        operation: text(attributes, 'db.operation.name', 'db.operation'),
        collection: text(attributes, 'db.collection.name', 'db.sql.table'),
        count: 0,
        totalMs: 0,
        avgMs: 0,
        p95Ms: 0,
        maxMs: 0,
        traceCount: 0,
        maxPerTrace: 0,
        maxPerTraceTraceId: span.traceId,
        fullScanCount: 0,
        planHashes: [],
        starts: [],
        slowest: [],
        firstSeenMs: span.startMs,
        lastSeenMs: span.startMs,
        durations: [],
        perTrace: new Map(),
      };
      groups.set(key, group);
    }

    group.count += 1;
    group.totalMs += span.durationMs;
    group.maxMs = Math.max(group.maxMs, span.durationMs);
    group.durations.push(span.durationMs);
    group.starts.push(span.startMs);
    group.firstSeenMs = Math.min(group.firstSeenMs, span.startMs);
    group.lastSeenMs = Math.max(group.lastSeenMs, span.startMs);

    const inTrace = (group.perTrace.get(span.traceId) ?? 0) + 1;
    group.perTrace.set(span.traceId, inTrace);
    if (inTrace > group.maxPerTrace) {
      group.maxPerTrace = inTrace;
      group.maxPerTraceTraceId = span.traceId;
    }

    // Keeps the five slowest runs.
    group.slowest.push({
      traceId: span.traceId,
      spanId: span.spanId,
      durationMs: span.durationMs,
    });
    group.slowest.sort((a, b) => b.durationMs - a.durationMs);
    group.slowest.length = Math.min(group.slowest.length, SLOWEST_KEPT);

    const plan = readPlan(span.attributes);
    if (plan?.status === 'captured') {
      if (plan.fullScan) group.fullScanCount += 1;
      if (plan.planHash && !group.planHashes.includes(plan.planHash)) {
        group.planHashes.push(plan.planHash);
      }
      if (!group.planSample || span.startMs >= group.planSample.startMs) {
        group.plan = plan;
        group.planSample = {
          traceId: span.traceId,
          spanId: span.spanId,
          startMs: span.startMs,
        };
      }
    } else if (plan) {
      group.planIssue = plan;
    }
  }

  return [...groups.values()]
    .map(({ durations, perTrace, ...group }) => {
      durations.sort((a, b) => a - b);
      group.starts.sort((a, b) => a - b);
      return {
        ...group,
        // A captured plan answers the question a failure raised.
        planIssue: group.plan ? undefined : group.planIssue,
        avgMs: group.totalMs / group.count,
        p95Ms:
          durations[
            Math.min(
              durations.length - 1,
              Math.ceil(durations.length * 0.95) - 1,
            )
          ] ?? 0,
        traceCount: perTrace.size,
      };
    })
    .sort((a, b) => b.totalMs - a.totalMs);
}
