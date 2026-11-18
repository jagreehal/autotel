// Note: `any` is only used for dynamic method wrapping on runtime objects.
// Type-safe interfaces are used for all public APIs.
// Mongoose is a devDependency so we type-check against the real API; consumers use the peer.

import type { Mongoose } from 'mongoose';
import { otelTrace as trace } from 'autotel';
import type { Tracer } from 'autotel';
import { runWithSpan, getActiveSpan } from 'autotel/trace-helpers';
import type {
  InstrumentMongooseConfig,
  ResolvedConfig,
  SerializerPayload,
} from './types.js';
import { DEFAULT_TRACER_NAME } from './types';
import { explainCommand } from './explain';
import {
  createStatementCapture,
  defaultSerializer,
  type StatementCaptureFn,
} from './statement';
import { asFunction, asRecord, isFunction, readProperty } from './values.js';
import {
  INSTRUMENTED_FLAG,
  hasMarker,
  setMarker,
  PATCHED_PROTOTYPE_FLAG,
  _STORED_PARENT_SPAN,
} from './markers';
import {
  DescribeTarget,
  describeModel,
  describeDocument,
  describeConnection,
  createSpan,
  mongoDocument,
  createSpanFinalizer,
  recordStatement,
  succeedWith,
  readQueryPayload,
  explainThroughDriver,
  settleSpan,
} from './span-lifecycle';
import { patchSchemaHooks, resolveHookSelector } from './hooks';
import {
  INSTANCE_REGISTRY,
  resolveCustomMethods,
  patchModelFactory,
} from './custom-methods';

/**
 * True while a traced Model method is building its query.
 *
 * Several Mongoose methods are written in terms of another one:
 * `findById` calls `findOne`, `findByIdAndUpdate` calls `findOneAndUpdate`.
 * Both ends are public API and both are traced, so one `findById()` opened two
 * spans for one round trip — the delegate nested inside its caller.
 *
 * The delegation happens synchronously while the outer method assembles the
 * Query, so the window this flag covers is exactly that call and nothing else.
 * A query a hook or callback starts later runs outside it and is traced in full,
 * which is the distinction a "suppress any nested query" rule would lose.
 */
let buildingQuery = false;
/**
 * Wraps Model methods that return Query objects (find, findOne, findById,
 * findOneAndUpdate, findOneAndDelete, findOneAndReplace, deleteOne, deleteMany,
 * updateOne, updateMany, countDocuments, estimatedDocumentCount).
 *
 * Creates span FIRST, calls original, extracts payload from the returned Query,
 * sets db.query.text AFTER extraction, then wraps exec() to finalize span.
 */
function wrapQueryReturningMethod(
  target: any,
  methodName: string,
  operation: string,
  describe: DescribeTarget,
  tracer: Tracer,
  config: ResolvedConfig,
  captureStatement: StatementCaptureFn,
): void {
  const original = asFunction(target[methodName]);
  if (!original || hasMarker(original, PATCHED_PROTOTYPE_FLAG)) return;

  target[methodName] = function instrumented(this: any, ...args: any[]): any {
    // Reached from inside another traced method rather than from application
    // code: the caller's span already describes this round trip.
    if (buildingQuery) {
      return original.apply(this, args);
    }

    const { collectionName, modelName, connection } = describe(this);
    const span = createSpan(
      tracer,
      operation,
      modelName,
      collectionName,
      config,
      connection,
    );

    const finalize = createSpanFinalizer(span);
    return runWithSpan(span, () => {
      try {
        buildingQuery = true;
        let result: unknown;
        try {
          result = original.apply(this, args);
        } finally {
          buildingQuery = false;
        }

        // The payload is read when exec() starts, not here: the caller may
        // still chain `.where('n').gt(0)` or `.sort()` onto the Query, and the
        // statement and its hash have to be the query that ran.
        const query = asRecord(result);
        const isQuery = query !== undefined && isFunction(query.exec);
        const recordAtExec = isQuery
          ? () =>
              recordStatement(
                span,
                operation,
                collectionName,
                readQueryPayload(query),
                captureStatement,
              )
          : undefined;
        const explain =
          isQuery && collectionName
            ? (verbosity: string) =>
                explainThroughDriver(
                  connection,
                  explainCommand(
                    operation,
                    collectionName,
                    readQueryPayload(query),
                  ),
                  verbosity,
                )
            : undefined;

        // settleSpan wraps exec() (Query) or finalizes a non-query result.
        return settleSpan(
          result,
          finalize,
          succeedWith(span, finalize, config.explain, explain),
          recordAtExec,
        );
      } catch (error) {
        finalize(error);
        throw error;
      }
    });
  };
  setMarker(target[methodName], PATCHED_PROTOTYPE_FLAG);
}

/**
 * Wraps Model static methods (create, insertMany, aggregate, bulkWrite).
 *
 * Builds payload from args BEFORE calling original (args are available
 * immediately), creates span, sets db.query.text, calls original, then wraps
 * exec() or promise for span finalization.
 */
function wrapStaticMethod(
  target: any,
  methodName: string,
  operation: string,
  describe: DescribeTarget,
  tracer: Tracer,
  config: ResolvedConfig,
  captureStatement: StatementCaptureFn,
): void {
  const original = asFunction(target[methodName]);
  if (!original || hasMarker(original, PATCHED_PROTOTYPE_FLAG)) return;

  target[methodName] = function instrumented(this: any, ...args: any[]): any {
    const { collectionName, modelName, connection } = describe(this);

    // Build payload from args before calling original
    const payload: SerializerPayload = {};
    try {
      switch (operation) {
        case 'create': {
          payload.document = args[0];
          break;
        }
        case 'insertMany': {
          payload.documents = args[0];
          break;
        }
        case 'aggregate': {
          // The starting pipeline. The Aggregate's own pipeline() replaces it
          // when exec() starts, after any `.match()` / `.group()` chaining.
          payload.aggregatePipeline = args[0];
          break;
        }
        case 'bulkWrite': {
          payload.operations = args[0];
          break;
        }
        default: {
          break;
        }
      }
    } catch {
      // Ignore errors in payload extraction
    }

    const span = createSpan(
      tracer,
      operation,
      modelName,
      collectionName,
      config,
      connection,
    );

    const finalize = createSpanFinalizer(span);
    return runWithSpan(span, () => {
      try {
        // exec() (e.g. aggregate), promise (create/insertMany), or sync value.
        const result: any = original.apply(this, args);

        // An Aggregate can still be chained (`.match()`, `.sort()`,
        // `.option()`) after the call returns, so its statement is read when
        // exec() starts, as a Query's is. Everything else is final now.
        const isAggregate =
          operation === 'aggregate' &&
          isFunction(readProperty(result, 'exec')) &&
          isFunction(readProperty(result, 'pipeline'));
        const readAggregate = (): SerializerPayload => ({
          aggregatePipeline: result.pipeline(),
          options: mongoDocument(readProperty(result, 'options')),
        });
        if (!isAggregate) {
          recordStatement(
            span,
            operation,
            collectionName,
            payload,
            captureStatement,
          );
        }
        const recordAtExec = isAggregate
          ? () =>
              recordStatement(
                span,
                operation,
                collectionName,
                { aggregatePipeline: readAggregate().aggregatePipeline },
                captureStatement,
              )
          : undefined;

        // Explained as a raw command too, so aggregate middleware does not
        // run twice. Pipeline and options are read after the query settled.
        const explain =
          isAggregate && collectionName
            ? (verbosity: string) =>
                explainThroughDriver(
                  connection,
                  explainCommand(operation, collectionName, readAggregate()),
                  verbosity,
                )
            : undefined;
        return settleSpan(
          result,
          finalize,
          succeedWith(span, finalize, config.explain, explain),
          recordAtExec,
        );
      } catch (error) {
        finalize(error);
        throw error;
      }
    });
  };
  setMarker(target[methodName], PATCHED_PROTOTYPE_FLAG);
}

/**
 * Wraps Model instance methods (save, deleteOne on prototype).
 *
 * Extracts document via `this.toObject()` BEFORE calling original,
 * creates span, sets db.query.text, calls original, wraps promise
 * for span finalization.
 */
function wrapInstanceMethod(
  target: any,
  methodName: string,
  operation: string,
  describe: DescribeTarget,
  tracer: Tracer,
  config: ResolvedConfig,
  captureStatement: StatementCaptureFn,
): void {
  const original = asFunction(target[methodName]);
  if (!original || hasMarker(original, PATCHED_PROTOTYPE_FLAG)) return;

  target[methodName] = function instrumented(this: any, ...args: any[]): any {
    const { collectionName, modelName, connection } = describe(this);

    // Extract document before calling original
    const payload: SerializerPayload = {};
    try {
      if (isFunction(this.toObject)) {
        payload.document = this.toObject();
      }
    } catch {
      // Ignore errors in document extraction
    }

    const span = createSpan(
      tracer,
      operation,
      modelName,
      collectionName,
      config,
      connection,
    );

    recordStatement(span, operation, collectionName, payload, captureStatement);

    const finalize = createSpanFinalizer(span);
    return runWithSpan(span, () => {
      try {
        // Instance methods (save/deleteOne) return promises; sync is tolerated.
        // A document's own save has no query plan to show.
        return settleSpan(
          original.apply(this, args),
          finalize,
          succeedWith(span, finalize, config.explain, undefined),
        );
      } catch (error) {
        finalize(error);
        throw error;
      }
    });
  };
  setMarker(target[methodName], PATCHED_PROTOTYPE_FLAG);
}

/**
 * Wraps chainable Query methods (populate, select, lean, etc.) to capture span context.
 */
function wrapChainableMethod(target: any, methodName: string): void {
  const original = asFunction(target[methodName]);
  if (!original || hasMarker(original, PATCHED_PROTOTYPE_FLAG)) return;

  target[methodName] = function captureContext(this: any, ...args: any[]): any {
    const currentSpan = getActiveSpan();
    const result = original.apply(this, args);

    // Store parent span on returned Query for exec() calls
    const query = asRecord(result);
    if (query && isFunction(query.exec)) {
      setMarker(query, _STORED_PARENT_SPAN, currentSpan);
    }

    return result;
  };
  setMarker(target[methodName], PATCHED_PROTOTYPE_FLAG);
}

/**
 * Instruments Mongoose with OpenTelemetry tracing.
 *
 * Supports Mongoose 8+ with promise-based API only.
 * Patches Model methods, Query methods, and user-defined Schema hooks to create spans.
 *
 * **IMPORTANT:** Call `instrumentMongoose()` BEFORE defining schemas/models
 * to ensure hooks are automatically instrumented.
 *
 * @example
 * ```typescript
 * import mongoose from 'mongoose';
 * import { init } from 'autotel';
 * import { instrumentMongoose } from 'autotel-mongoose';
 *
 * init({ service: 'my-app' });
 *
 * // Call BEFORE defining schemas
 * instrumentMongoose(mongoose, { dbName: 'myapp' });
 *
 * const userSchema = new mongoose.Schema({ name: String });
 * const User = mongoose.model('User', userSchema);
 *
 * // All operations are automatically traced
 * await User.findOne({}).populate('posts').exec();
 * ```
 */
export function instrumentMongoose(
  mongoose: Mongoose,
  config?: InstrumentMongooseConfig,
): Mongoose {
  if (!mongoose?.Model) {
    return mongoose;
  }

  // SAFETY: the instrumented marker is autotel's own key on the mongoose
  // instance; hasMarker/setMarker below are the only things that read it.
  const m = mongoose as any;
  if (m[INSTRUMENTED_FLAG]) {
    return mongoose;
  }

  // Resolve statement-related config separately (they accept undefined)
  const resolvedSerializer = config?.dbStatementSerializer;
  const resolvedRedactor = config?.statementRedactor ?? 'default';

  const finalConfig: ResolvedConfig = {
    dbName: config?.dbName || undefined,
    peerName: config?.peerName || undefined,
    peerPort: config?.peerPort || undefined,
    tracerName: config?.tracerName || DEFAULT_TRACER_NAME,
    captureCollectionName: config?.captureCollectionName ?? true,
    instrumentHooks: resolveHookSelector(config?.instrumentHooks),
    dbStatementSerializer:
      resolvedSerializer === false
        ? false
        : (resolvedSerializer ?? defaultSerializer),
    statementRedactor: resolvedRedactor,
    explain: config?.explain ?? false,
    customMethods: resolveCustomMethods(config),
  };

  const tracer = trace.getTracer(finalConfig.tracerName);

  // Register this instance so custom-function wrappers can resolve its
  // tracer/config at call time (rather than closing over them — which would
  // bind a shared schema to whichever instance instrumented it first).
  INSTANCE_REGISTRY.set(mongoose, { tracer, config: finalConfig });

  // Patch model factory so user-defined statics/methods/query helpers are
  // wrapped automatically as models compile (no manual trace() calls).
  patchModelFactory(m, finalConfig);

  // Create statement capture function
  const captureStatement = createStatementCapture({
    dbStatementSerializer: resolvedSerializer,
    statementRedactor: resolvedRedactor,
  });

  // Patch Schema hooks only if enabled
  if (m.Schema && finalConfig.instrumentHooks !== false) {
    patchSchemaHooks(m.Schema, tracer, finalConfig);
  }

  // Patch Query-returning methods on Model
  const queryMethods: Array<{ method: string; operation: string }> = [
    { method: 'find', operation: 'find' },
    { method: 'findOne', operation: 'findOne' },
    { method: 'findById', operation: 'findById' },
    { method: 'findOneAndUpdate', operation: 'findOneAndUpdate' },
    { method: 'findOneAndDelete', operation: 'findOneAndDelete' },
    { method: 'findOneAndReplace', operation: 'findOneAndReplace' },
    { method: 'deleteOne', operation: 'deleteOne' },
    { method: 'deleteMany', operation: 'deleteMany' },
    { method: 'updateOne', operation: 'updateOne' },
    { method: 'updateMany', operation: 'updateMany' },
    { method: 'replaceOne', operation: 'replaceOne' },
    { method: 'distinct', operation: 'distinct' },
    { method: 'countDocuments', operation: 'countDocuments' },
    { method: 'estimatedDocumentCount', operation: 'estimatedDocumentCount' },
  ];

  for (const { method, operation } of queryMethods) {
    wrapQueryReturningMethod(
      m.Model,
      method,
      operation,
      describeModel,
      tracer,
      finalConfig,
      captureStatement,
    );

    // Also patch chainable Query methods to capture context
    if (m.Query?.prototype?.[method]) {
      wrapChainableMethod(m.Query.prototype, method);
    }
  }

  // Patch Model instance methods
  const instanceMethods = ['save', 'deleteOne'];
  for (const method of instanceMethods) {
    if (m.Model.prototype[method]) {
      wrapInstanceMethod(
        m.Model.prototype,
        method,
        method,
        describeDocument,
        tracer,
        finalConfig,
        captureStatement,
      );
    }
  }

  // Patch Model static methods
  const staticMethods = ['create', 'insertMany', 'aggregate', 'bulkWrite'];
  for (const method of staticMethods) {
    if (m.Model[method]) {
      wrapStaticMethod(
        m.Model,
        method,
        method,
        describeModel,
        tracer,
        finalConfig,
        captureStatement,
      );
    }
  }

  // `connection.aggregate()` runs a database-level pipeline (`$currentOp`,
  // `$documents`): no model, no collection, so the span names the database.
  const connectionPrototype = asRecord(m.connection)
    ? Object.getPrototypeOf(m.connection)
    : undefined;
  if (isFunction(connectionPrototype?.aggregate)) {
    wrapStaticMethod(
      connectionPrototype,
      'aggregate',
      'aggregate',
      describeConnection,
      tracer,
      finalConfig,
      captureStatement,
    );
  }

  // Patch Query chainable methods
  const chainableMethods = [
    'populate',
    'select',
    'lean',
    'where',
    'sort',
    'limit',
    'skip',
  ];
  for (const method of chainableMethods) {
    if (m.Query?.prototype?.[method]) {
      wrapChainableMethod(m.Query.prototype, method);
    }
  }

  m[INSTRUMENTED_FLAG] = true;
  return mongoose;
}

/**
 * Legacy export for backwards compatibility.
 * @deprecated Use `instrumentMongoose` instead.
 */
export class MongooseInstrumentation {
  constructor(private config?: InstrumentMongooseConfig) {}

  enable(mongoose: Mongoose): void {
    instrumentMongoose(mongoose, this.config);
  }
}
