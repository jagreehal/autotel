/**
 * The vocabulary every autotel database instrumentation speaks when it says
 * more than "a query ran": which statement it was, and what the database did
 * to answer it.
 *
 * Instrumentations are the producers (autotel-drizzle reads Postgres EXPLAIN,
 * autotel-mongodb reads MongoDB explain()). Devtools and the MCP server are the
 * readers. Keeping the names and the hash here is what lets a reader group a
 * Mongo query and a Postgres query the same way without knowing which
 * produced it.
 *
 * No dependencies and no Node built-ins: the readers run in a browser.
 */

/**
 * Stable hash of a statement with its values already stripped. Two calls of
 * the same query share it; their raw text usually does not.
 */
export const ATTR_DB_STATEMENT_HASH = 'db.statement.hash' as const;

/** The plan's root operation: `Seq Scan`, `IXSCAN`, `FETCH`. */
export const ATTR_DB_PLAN_NODE = 'db.plan.node' as const;
/** Comma-separated names of the indexes the plan used. */
export const ATTR_DB_PLAN_INDEXES = 'db.plan.indexes' as const;
/** The planner's cost estimate, in the database's own units. */
export const ATTR_DB_PLAN_COST = 'db.plan.cost' as const;
/** Rows (documents) the planner expected to return. */
export const ATTR_DB_PLAN_ROWS_ESTIMATED = 'db.plan.rows_estimated' as const;
/** Rows (documents) the database read to answer the query. */
export const ATTR_DB_PLAN_ROWS_EXAMINED = 'db.plan.rows_examined' as const;
/** Rows (documents) the query returned. */
export const ATTR_DB_PLAN_ROWS_RETURNED = 'db.plan.rows_returned' as const;
/** Storage blocks touched, cached or not. */
export const ATTR_DB_PLAN_BLOCKS = 'db.plan.blocks' as const;
/** Server-side execution time the plan reported. */
export const ATTR_DB_PLAN_EXECUTION_MS = 'db.plan.execution_ms' as const;
/**
 * The plan read a whole table or collection: Postgres `Seq Scan`, MongoDB
 * `COLLSCAN`. The single most useful thing to filter a trace by.
 */
export const ATTR_DB_PLAN_FULL_SCAN = 'db.plan.full_scan' as const;
/**
 * Hash of the plan's operations in order. Same statement hash, different plan
 * hash, means the planner changed its mind.
 */
export const ATTR_DB_PLAN_HASH = 'db.plan.hash' as const;
/** A ready-to-run statement that creates the index this query lacked. */
export const ATTR_DB_PLAN_INDEX_SUGGESTION =
  'db.plan.index_suggestion' as const;
/** The suggested index's equality fields, in key order. */
export const ATTR_DB_PLAN_INDEX_EQUALITY =
  'db.plan.index_suggestion.equality' as const;
/** The suggested index's sort fields, as `field:1` / `field:-1`. */
export const ATTR_DB_PLAN_INDEX_SORT = 'db.plan.index_suggestion.sort' as const;
/** The suggested index's range fields, in key order. */
export const ATTR_DB_PLAN_INDEX_RANGE =
  'db.plan.index_suggestion.range' as const;
/**
 * Every plan operation, root first: `[SORT, FETCH, IXSCAN]`. `db.plan.node`
 * is only the first, and the first alone rarely says what happened.
 */
export const ATTR_DB_PLAN_STAGES = 'db.plan.stages' as const;
/** Index keys the database read (MongoDB `totalKeysExamined`). */
export const ATTR_DB_PLAN_KEYS_EXAMINED = 'db.plan.keys_examined' as const;
/**
 * The plan sorted in memory: every matching row had to be read before the
 * first could be returned. An index on the sort removes it.
 */
export const ATTR_DB_PLAN_BLOCKING_SORT = 'db.plan.blocking_sort' as const;
/** The {@link ExplainMode} the plan was captured with. */
export const ATTR_DB_PLAN_MODE = 'db.plan.mode' as const;
/** What became of the attempt to capture a plan: a {@link PlanStatus}. */
export const ATTR_DB_PLAN_STATUS = 'db.plan.status' as const;
/** Why a plan could not be captured, when `db.plan.status` is `failed`. */
export const ATTR_DB_PLAN_ERROR = 'db.plan.error' as const;

/**
 * What became of asking for a plan. A span with no `db.plan.status` was never
 * explained, which almost always means explain is turned off.
 *
 * - `captured`: the plan is on the span.
 * - `failed`: the database refused or the output was not understood; the
 *   reason is in `db.plan.error`.
 * - `unsupported`: this operation has no plan to show (an insert, a metadata
 *   count) or this database has no explain the instrumentation speaks.
 */
export type PlanStatus = 'captured' | 'failed' | 'unsupported';

/**
 * What a database did to answer one query, in terms every database shares.
 * An adapter fills in what its explain output reports and leaves the rest out.
 */
export interface QueryPlan {
  /** Plan operations, root first, as the database names them. */
  nodes: string[];
  /** Whether any operation read a whole table or collection. */
  fullScan: boolean;
  /** Index names the plan used, without duplicates. */
  indexes: string[];
  cost?: number;
  rowsEstimated?: number;
  rowsExamined?: number;
  rowsReturned?: number;
  blocks?: number;
  executionMs?: number;
  /** Index keys read, where the database reports them. */
  keysExamined?: number;
  /** The plan sorted in memory rather than reading an index in order. */
  blockingSort?: boolean;
  /** How the plan was asked for: planner only, or executed. */
  mode?: ExplainMode;
  /** A statement that creates an index this query would use. */
  indexSuggestion?: string;
  /** Which of the suggested index's fields serve which part of the query. */
  indexFields?: IndexFields;
}

/**
 * The suggested index's keys by the job they do, in key order. Equality fields
 * narrow to exact matches, the sort lets rows come out already in order, and
 * range fields bound the scan last.
 */
export interface IndexFields {
  equality: string[];
  /** `field:1` or `field:-1`. */
  sort: string[];
  range: string[];
}

/**
 * How an instrumentation asks the database for a plan.
 *
 * - `'plan'` asks the planner only, without running the query.
 * - `'analyze'` runs it too, which is what reports rows examined and time.
 *
 * Both cost a round trip per query: turn them on in development, in CI, or
 * behind a sample of production traffic.
 */
export type ExplainMode = 'plan' | 'analyze';

export type PlanAttributes = Record<
  string,
  string | number | boolean | string[]
>;

/** Hash a statement for {@link ATTR_DB_STATEMENT_HASH}. */
export function hashStatement(text: string): string {
  // cyrb53: 53 well-mixed bits, synchronous, and the same in Node and a
  // browser. The hash groups queries, it protects nothing, so a
  // cryptographic one would only cost an async API or a Node import.
  let h1 = 0xde_ad_be_ef;
  let h2 = 0x41_c6_ce_57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2_654_435_761);
    h2 = Math.imul(h2 ^ code, 1_597_334_677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2_246_822_507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3_266_489_909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2_246_822_507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3_266_489_909);
  const value = 4_294_967_296 * (2_097_151 & h2) + (h1 >>> 0);
  return value.toString(16).padStart(14, '0');
}

/** The span attributes for a plan. Fields the plan left out are left out. */
export function planAttributes(plan: QueryPlan): PlanAttributes {
  const attributes: PlanAttributes = {
    [ATTR_DB_PLAN_STATUS]: 'captured' satisfies PlanStatus,
    [ATTR_DB_PLAN_FULL_SCAN]: plan.fullScan,
  };
  if (plan.mode !== undefined) attributes[ATTR_DB_PLAN_MODE] = plan.mode;
  if (plan.blockingSort !== undefined) {
    attributes[ATTR_DB_PLAN_BLOCKING_SORT] = plan.blockingSort;
  }

  const [root] = plan.nodes;
  if (root !== undefined) {
    attributes[ATTR_DB_PLAN_NODE] = root;
    attributes[ATTR_DB_PLAN_STAGES] = [...plan.nodes];
    attributes[ATTR_DB_PLAN_HASH] = hashStatement(plan.nodes.join('>'));
  }
  if (plan.indexes.length > 0) {
    attributes[ATTR_DB_PLAN_INDEXES] = plan.indexes.join(',');
  }

  const numbers: Array<[string, number | undefined]> = [
    [ATTR_DB_PLAN_COST, plan.cost],
    [ATTR_DB_PLAN_ROWS_ESTIMATED, plan.rowsEstimated],
    [ATTR_DB_PLAN_ROWS_EXAMINED, plan.rowsExamined],
    [ATTR_DB_PLAN_ROWS_RETURNED, plan.rowsReturned],
    [ATTR_DB_PLAN_KEYS_EXAMINED, plan.keysExamined],
    [ATTR_DB_PLAN_BLOCKS, plan.blocks],
    [ATTR_DB_PLAN_EXECUTION_MS, plan.executionMs],
  ];
  for (const [key, value] of numbers) {
    if (value !== undefined && Number.isFinite(value)) attributes[key] = value;
  }

  if (plan.indexSuggestion !== undefined) {
    attributes[ATTR_DB_PLAN_INDEX_SUGGESTION] = plan.indexSuggestion;
  }
  if (plan.indexFields !== undefined) {
    attributes[ATTR_DB_PLAN_INDEX_EQUALITY] = plan.indexFields.equality;
    attributes[ATTR_DB_PLAN_INDEX_SORT] = plan.indexFields.sort;
    attributes[ATTR_DB_PLAN_INDEX_RANGE] = plan.indexFields.range;
  }

  return attributes;
}

/**
 * The attributes for an explain that produced no plan, so a reader can tell
 * "explain is off" (no `db.plan.status`) from "explain ran and could not".
 */
export function planUnavailableAttributes(
  status: Exclude<PlanStatus, 'captured'>,
  options: { mode?: ExplainMode; error?: string } = {},
): PlanAttributes {
  const attributes: PlanAttributes = { [ATTR_DB_PLAN_STATUS]: status };
  if (options.mode !== undefined) attributes[ATTR_DB_PLAN_MODE] = options.mode;
  if (options.error) {
    const reason = sanitizePlanError(options.error);
    if (reason) attributes[ATTR_DB_PLAN_ERROR] = reason;
  }
  return attributes;
}

/**
 * A database error made safe to export as `db.plan.error`.
 *
 * Errors quote what they choke on: MongoDB embeds the command or the key
 * (`dup key: { email: "a@b.c" }`), Postgres the value (`invalid input syntax
 * for type integer: "abc"`, `Key (email)=(a@b.c)`). Statement capture strips
 * values, and so does this: the reason keeps its words and drops every
 * document, array, quoted literal and key-value detail, then keeps the first
 * line, capped.
 */
export function sanitizePlanError(message: string): string {
  return (
    (message.split('\n')[0] ?? '')
      // Documents and arrays, nested or not: everything from the first
      // opening bracket to the last closing one on the line.
      .replace(/\{.*\}/gu, '{…}')
      .replace(/\[.*\]/gu, '[…]')
      // Quoted literals, either quote style.
      .replace(/"(?:[^"\\]|\\.)*"/gu, '"?"')
      .replace(/'(?:[^'\\]|\\.)*'/gu, "'?'")
      // Postgres detail: Key (email)=(a@b.c)
      .replace(/=\([^)]*\)/gu, '=(?)')
      // What is left that still looks like a value: an email, or a run of
      // digits long enough to be an id or a card number.
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/gu, '?')
      .replace(/\d{6,}/gu, '?')
      .trim()
      .slice(0, 300)
  );
}

export {
  groupQueries,
  queryIdentity,
  readPlan,
  type PlanSample,
  type PlanSummary,
  type QueryGroup,
  type QuerySpan,
  type SpanAttributeBag,
} from './queries';
