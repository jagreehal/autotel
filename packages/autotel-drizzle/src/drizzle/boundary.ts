/**
 * The I/O boundary between drizzle's drivers and this instrumentation.
 *
 * Everything that arrives here is unparsed: drizzle exports no types for the
 * dozen dialect-specific session and prepared-query classes being wrapped, and
 * postgres returns `EXPLAIN` output as JSON with no schema attached. This file
 * is where those values are decoded once into the named types the rest of the
 * package works with, so no `unknown` and no runtime `typeof` check escapes it.
 *
 * The anti-slop rules disabled below are the ones that describe that decoding
 * work: they ask for input to be parsed at its I/O boundary, and this file is
 * that boundary. Nothing here narrows a value without returning a named type
 * that says what was established.
 */
/* oxlint-disable anti-slop/no-runtime-typeof */
/* oxlint-disable anti-slop/no-unknown-parameters */
/* oxlint-disable anti-slop/no-unknown-returns */
/* oxlint-disable anti-slop/no-unsafe-dictionary-type */

/** A property bag reached into by name. Every read is guarded before it is used. */
export interface DriverObject {
  [key: string]: DriverValue;
}

/** A driver method this package wraps. */
export type QueryFunction = (...args: DriverValue[]) => DriverValue;

/**
 * A value handed over by a driver, before anything about it is established.
 * Spelled out rather than written as `object` so every branch names what it is.
 */
export type DriverValue =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  | DriverObject
  | readonly DriverValue[]
  | QueryFunction
  // Driver methods return their work, and most of them return it as a promise.
  // What the promise resolves to is opaque here: it goes back to the caller
  // untouched, or to a decoder that re-reads it as a DriverValue.
  | PromiseLike<unknown>;

/**
 * A value from outside this package, accepted only once it is a property bag.
 * This is the single entry point: callers hand over whatever drizzle gave them
 * and get back something with named accessors, or nothing.
 */
export function asDriverObject(value: unknown): DriverObject | undefined {
  if (value === null || typeof value !== 'object') {
    return undefined;
  }

  // SAFETY: confirmed to be a non-null object, and every property read through
  // the accessors below is guarded before the value behind it is used.
  return value as DriverObject;
}

/** Whether the named property is callable, without reading it as one. */
export function hasMethod(target: DriverObject, name: string): boolean {
  return typeof target[name] === 'function';
}

/** A callable, when the value is one. */
export function asFunction(value: DriverValue): QueryFunction | undefined {
  return typeof value === 'function' ? value : undefined;
}

/** The node-style callback some drivers take as a final argument. */
export type QueryCallback = (error: DriverValue, result: DriverValue) => void;

/** A client that takes raw SQL, used to ask postgres for a query plan. */
export interface QueryClient {
  query: (statement: string, params: DriverValue[]) => Promise<unknown>;
}

/** A node-postgres Pool: it can hand out a connection of its own. */
function isPgPool(value: DriverObject): boolean {
  return (
    asFunction(value.connect) !== undefined &&
    typeof value.totalCount === 'number'
  );
}

/**
 * A client that runs EXPLAIN for a statement inside a transaction, on a
 * connection of its own rather than the transaction's.
 *
 * The transaction's connection belongs to the application: an EXPLAIN there
 * can abort the transaction on error, and holding the application's
 * statements back to make room for it reorders them against the COMMIT or
 * ROLLBACK. So the plan comes from a separate pooled connection, inside a
 * transaction that is always rolled back, with a lock timeout: the
 * application's transaction may hold locks the EXPLAIN needs, and it is
 * waiting on this EXPLAIN, so without one they would wait on each other
 * forever.
 *
 * Only a node-postgres Pool qualifies. A single client has no other
 * connection, and an embedded database queues the EXPLAIN behind the open
 * transaction, which is the same deadlock.
 */
export function isolatedExplainClient(
  value: DriverValue,
): QueryClient | undefined {
  if (!isDriverObject(value) || !isPgPool(value)) return undefined;
  const connect = asFunction(value.connect)!;
  return {
    query: async (statement, params) => {
      const connection = asDriverObject(await connect.call(value));
      const run = connection && asFunction(connection.query);
      if (connection === undefined || run === undefined) {
        throw new Error('the pool handed back no client');
      }
      const release = asFunction(connection.release);
      try {
        await run.call(connection, 'BEGIN', []);
        await run.call(connection, "SET LOCAL lock_timeout = '100ms'", []);
        await run.call(connection, "SET LOCAL statement_timeout = '5s'", []);
        return await run.call(connection, statement, params);
      } finally {
        try {
          await run.call(connection, 'ROLLBACK', []);
          release?.call(connection);
        } catch (error) {
          // A connection that cannot roll back is in no state to reuse:
          // releasing it with an error tells the pool to destroy it.
          release?.call(
            connection,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    },
  };
}

/** One node of a postgres plan tree, with the fields this package reads. */
export interface PlanNode {
  nodeType: string | undefined;
  indexName: string | undefined;
  totalCost: number | undefined;
  planRows: number | undefined;
  actualRows: number;
  rowsRemovedByFilter: number;
  rowsRemovedByIndexRecheck: number;
  sharedHitBlocks: number;
  sharedReadBlocks: number;
  isLeaf: boolean;
}

/** A decoded `EXPLAIN (FORMAT JSON)` response. */
export interface ExplainPayload {
  nodes: PlanNode[];
  executionMs: number | undefined;
}

export function isDriverObject(value: DriverValue): value is DriverObject {
  return value !== null && typeof value === 'object';
}

export function isThenable<T>(
  value: T | PromiseLike<T>,
): value is PromiseLike<T> {
  const candidate = asDriverObject(value);

  return candidate !== undefined && hasMethod(candidate, 'then');
}

/** The named property as a callable, or nothing when it is not one. */
export function readMethod(
  target: DriverObject,
  name: string,
): QueryFunction | undefined {
  return asFunction(target[name]);
}

/** The named property as a string, or nothing when it is not one. */
export function readString(
  target: DriverObject,
  name: string,
): string | undefined {
  const candidate = target[name];

  return typeof candidate === 'string' ? candidate : undefined;
}

/** The named property as an object, or nothing when it is not one. */
export function readObject(
  target: DriverObject,
  name: string,
): DriverObject | undefined {
  const candidate = target[name];

  return isDriverObject(candidate) ? candidate : undefined;
}

/** A boolean marker this package writes on driver objects to avoid re-wrapping. */
export function readFlag(target: DriverObject, name: string): boolean {
  return target[name] === true;
}

/**
 * The bound parameters of a statement. Drivers hand these over as an array or
 * not at all, and EXPLAIN needs an array either way.
 */
export function readParams(value: DriverValue): DriverValue[] {
  return Array.isArray(value) ? value : [];
}

/**
 * The SQL text carried by whatever a driver passes as its query argument.
 * Drivers each name it differently, which is why all four are read.
 */
export function readQueryText(queryArg: DriverValue): string | undefined {
  if (typeof queryArg === 'string') {
    return queryArg;
  }

  if (!isDriverObject(queryArg)) {
    return undefined;
  }

  return (
    readString(queryArg, 'sql') ??
    readString(queryArg, 'text') ??
    readString(queryArg, 'queryString')
  );
}

/** The client a prepared query will run on, when it carries one. */
export function readQueryClient(target: DriverValue): QueryClient | undefined {
  if (!isDriverObject(target)) {
    return undefined;
  }

  return asQueryClient(readObject(target, 'client'));
}

/** A candidate client, accepted only when it can run raw SQL. */
export function asQueryClient(value: DriverValue): QueryClient | undefined {
  if (!isDriverObject(value)) {
    return undefined;
  }

  const run = asFunction(value.query);

  if (run === undefined) {
    return undefined;
  }

  // A node-postgres Pool releases the connection behind pool.query() with the
  // query's error, and a connection released with an error is destroyed. A
  // failed EXPLAIN (a missing privilege fails every one) would cost a pooled
  // connection each time. Check one out instead and hand it back clean: an
  // error outside a transaction leaves the connection usable.
  const connect = asFunction(value.connect);
  if (connect !== undefined && isPgPool(value)) {
    return {
      query: async (statement, params) => {
        const connection = asDriverObject(await connect.call(value));
        const checkedOut = connection && asFunction(connection.query);
        if (connection === undefined || checkedOut === undefined) {
          throw new Error('the pool handed back no client');
        }
        try {
          return await checkedOut.call(connection, statement, params);
        } finally {
          asFunction(connection.release)?.call(connection);
        }
      },
    };
  }

  // `run` is called on the client it came from. A pooled driver keeps its
  // connection state on the receiver, so calling the bare function throws and
  // the plan is silently lost.
  return {
    query: async (statement, params) => run.call(value, statement, params),
  };
}

function toCount(value: DriverValue): number {
  return typeof value === 'number' ? value : 0;
}

function toOptionalNumber(value: DriverValue): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function toOptionalString(value: DriverValue): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function decodePlanNode(raw: DriverObject): PlanNode {
  const children = raw.Plans;

  return {
    nodeType: toOptionalString(raw['Node Type']),
    indexName: toOptionalString(raw['Index Name']),
    totalCost: toOptionalNumber(raw['Total Cost']),
    planRows: toOptionalNumber(raw['Plan Rows']),
    actualRows: toCount(raw['Actual Rows']),
    rowsRemovedByFilter: toCount(raw['Rows Removed by Filter']),
    rowsRemovedByIndexRecheck: toCount(raw['Rows Removed by Index Recheck']),
    sharedHitBlocks: toCount(raw['Shared Hit Blocks']),
    sharedReadBlocks: toCount(raw['Shared Read Blocks']),
    isLeaf: !Array.isArray(children),
  };
}

/** Every node of a plan tree, parents before children. */
function* flattenPlan(node: DriverValue): Generator<PlanNode> {
  if (!isDriverObject(node)) {
    return;
  }

  yield decodePlanNode(node);

  const children = node.Plans;

  if (Array.isArray(children)) {
    for (const child of children) {
      yield* flattenPlan(child);
    }
  }
}

/**
 * Decodes an `EXPLAIN (FORMAT JSON)` response into a flat list of plan nodes.
 * Returns nothing when the response is not a plan: a driver that does not take
 * raw SQL, a statement postgres refused to plan, or a permissions error. A plan
 * is commentary on a query, so failing to read one must never fail the query.
 */
export function parseExplainResponse(
  result: unknown,
): ExplainPayload | undefined {
  const response = asDriverObject(result);
  const rows = response === undefined ? result : response.rows;

  if (!Array.isArray(rows) || rows.length === 0) {
    return undefined;
  }

  const firstRow = rows[0];

  if (!isDriverObject(firstRow)) {
    return undefined;
  }

  // node-postgres names the column after the whole EXPLAIN expression, so the
  // plan is read positionally rather than by a column name that varies.
  const column = Object.values(firstRow)[0];

  let decoded: DriverValue;

  try {
    decoded = typeof column === 'string' ? JSON.parse(column) : column;
  } catch {
    return undefined;
  }

  const envelope = Array.isArray(decoded) ? decoded[0] : decoded;

  if (!isDriverObject(envelope)) {
    return undefined;
  }

  const nodes = [...flattenPlan(envelope.Plan)];

  if (nodes.length === 0) {
    return undefined;
  }

  return {
    nodes,
    executionMs: toOptionalNumber(envelope['Execution Time']),
  };
}
