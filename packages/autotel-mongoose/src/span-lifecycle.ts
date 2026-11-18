/**
 * One operation span from start to end: what it runs against, its statement
 * and hash, its plan, and the settle step that ends it whatever async shape
 * the operation returns (Query, Aggregate, cursor, promise or value).
 */

import { SpanKind, SpanStatusCode } from 'autotel';
import type { Attributes as SpanAttributes, Span, Tracer } from 'autotel';
import { runWithSpan } from 'autotel/trace-helpers';
import {
  ATTR_DB_SYSTEM_NAME,
  ATTR_DB_OPERATION_NAME,
  ATTR_DB_COLLECTION_NAME,
  ATTR_DB_NAMESPACE,
  ATTR_DB_QUERY_TEXT,
  ATTR_SERVER_ADDRESS,
  ATTR_SERVER_PORT,
  DB_SYSTEM_NAME_VALUE_MONGODB,
} from './constants';
import type {
  MongoDocument,
  ResolvedConfig,
  SerializerPayload,
} from './types.js';
import {
  ATTR_DB_STATEMENT_HASH,
  hashStatement,
  planAttributes,
  planUnavailableAttributes,
  type ExplainMode,
} from 'autotel-db';
import { planFromExplain, serializeMongoStatement } from 'autotel-mongodb';
import { type StatementCaptureFn } from './statement';
import { traceCursor } from './cursor';
import {
  asFunction,
  asRecord,
  callFunction,
  isFunction,
  readProperty,
  toError,
} from './values.js';

/** The fields of a Mongoose Connection a span reads. */
interface ConnectionInfo {
  name?: string;
  host?: string;
  port?: number;
}

/** What an operation runs against: read off the Model, Document or Connection it was called on. */
interface OperationTarget {
  collectionName?: string;
  modelName?: string;
  connection?: ConnectionInfo;
}

export type DescribeTarget = (self: any) => OperationTarget;

export const describeModel: DescribeTarget = (model) => {
  try {
    return {
      collectionName: model.collection?.collectionName || model.modelName,
      modelName: model.modelName,
      connection: model.db,
    };
  } catch {
    return {};
  }
};

export const describeDocument: DescribeTarget = (doc) =>
  describeModel(doc.constructor);

export const describeConnection: DescribeTarget = (connection) => ({
  connection,
});

/**
 * Creates a span for a Mongoose operation.
 * Note: db.query.text is NOT set here — callers set it after payload extraction.
 */
export function createSpan(
  tracer: Tracer,
  operation: string,
  modelName: string | undefined,
  collectionName: string | undefined,
  config: ResolvedConfig,
  connection: ConnectionInfo | undefined,
): Span {
  const spanName = collectionName
    ? `${operation} ${collectionName}`
    : modelName
      ? `${operation} ${modelName}`
      : `mongoose.${operation}`;

  const attributes: SpanAttributes = {
    [ATTR_DB_SYSTEM_NAME]: DB_SYSTEM_NAME_VALUE_MONGODB,
    [ATTR_DB_OPERATION_NAME]: operation,
  };

  if (collectionName && config.captureCollectionName) {
    attributes[ATTR_DB_COLLECTION_NAME] = collectionName;
  }
  // Config wins; otherwise the connection this model runs on says, so an app
  // with several connections gets each one's own server and database.
  const namespace = config.dbName ?? connection?.name;
  if (namespace) attributes[ATTR_DB_NAMESPACE] = namespace;
  const address = config.peerName ?? connection?.host;
  if (address) attributes[ATTR_SERVER_ADDRESS] = address;
  const port = config.peerPort ?? connection?.port;
  if (port !== undefined) attributes[ATTR_SERVER_PORT] = port;

  return tracer.startSpan(spanName, { kind: SpanKind.CLIENT, attributes });
}

/**
 * Returns an idempotent finalizer for a span. Every wrapper invocation may try
 * to close its span from more than one place — a callback, an `exec()`
 * continuation, a promise settlement, a synchronous return, or a thrown error —
 * and the span must be ended exactly once. The first call wins; later calls are
 * no-ops. A non-Error rejection is normalized to an `Error`.
 */
/**
 * A value Mongoose handed back, read as the document shape the serializer
 * expects.
 *
 * SAFETY: a query's filter, update, options and projection are plain objects
 * of BSON-serialisable values, which is what MongoDocument says. The
 * serializer walks them field by field and stringifies anything it does not
 * recognise.
 */
export function mongoDocument(value: unknown): MongoDocument | undefined {
  return asRecord(value) as MongoDocument | undefined;
}

/** Ends a span once; `endTime` backdates the end to when the work finished. */
type Finalize = (error?: unknown, endTime?: number) => void;

export function createSpanFinalizer(span: Span): Finalize {
  let done = false;
  return (error?: unknown, endTime?: number): void => {
    if (done) {
      return;
    }
    done = true;
    if (error === undefined || error === null) {
      span.setStatus({ code: SpanStatusCode.OK });
    } else {
      span.recordException(toError(error));
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
    span.end(endTime);
  };
}

/**
 * Sets `db.query.text` (through the user's serializer and redactor) and
 * `db.statement.hash`. The hash is always taken from the value-free shape,
 * whatever the serializer emits, and from the operation and collection, which
 * the payload does not name, so it groups the same query and nothing else
 * even when text capture is off.
 */
export function recordStatement(
  span: Span,
  operation: string,
  collectionName: string | undefined,
  payload: SerializerPayload,
  captureStatement: StatementCaptureFn,
): void {
  try {
    const statementText = captureStatement(operation, payload);
    if (statementText) {
      span.setAttribute(ATTR_DB_QUERY_TEXT, statementText);
    }
    span.setAttribute(
      ATTR_DB_STATEMENT_HASH,
      hashStatement(
        `${operation} ${collectionName ?? ''} ${serializeMongoStatement(payload)}`,
      ),
    );
  } catch {
    // Ignore serialization errors
  }
}

/**
 * How a wrapper ends its span on success: plainly, or after collecting the
 * plan when `explain` is on and the operation has one.
 */
export function succeedWith(
  span: Span,
  finalize: Finalize,
  mode: ExplainMode | false,
  explain: ((verbosity: string) => Promise<unknown>) | undefined,
): () => void {
  if (!mode) return () => finalize();
  // Explain is on and this operation has nothing to explain (a save, an
  // insert): the span says so.
  if (!explain) {
    return () => {
      span.setAttributes(planUnavailableAttributes('unsupported', { mode }));
      finalize();
    };
  }
  return () =>
    finalizeWithPlan(span, finalize, mode, () =>
      explain(EXPLAIN_VERBOSITY[mode]),
    );
}

/** What `explainThroughDriver` returns for an operation with no command. */
const NO_EXPLAIN = Symbol('no explain');

/** A Query's filter, update, options and projection as they stand now. */
export function readQueryPayload(
  query: Record<string, any>,
): SerializerPayload {
  const payload: SerializerPayload = {};
  try {
    const getFilter = asFunction(query.getFilter);
    if (getFilter) payload.condition = mongoDocument(getFilter.call(query));
    payload.updates = mongoDocument(query._update);
    const getOptions = asFunction(query.getOptions);
    if (getOptions) payload.options = mongoDocument(getOptions.call(query));
    payload.fields = mongoDocument(query._fields);
  } catch {
    // Ignore errors in payload extraction
  }
  return payload;
}

/**
 * Sends `{ explain: command, verbosity }` on the connection's native `Db`.
 * `connection` is the Mongoose Connection a Model hangs off (`Model.db`, read
 * off the Model the wrapper was called on); its `.db` is the driver's.
 */
export function explainThroughDriver(
  connection: unknown,
  command: Record<string, unknown> | undefined,
  verbosity: string,
): Promise<unknown> {
  const db = readProperty(connection, 'db');
  const run = asFunction(readProperty(db, 'command'));
  if (!command) return Promise.resolve(NO_EXPLAIN);
  if (!run) return Promise.reject(new Error('no driver Db on this connection'));
  return Promise.resolve(
    callFunction(run, db, [{ explain: command, verbosity }]),
  );
}

/** The `explain()` verbosity each mode asks MongoDB for. */
const EXPLAIN_VERBOSITY = {
  plan: 'queryPlanner',
  analyze: 'executionStats',
} as const satisfies Record<ExplainMode, string>;

/**
 * Runs `explain` once the query has settled and ends the span with the plan
 * on it. The span ends at the time the query settled, not when the explain
 * came back, so the duration is the query's own, and the caller gets its
 * result without waiting. A process that exits straight after its last query
 * should shut down its tracer provider after a short pause, so that span is
 * exported.
 */
function finalizeWithPlan(
  span: Span,
  finalize: Finalize,
  mode: ExplainMode,
  explain: () => Promise<unknown>,
): void {
  const settledAt = performance.timeOrigin + performance.now();
  void Promise.resolve()
    .then(explain)
    .then((result) => {
      if (result === NO_EXPLAIN) {
        span.setAttributes(planUnavailableAttributes('unsupported', { mode }));
        return;
      }
      const plan = planFromExplain(Array.isArray(result) ? result[0] : result);
      span.setAttributes(
        plan
          ? planAttributes({ ...plan, mode })
          : planUnavailableAttributes('failed', {
              mode,
              error: 'explain output was not a plan autotel-mongodb reads',
            }),
      );
    })
    .catch((error: unknown) => {
      // A plan is commentary on a query: failing to get one never fails it,
      // and the span records why, so a reader can tell it from explain off.
      span.setAttributes(
        planUnavailableAttributes('failed', {
          mode,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    })
    .finally(() => finalize(undefined, settledAt));
}

/**
 * Closes `finalize` over whatever async shape an operation returns:
 *
 * - a Mongoose Query/Aggregate (`exec()`) → wrap `exec()` so the span spans the
 *   real DB round-trip, and return the Query unchanged for further chaining;
 * - a Promise → finalize when it settles, and return the chained promise;
 * - a synchronous value → finalize now, and return it.
 *
 * This is the single settlement ladder shared by every wrapper, so the rule
 * "the span ends when the work ends" lives in exactly one place. `succeed`
 * replaces the plain `finalize()` on success, which is where explain hooks in;
 * `beforeExec` runs as exec() starts, once the caller has finished chaining.
 */
export function settleSpan(
  result: any,
  finalize: Finalize,
  succeed: () => void = () => finalize(),
  beforeExec?: () => void,
): any {
  const exec = asFunction(readProperty(result, 'exec'));
  if (exec) {
    const originalExec = exec.bind(result);
    result.exec = function wrappedExec(): Promise<any> {
      try {
        beforeExec?.();
        return Promise.resolve(originalExec()).then(
          (value: any) => {
            succeed();
            return value;
          },
          (error: unknown) => {
            finalize(error);
            throw error;
          },
        );
      } catch (error) {
        finalize(error);
        throw error;
      }
    };
    const cursor = asFunction(readProperty(result, 'cursor'));
    if (cursor) {
      result.cursor = function tracedCursor(...args: any[]): any {
        try {
          beforeExec?.();
          return traceCursor(callFunction(cursor, result, args), (error) =>
            error === undefined ? succeed() : finalize(error),
          );
        } catch (error) {
          finalize(error);
          throw error;
        }
      };
    }
    return result;
  }

  if (isFunction(readProperty(result, 'then'))) {
    // SAFETY: the probe above established the result is a thenable.
    return Promise.resolve(result as Promise<any>).then(
      (value) => {
        succeed();
        return value;
      },
      (error: unknown) => {
        finalize(error);
        throw error;
      },
    );
  }

  succeed();
  return result;
}

/**
 * Node-convention callback support for custom methods: if the last argument is
 * a function, replace it with one that (a) runs the original callback inside the
 * span's context — so any DB calls the callback makes nest under this span — and
 * (b) finalizes the span when the callback fires, treating a truthy first
 * argument as the error. Older Mongoose code returns synchronously and does its
 * real work in such a callback (e.g. `doc.checkValidationErrors(cb)`), so the
 * span must outlive the synchronous return.
 *
 * Returns the args to call with and whether finalization was handed to a
 * callback. If there is no trailing callback, the args pass through unchanged.
 *
 * NOTE: This is the Node trailing-callback convention. Mongoose *hooks* use a
 * different convention — kareem's positional `next` — handled separately in
 * wrapHookHandler. The two are intentionally not merged: a single "find the
 * callback" rule across both would hide two genuinely different calling shapes.
 */
/** Whether the call's completion was handed to a callback, and the args to use. */
interface DeferredCall {
  callArgs: any[];
  deferred: boolean;
}

export function deferFinalizeToCallback(
  args: any[],
  span: Span,
  finalize: (cause?: unknown) => void,
): DeferredCall {
  const lastIndex = args.length - 1;
  const maybeCallback = lastIndex >= 0 ? args[lastIndex] : undefined;
  if (!isFunction(maybeCallback)) {
    return { callArgs: args, deferred: false };
  }

  const callArgs = [...args];
  callArgs[lastIndex] = function tracedCallback(
    this: any,
    ...callbackArgs: any[]
  ): any {
    try {
      return runWithSpan(span, () =>
        callFunction(maybeCallback, this, callbackArgs),
      );
    } finally {
      finalize(callbackArgs[0]);
    }
  };
  return { callArgs, deferred: true };
}
