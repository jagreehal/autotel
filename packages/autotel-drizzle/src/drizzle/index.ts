/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import {
  asDriverObject,
  asFunction,
  asQueryClient,
  isDriverObject,
  isThenable,
  parseExplainResponse,
  readFlag,
  readMethod,
  readObject,
  readParams,
  readQueryClient,
  readQueryText,
  type DriverObject,
  type DriverValue,
  type ExplainPayload,
  type QueryCallback,
  type QueryClient,
} from './boundary';
import { SpanKind, trace, type TracerProvider } from '@opentelemetry/api';
import {
  SEMATTRS_DB_COLLECTION_NAME,
  SEMATTRS_DB_NAME,
  SEMATTRS_DB_NAMESPACE,
  SEMATTRS_DB_OPERATION,
  SEMATTRS_DB_OPERATION_NAME,
  SEMATTRS_DB_QUERY_TEXT,
  SEMATTRS_DB_STATEMENT,
  SEMATTRS_DB_STATEMENT_HASH,
  SEMATTRS_DB_SYSTEM,
  SEMATTRS_DB_SYSTEM_NAME,
  SEMATTRS_NET_PEER_NAME,
  SEMATTRS_NET_PEER_PORT,
} from '../common/constants';
import { finalizeSpan, runWithSpan } from 'autotel/trace-helpers';

const SEMATTRS_DB_PLAN_NODE = 'db.plan.node';
const SEMATTRS_DB_PLAN_INDEXES = 'db.plan.indexes';
const SEMATTRS_DB_PLAN_COST = 'db.plan.cost';
const SEMATTRS_DB_PLAN_ROWS_ESTIMATED = 'db.plan.rows_estimated';
const SEMATTRS_DB_PLAN_ROWS_EXAMINED = 'db.plan.rows_examined';
const SEMATTRS_DB_PLAN_ROWS_RETURNED = 'db.plan.rows_returned';
const SEMATTRS_DB_PLAN_BLOCKS = 'db.plan.blocks';
const SEMATTRS_DB_PLAN_EXECUTION_MS = 'db.plan.execution_ms';
const SEMATTRS_DB_PLAN_SEQ_SCAN = 'db.plan.seq_scan';
const SEMATTRS_DB_PLAN_HASH = 'db.plan.hash';

const TRANSACTION_ATTRIBUTE = 'db.transaction';
const REENTRY_FLAG = `${'__autotelDrizzleInstrumented'}:running` as const;

const DEFAULT_TRACER_NAME = 'autotel-plugins/drizzle';
const DEFAULT_DB_SYSTEM = 'postgresql';
const INSTRUMENTED_FLAG = '__autotelDrizzleInstrumented' as const;
const PREPARED_QUERY_METHODS = [
  'all',
  'execute',
  'get',
  'run',
  'values',
] as const;

type AttributeValue = string | number | boolean;
type AttributeMap = Record<string, AttributeValue>;

/**
 * Drizzle's driver objects, as this instrumentation reaches into them. Their
 * members are read through the guarded accessors in ./boundary, because drizzle
 * exports no types for the dialect-specific classes being wrapped.
 */
type InstrumentableObject = DriverObject;

type DrizzleSessionLike = DriverObject;

/**
 * How much the query planner is asked to reveal.
 *
 * - `'plan'` runs `EXPLAIN`, which plans the statement without running it. One
 *   extra round trip per query, nothing executed twice.
 * - `'analyze'` runs `EXPLAIN (ANALYZE, BUFFERS)`, which executes the
 *   statement a second time to measure it. It reports the rows actually read
 *   rather than the planner's estimate, and it is restricted to read-only
 *   statements so an insert or update never runs twice.
 *
 * Both modes double the round trips to the database. Turn them on in
 * development, in CI, or behind a sample of production traffic.
 */
export type ExplainMode = 'plan' | 'analyze';

/**
 * Which OpenTelemetry database attribute names to emit.
 *
 * The database conventions were renamed (`db.statement` became
 * `db.query.text`, `db.system` became `db.system.name`, and so on) and the
 * old names still ship by default so existing dashboards keep working.
 *
 * - `'legacy'` emits the old names only.
 * - `'stable'` emits the current names only.
 * - `'dup'` emits both, which is what the migration period is for.
 *
 * Left unset, this follows OpenTelemetry's own switch,
 * `OTEL_SEMCONV_STABILITY_OPT_IN`: `database` selects `'stable'` and
 * `database/dup` selects `'dup'`.
 */
export type SemconvMode = 'legacy' | 'stable' | 'dup';

export interface InstrumentDrizzleConfig {
  tracerName?: string;
  dbSystem?: string;
  dbName?: string;
  captureQueryText?: boolean;
  maxQueryTextLength?: number;
  peerName?: string;
  peerPort?: number;
  /**
   * Capture the postgres query plan on each span, so a trace records what the
   * database did and not only what it was asked for. Off by default. Ignored
   * unless `dbSystem` is `'postgresql'`.
   */
  explain?: ExplainMode | false;
  /**
   * Which database attribute names to emit. Defaults to whatever
   * `OTEL_SEMCONV_STABILITY_OPT_IN` asks for, and to `'legacy'` when that is
   * unset.
   */
  semconv?: SemconvMode;
  /**
   * Where spans are created. Defaults to the globally registered provider,
   * which is what an application wants. Pass one to send this client's spans
   * to a provider of your own, or to hand a test a provider it can read back.
   */
  tracerProvider?: TracerProvider;
  /**
   * Open a span around each transaction, covering the whole callback rather
   * than the statements inside it. That span is how long the transaction held
   * its connection and its locks, including the time your code spent between
   * statements. On by default.
   */
  traceTransactions?: boolean;
}

interface ResolvedConfig {
  tracerProvider?: TracerProvider;
  semconv: SemconvMode;
  traceTransactions: boolean;
  tracerName: string;
  dbSystem: string;
  dbName?: string;
  captureQueryText: boolean;
  maxQueryTextLength: number;
  peerName?: string;
  peerPort?: number;
  explain: ExplainMode | false;
}

interface InstrumentationState {
  tracer: ReturnType<typeof trace.getTracer>;
  config: ResolvedConfig;
  /** Fallback client for EXPLAIN when the traced object carries none. */
  explainClient?: QueryClient;
}

interface MethodInstrumentationOptions {
  flagSuffix: string;
  queryText: (args: any[]) => string | undefined;
  callbackStyle?: 'last-arg';
  extraAttributes?: AttributeMap;
  /** Bound values for the statement, so EXPLAIN plans the query as it runs. */
  explainParams?: (args: DriverValue[]) => DriverValue;
  /**
   * Skip the span when this object is already running one of its own traced
   * methods. See the guard in instrumentMethod.
   */
  guardReentry?: boolean;
}

/**
 * Reads OpenTelemetry's own migration switch. The spec defines
 * `OTEL_SEMCONV_STABILITY_OPT_IN` as a comma-separated list, where `database`
 * means emit the current names and `database/dup` means emit both.
 */
function semconvFromEnvironment(): SemconvMode {
  const optIn = process.env.OTEL_SEMCONV_STABILITY_OPT_IN;

  if (!optIn) {
    return 'legacy';
  }

  const entries = new Set(optIn.split(',').map((entry) => entry.trim()));

  if (entries.has('database/dup')) {
    return 'dup';
  }

  if (entries.has('database')) {
    return 'stable';
  }

  return 'legacy';
}

/**
 * An identifier, however the dialect quotes one. postgres and sqlite use
 * double quotes, mysql uses backticks, and an unquoted name is legal in all of
 * them. A leading `schema.` is dropped so the same table groups under one name
 * whether or not the statement qualified it.
 */
const IDENTIFIER =
  '(?:"(?:[^"]+"\\.")?(?<dquoted>[^"]+)"|`(?:[^`]+`\\.`)?(?<backticked>[^`]+)`|(?:[A-Za-z_][\\w$]*\\.)?(?<bare>[A-Za-z_][\\w$]*))';

function tablePattern(prefix: string): RegExp {
  return new RegExp(String.raw`\b${prefix}\s+${IDENTIFIER}`, 'iu');
}

const TABLE_PATTERNS = [
  tablePattern(String.raw`insert\s+into`),
  tablePattern(String.raw`update(?:\s+only)?`),
  tablePattern(String.raw`delete\s+from(?:\s+only)?`),
  tablePattern(String.raw`from(?:\s+only)?`),
];

/**
 * The table a statement is aimed at, for `db.collection.name`. This is a
 * deliberately shallow read of the SQL: it names the first table the statement
 * touches so spans can be grouped by table, and gives up rather than guessing
 * on anything it does not recognise. A join reports the driving table, and a
 * statement it cannot parse reports nothing.
 */
function extractTableName(queryText: string): string | undefined {
  for (const pattern of TABLE_PATTERNS) {
    const groups = pattern.exec(queryText)?.groups;
    const name = groups?.dquoted ?? groups?.backticked ?? groups?.bare;

    if (name !== undefined) {
      return name;
    }
  }

  return undefined;
}

function resolveConfig(config?: InstrumentDrizzleConfig): ResolvedConfig {
  return {
    tracerName: config?.tracerName ?? DEFAULT_TRACER_NAME,
    dbSystem: config?.dbSystem ?? DEFAULT_DB_SYSTEM,
    dbName: config?.dbName,
    captureQueryText: config?.captureQueryText ?? true,
    maxQueryTextLength: config?.maxQueryTextLength ?? 1000,
    peerName: config?.peerName,
    peerPort: config?.peerPort,
    tracerProvider: config?.tracerProvider,
    semconv: config?.semconv ?? semconvFromEnvironment(),
    traceTransactions: config?.traceTransactions ?? true,
    // EXPLAIN output is parsed as postgres JSON, so other dialects opt out
    // rather than sending syntax their server would reject.
    explain:
      (config?.dbSystem ?? DEFAULT_DB_SYSTEM) === 'postgresql'
        ? (config?.explain ?? false)
        : false,
  };
}

function getState(config?: InstrumentDrizzleConfig): InstrumentationState {
  const resolved = resolveConfig(config);
  return {
    config: resolved,
    tracer:
      resolved.tracerProvider?.getTracer(resolved.tracerName) ??
      trace.getTracer(resolved.tracerName),
  };
}

/**
 * The sessions hanging off a drizzle database or transaction. Drivers expose
 * one at `.session`, `._.session`, or both, and both names can point at the
 * same object, so the caller sees each session once.
 */
function readSessions(target: DriverValue): DriverObject[] {
  if (!isDriverObject(target)) {
    return [];
  }

  const found: DriverObject[] = [];
  const direct = readObject(target, 'session');
  const underscore = readObject(target, '_');
  const nested =
    underscore === undefined ? undefined : readObject(underscore, 'session');

  for (const session of [direct, nested]) {
    if (session !== undefined && !found.includes(session)) {
      found.push(session);
    }
  }

  return found;
}

/** Records that this object's methods are wrapped, so a repeat call is a no-op. */
function markInstrumented(target: DriverObject): void {
  target[INSTRUMENTED_FLAG] = true;
}

/** The receiver a wrapped driver method was called on. */
function readSelf(self: DriverValue): DriverObject | undefined {
  return isDriverObject(self) ? self : undefined;
}

function getFlagKey(suffix: string): string {
  return `${INSTRUMENTED_FLAG}:${suffix}`;
}

/**
 * True once prepareQuery on this object has been wrapped, including by an
 * earlier instrumentDrizzleClient() call. Read the flag rather than the return
 * value of instrumentPrepareQuery, which reports "wrapped just now" and goes
 * false on every repeat call.
 */
function hasInstrumentedPrepareQuery(target: InstrumentableObject): boolean {
  return Boolean(target[getFlagKey('prepareQuery')]);
}

const QUERY_ENTRY_FLAGS = [
  'prepareQuery',
  'session:query',
  'session:execute',
  'transaction:query',
  'transaction:execute',
] as const;

/**
 * True when some method on this object already opens a span for the queries it
 * runs. Callers use it to decide whether the layer above needs to trace, so it
 * has to answer "is instrumented", not "was instrumented on this call": every
 * instrument* function returns false the second time it runs, and a drizzle
 * transaction target gets visited twice (once from the wrapped db.transaction,
 * once from the wrapped session.transaction).
 */
function coversQueries(target: InstrumentableObject): boolean {
  return QUERY_ENTRY_FLAGS.some((suffix) =>
    Boolean(target[getFlagKey(suffix)]),
  );
}

function sanitizeQueryText(queryText: string, maxLength: number): string {
  if (queryText.length <= maxLength) {
    return queryText;
  }

  return `${queryText.slice(0, Math.max(0, maxLength))}...`;
}

/**
 * Stable sha1 of a parameterised SQL statement, used as `db.statement.hash`.
 * Hashes the full original text (not the truncated form) so the hash is
 * identical for queries that only differ in trailing length. We keep this
 * cheap (sha1, hex, take 16 chars) — the goal is grouping, not crypto.
 */
function hashQueryText(queryText: string): string {
  return createHash('sha1').update(queryText).digest('hex').slice(0, 16);
}

function extractOperation(queryText: string): string | undefined {
  const trimmed = queryText.trimStart();
  const match = /^(?<operation>\w+)/u.exec(trimmed);
  return match?.groups?.operation?.toUpperCase();
}

/**
 * A statement that only reads. `EXPLAIN ANALYZE` executes what it measures, so
 * anything that could write is never run through it: the cost of being wrong
 * here is a duplicated insert, not a missing attribute.
 *
 * Leading CTEs are the trap. `WITH x AS (...) SELECT` reads, while
 * `WITH x AS (DELETE ... RETURNING *) SELECT` deletes, and both open with the
 * same keyword, so a WITH statement qualifies only when no writing keyword
 * appears anywhere in it.
 */
function isReadOnlyStatement(queryText: string): boolean {
  const operation = extractOperation(queryText);

  if (operation === 'SELECT') {
    return !WRITE_KEYWORDS.test(queryText);
  }

  if (operation === 'WITH') {
    return !WRITE_KEYWORDS.test(queryText);
  }

  return false;
}

const WRITE_KEYWORDS =
  /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE)\b/iu;

function buildExplainStatement(mode: ExplainMode, queryText: string): string {
  const options =
    mode === 'analyze' ? 'ANALYZE, BUFFERS, FORMAT JSON' : 'FORMAT JSON';

  return `EXPLAIN (${options}) ${queryText}`;
}

/**
 * What a captured query plan puts on a span. Declared field by field rather
 * than as a free-form bag, so the attribute set a backend can group and filter
 * by is a contract rather than whatever the last edit happened to write.
 */
interface PlanAttributes {
  [SEMATTRS_DB_PLAN_NODE]?: string;
  [SEMATTRS_DB_PLAN_INDEXES]?: string;
  [SEMATTRS_DB_PLAN_COST]?: number;
  [SEMATTRS_DB_PLAN_ROWS_ESTIMATED]?: number;
  [SEMATTRS_DB_PLAN_ROWS_EXAMINED]?: number;
  [SEMATTRS_DB_PLAN_ROWS_RETURNED]?: number;
  [SEMATTRS_DB_PLAN_BLOCKS]?: number;
  [SEMATTRS_DB_PLAN_EXECUTION_MS]?: number;
  [SEMATTRS_DB_PLAN_SEQ_SCAN]?: boolean;
  [SEMATTRS_DB_PLAN_HASH]?: string;
}

/**
 * Turns a decoded plan into span attributes. The set is deliberately small:
 * enough to answer whether an index was used, how much of the table was read,
 * and whether the plan changed, without shipping the whole tree.
 */
function planAttributes(
  payload: ExplainPayload,
  mode: ExplainMode,
): PlanAttributes {
  const attributes: PlanAttributes = {};
  const [root] = payload.nodes;

  if (root === undefined) {
    return attributes;
  }

  const nodeTypes: string[] = [];
  const indexes: string[] = [];
  let rowsExamined = 0;
  let blocks = 0;
  let sawSeqScan = false;

  for (const node of payload.nodes) {
    if (node.nodeType !== undefined) {
      nodeTypes.push(node.nodeType);
      sawSeqScan ||= node.nodeType === 'Seq Scan';
    }

    if (node.indexName !== undefined && !indexes.includes(node.indexName)) {
      indexes.push(node.indexName);
    }

    // Rows examined is counted at the leaves only. A parent node reports the
    // rows its children handed up, so adding every level together counts the
    // same row once per level of the tree.
    if (node.isLeaf) {
      rowsExamined += node.actualRows;
      // Rows the scan read and then threw away. This is the gap an index
      // closes, and it is invisible in the row count the query returns.
      rowsExamined += node.rowsRemovedByFilter;
      rowsExamined += node.rowsRemovedByIndexRecheck;
    }

    // Cached blocks count as work. Reporting only the blocks read from disk
    // shows zero for a table that happens to be in memory, which reads as
    // "touched nothing" when the scan walked the whole heap.
    blocks += node.sharedHitBlocks;
    blocks += node.sharedReadBlocks;
  }

  if (root.nodeType !== undefined) {
    attributes[SEMATTRS_DB_PLAN_NODE] = root.nodeType;
  }

  if (root.totalCost !== undefined) {
    attributes[SEMATTRS_DB_PLAN_COST] = root.totalCost;
  }

  if (root.planRows !== undefined) {
    attributes[SEMATTRS_DB_PLAN_ROWS_ESTIMATED] = root.planRows;
  }

  if (indexes.length > 0) {
    attributes[SEMATTRS_DB_PLAN_INDEXES] = indexes.join(',');
  }

  // A plan that reads a whole table is the single most useful thing to filter
  // a trace by, so it gets its own boolean rather than hiding inside the hash.
  attributes[SEMATTRS_DB_PLAN_SEQ_SCAN] = sawSeqScan;

  // Same statement, different hash, means the planner changed its mind. That
  // is the comparison an index change is judged on.
  attributes[SEMATTRS_DB_PLAN_HASH] = hashQueryText(nodeTypes.join('>'));

  if (mode === 'analyze') {
    attributes[SEMATTRS_DB_PLAN_ROWS_EXAMINED] = rowsExamined;
    attributes[SEMATTRS_DB_PLAN_ROWS_RETURNED] = root.actualRows;
    attributes[SEMATTRS_DB_PLAN_BLOCKS] = blocks;

    if (payload.executionMs !== undefined) {
      attributes[SEMATTRS_DB_PLAN_EXECUTION_MS] = payload.executionMs;
    }
  }

  return attributes;
}

/**
 * The connection EXPLAIN should run on. drizzle hangs the live client off the
 * prepared query, and inside a transaction that is the transaction's own
 * connection: planning there sees the uncommitted rows the query will see.
 * The pool from `db.$client` is the fallback.
 */
function resolveExplainClient(
  target: DriverValue,
  state: InstrumentationState,
): QueryClient | undefined {
  return readQueryClient(target) ?? state.explainClient;
}

/**
 * Runs EXPLAIN on the client that is about to run the query and returns the
 * attributes for its span. Returns nothing rather than throwing: a plan is
 * commentary on a query, and failing to collect it must never fail the query.
 */
async function collectPlan(
  state: InstrumentationState,
  client: QueryClient | undefined,
  queryText: string,
  params: DriverValue,
): Promise<PlanAttributes | undefined> {
  const mode = state.config.explain;

  if (!mode || client === undefined) {
    return undefined;
  }

  if (mode === 'analyze' && !isReadOnlyStatement(queryText)) {
    return undefined;
  }

  try {
    const result = await client.query(
      buildExplainStatement(mode, queryText),
      readParams(params),
    );
    const payload = parseExplainResponse(result);

    if (payload === undefined) {
      return undefined;
    }

    return planAttributes(payload, mode);
  } catch {
    // An unplannable statement, a driver that does not take raw SQL, a
    // permissions error: the query still runs and still gets its span.
    return undefined;
  }
}

function buildSpan(
  state: InstrumentationState,
  queryText: string | undefined,
  extraAttributes?: AttributeMap,
) {
  const operation = queryText ? extractOperation(queryText) : undefined;
  const spanName = operation
    ? `drizzle.${operation.toLowerCase()}`
    : 'drizzle.query';
  const span = state.tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
  const { semconv } = state.config;
  const legacy = semconv !== 'stable';
  const stable = semconv !== 'legacy';

  /** Writes one value under whichever names the configured mode asks for. */
  const setRenamed = (
    legacyKey: string,
    stableKey: string,
    value: AttributeValue,
  ) => {
    if (legacy) {
      span.setAttribute(legacyKey, value);
    }

    if (stable) {
      span.setAttribute(stableKey, value);
    }
  };

  setRenamed(
    SEMATTRS_DB_SYSTEM,
    SEMATTRS_DB_SYSTEM_NAME,
    state.config.dbSystem,
  );

  if (operation) {
    setRenamed(SEMATTRS_DB_OPERATION, SEMATTRS_DB_OPERATION_NAME, operation);
  }

  if (state.config.dbName !== undefined) {
    setRenamed(SEMATTRS_DB_NAME, SEMATTRS_DB_NAMESPACE, state.config.dbName);
  }

  if (queryText !== undefined) {
    // The hash always lives on the span, even when captureQueryText is off for
    // privacy or size, so query grouping still works.
    span.setAttribute(SEMATTRS_DB_STATEMENT_HASH, hashQueryText(queryText));

    // The table is read from the SQL rather than the query builder, so raw
    // db.execute() calls are grouped by table alongside builder calls.
    const table = extractTableName(queryText);

    if (table !== undefined) {
      span.setAttribute(SEMATTRS_DB_COLLECTION_NAME, table);
    }
  }

  if (state.config.captureQueryText && queryText !== undefined) {
    const statement = sanitizeQueryText(
      queryText,
      state.config.maxQueryTextLength,
    );

    setRenamed(SEMATTRS_DB_STATEMENT, SEMATTRS_DB_QUERY_TEXT, statement);
  }

  if (state.config.peerName !== undefined) {
    span.setAttribute(SEMATTRS_NET_PEER_NAME, state.config.peerName);
  }

  if (state.config.peerPort !== undefined) {
    span.setAttribute(SEMATTRS_NET_PEER_PORT, state.config.peerPort);
  }

  if (extraAttributes) {
    for (const [key, value] of Object.entries(extraAttributes)) {
      span.setAttribute(key, value);
    }
  }

  return span;
}

function executeWithSpan<T>(span: any, fn: () => T): T {
  return runWithSpan(span, () => {
    try {
      const result = fn();

      if (isThenable(result)) {
        // SAFETY: isPromiseLike narrowed the result to a thenable, so the
        // assertion inside this call only restates what the guard established.
        return result.then(
          (value) => {
            finalizeSpan(span);
            return value;
          },
          (error) => {
            finalizeSpan(span, error);
            throw error;
          },
        ) as T;
      }

      finalizeSpan(span);
      return result;
    } catch (error) {
      finalizeSpan(span, error);
      throw error;
    }
  });
}

function instrumentMethod(
  target: InstrumentableObject,
  methodName: string,
  state: InstrumentationState,
  options: MethodInstrumentationOptions,
): boolean {
  const originalMethod = readMethod(target, methodName);

  if (originalMethod === undefined) {
    return false;
  }

  const flagKey = getFlagKey(options.flagSuffix);

  if (readFlag(target, flagKey)) {
    return false;
  }

  target[methodName] = function instrumentedMethod(
    this: any,
    ...incomingArgs: any[]
  ) {
    const args = [...incomingArgs];
    // Some drivers take a node-style callback as their final argument. It is
    // popped so the span can finish when the driver calls it.
    const trailing =
      options.callbackStyle === 'last-arg'
        ? asFunction(args.at(-1))
        : undefined;
    const callback =
      trailing === undefined ? undefined : (args.pop(), trailing);

    // A prepared query can run one of its own traced methods to do the work of
    // another. better-sqlite3 and bun-sqlite both answer all() by calling
    // this.values(), which traced one round trip as two spans. The flag is set
    // and cleared around the synchronous call, which is the only shape this
    // delegation takes: the async dialects hand off to a different object, and
    // clearing before any promise settles leaves concurrent executions of a
    // reused prepared statement with a span each.
    if (options.guardReentry && target[REENTRY_FLAG]) {
      return originalMethod.call(this, ...incomingArgs);
    }

    const queryText = options.queryText(args);

    // The plan is collected before the span opens, so the round trip that
    // fetches it never lands in the duration the span reports. A traced query
    // measures the query.
    if (state.config.explain && queryText !== undefined && !callback) {
      return collectPlan(
        state,
        resolveExplainClient(readSelf(this), state),
        queryText,
        options.explainParams?.(args),
      ).then((planAttributes) =>
        executeWithSpan(
          buildSpan(state, queryText, {
            ...options.extraAttributes,
            ...planAttributes,
          }),
          () => originalMethod.call(this, ...args),
        ),
      );
    }

    const span = buildSpan(state, queryText, options.extraAttributes);

    if (callback) {
      return runWithSpan(span, () => {
        const wrappedCallback: QueryCallback = (error, result) => {
          finalizeSpan(span, error);
          callback(error, result);
        };

        try {
          return originalMethod.call(this, ...args, wrappedCallback);
        } catch (error) {
          finalizeSpan(span, error);
          throw error;
        }
      });
    }

    return executeWithSpan(span, () => {
      if (!options.guardReentry) {
        return originalMethod.call(this, ...args);
      }

      target[REENTRY_FLAG] = true;

      try {
        return originalMethod.call(this, ...args);
      } finally {
        target[REENTRY_FLAG] = false;
      }
    });
  };

  target[flagKey] = true;
  return true;
}

function instrumentPreparedQuery(
  prepared: DriverValue,
  state: InstrumentationState,
  querySource: DriverValue,
  extraAttributes?: AttributeMap,
): boolean {
  if (!isDriverObject(prepared)) {
    return false;
  }

  let instrumented = false;
  const queryText = readQueryText(querySource);

  for (const methodName of PREPARED_QUERY_METHODS) {
    instrumented =
      instrumentMethod(prepared, methodName, state, {
        flagSuffix: `prepared:${methodName}`,
        queryText: () => queryText,
        extraAttributes,
        guardReentry: true,
        explainParams: () =>
          isDriverObject(querySource) ? querySource.params : undefined,
      }) || instrumented;
  }

  return instrumented;
}

function instrumentPrepareQuery(
  target: DrizzleSessionLike,
  state: InstrumentationState,
  extraAttributes?: AttributeMap,
): boolean {
  const originalPrepareQuery = readMethod(target, 'prepareQuery');

  if (originalPrepareQuery === undefined) {
    return false;
  }

  const flagKey = getFlagKey('prepareQuery');

  if (readFlag(target, flagKey)) {
    return false;
  }

  target.prepareQuery = function instrumentedPrepareQuery(
    this: any,
    ...prepareArgs: any[]
  ) {
    const prepared = originalPrepareQuery.call(this, ...prepareArgs);
    instrumentPreparedQuery(prepared, state, prepareArgs[0], extraAttributes);
    return prepared;
  };

  target[flagKey] = true;
  return true;
}

function instrumentTransactionTarget(
  target: DriverValue,
  state: InstrumentationState,
): boolean {
  if (!isDriverObject(target)) {
    return false;
  }

  const transactionAttributes = { [TRANSACTION_ATTRIBUTE]: true };
  let instrumented = false;

  // The transaction's own session goes first. A drizzle transaction carries a
  // session bound to the transaction's connection, and tx.execute() dispatches
  // into it, so the parent's direct methods are wrapped only when no session
  // below them took the job.
  let sessionInstrumented = false;

  for (const session of readSessions(target)) {
    instrumentTransactionTarget(session, state);
    sessionInstrumented = coversQueries(session) || sessionInstrumented;
  }

  instrumented = sessionInstrumented || instrumented;

  // SAFETY: a transaction target exposes the same session surface as the
  // connection it was opened on; only prepareQuery is read from it.
  instrumented =
    instrumentPrepareQuery(
      target as DrizzleSessionLike,
      state,
      transactionAttributes,
    ) || instrumented;

  if (!sessionInstrumented && !hasInstrumentedPrepareQuery(target)) {
    instrumented =
      instrumentMethod(target, 'query', state, {
        flagSuffix: 'transaction:query',
        queryText: (args) => readQueryText(args[0]),
        explainParams: (args) => readParams(args[0]),
        callbackStyle: 'last-arg',
        extraAttributes: transactionAttributes,
      }) || instrumented;

    instrumented =
      instrumentMethod(target, 'execute', state, {
        flagSuffix: 'transaction:execute',
        queryText: (args) => readQueryText(args[0]),
        explainParams: (args) => readParams(args[0]),
        callbackStyle: 'last-arg',
        extraAttributes: transactionAttributes,
      }) || instrumented;
  }

  return instrumented;
}

function instrumentSession(
  session: DrizzleSessionLike,
  state: InstrumentationState,
  allowDirectMethods = true,
): boolean {
  let instrumented = false;

  // prepareQuery is claimed first. PgSession.prototype.execute() compiles the
  // statement and then dispatches to this.prepareQuery(), so a session that
  // exposes both routes one round trip through two wrappable methods.
  instrumented = instrumentPrepareQuery(session, state) || instrumented;

  // `allowDirectMethods` is false when this object sits above a session that
  // is already instrumented. drizzle funnels db.execute() and tx.execute()
  // into that session, so wrapping both layers traces one query twice: once
  // here (before the SQL template has been compiled, so the span carries no
  // db.statement and no db.operation) and once on the session below.
  if (allowDirectMethods && !hasInstrumentedPrepareQuery(session)) {
    instrumented =
      instrumentMethod(session, 'query', state, {
        flagSuffix: 'session:query',
        queryText: (args) => readQueryText(args[0]),
        explainParams: (args) => readParams(args[0]),
        callbackStyle: 'last-arg',
      }) || instrumented;

    instrumented =
      instrumentMethod(session, 'execute', state, {
        flagSuffix: 'session:execute',
        queryText: (args) => readQueryText(args[0]),
        explainParams: (args) => readParams(args[0]),
        callbackStyle: 'last-arg',
      }) || instrumented;
  }

  // Only the layer that owns the queries wraps transaction. db.transaction()
  // calls session.transaction(), so wrapping both would nest one transaction
  // span inside an identical one.
  const originalTransaction = readMethod(session, 'transaction');

  if (allowDirectMethods && originalTransaction !== undefined) {
    const flagKey = getFlagKey('session:transaction');

    if (!readFlag(session, flagKey)) {
      session.transaction = function instrumentedTransaction(
        this: DriverValue,
        ...transactionArgs: DriverValue[]
      ): DriverValue {
        const [rawCallback, ...restArgs] = transactionArgs;
        const callback = asFunction(rawCallback);

        if (callback === undefined) {
          return originalTransaction.call(this, ...transactionArgs);
        }

        const wrappedCallback = (
          tx: DriverValue,
          ...callbackArgs: DriverValue[]
        ) => {
          instrumentTransactionTarget(tx, state);
          return callback.call(this, tx, ...callbackArgs);
        };

        const runTransaction = () =>
          originalTransaction.call(this, wrappedCallback, ...restArgs);

        if (!state.config.traceTransactions) {
          return runTransaction();
        }

        // This span covers the whole callback, so it measures how long the
        // transaction held its connection and its locks. That includes the
        // time your own code spent between statements, which is the part a
        // per-statement span cannot show you.
        const span = state.tracer.startSpan('drizzle.transaction', {
          kind: SpanKind.CLIENT,
        });

        span.setAttribute(TRANSACTION_ATTRIBUTE, true);

        if (state.config.dbName !== undefined) {
          span.setAttribute(
            state.config.semconv === 'stable'
              ? SEMATTRS_DB_NAMESPACE
              : SEMATTRS_DB_NAME,
            state.config.dbName,
          );
        }

        return executeWithSpan(span, runTransaction);
      };

      session[flagKey] = true;
      instrumented = true;
    }
  }

  if (instrumented) {
    session[INSTRUMENTED_FLAG] = true;
  }

  return instrumented;
}

export function instrumentDrizzle<TClient>(
  client: TClient,
  config?: InstrumentDrizzleConfig,
): TClient {
  const target = asDriverObject(client);

  if (target === undefined) {
    return client;
  }

  const state = getState(config);
  let instrumented = false;

  instrumented =
    instrumentMethod(target, 'query', state, {
      flagSuffix: 'client:query',
      queryText: (args) => readQueryText(args[0]),
      explainParams: (args) => readParams(args[0]),
      callbackStyle: 'last-arg',
    }) || instrumented;

  instrumented =
    instrumentMethod(target, 'execute', state, {
      flagSuffix: 'client:execute',
      queryText: (args) => readQueryText(args[0]),
      explainParams: (args) => readParams(args[0]),
      callbackStyle: 'last-arg',
    }) || instrumented;

  if (instrumented) {
    markInstrumented(target);
  }

  return client;
}

export function instrumentDrizzleClient<TDb>(
  db: TDb,
  config?: InstrumentDrizzleConfig,
): TDb {
  const target = asDriverObject(db);

  if (target === undefined) {
    return db;
  }

  if (readFlag(target, INSTRUMENTED_FLAG)) {
    return db;
  }

  const state = getState(config);
  state.explainClient = asQueryClient(target.$client);
  let instrumented = false;

  // The real session objects go first. Whether one of them was instrumented
  // decides if the db-level execute()/query() would duplicate work: drizzle
  // routes every db.execute() through session.prepareQuery(), so tracing both
  // layers emits two spans for one round trip.
  let sessionInstrumented = false;

  for (const session of readSessions(target)) {
    instrumented = instrumentSession(session, state) || instrumented;
    sessionInstrumented = coversQueries(session) || sessionInstrumented;
  }

  // SAFETY: some drivers expose the session's methods on the db object itself
  // rather than under `.session`; instrumentSession probes for each method
  // before wrapping it, so a db without them is left untouched.
  instrumented =
    instrumentSession(target, state, !sessionInstrumented) || instrumented;

  // Intentionally do NOT instrument db.$client here. The raw client (e.g.
  // pg.Pool) is the same object that drizzle's session invokes internally from
  // its prepared query's execute(). Wrapping both layers produces nested
  // duplicate spans for every query. Users who need to trace a standalone
  // client without a drizzle wrapper should call `instrumentDrizzle` directly.

  if (instrumented) {
    markInstrumented(target);
  }

  return db;
}
