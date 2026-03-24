// Note: `any` is only used for dynamic method wrapping on runtime objects.
// Type-safe interfaces are used for all public APIs.
// Mongoose is a devDependency so we type-check against the real API; consumers use the peer.

import type { Mongoose } from 'mongoose';
import { otelTrace as trace, SpanKind } from 'autotel';
import type { Span, Tracer } from 'autotel';
import {
  runWithSpan,
  finalizeSpan,
  getActiveSpan,
} from 'autotel/trace-helpers';

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
  InstrumentMongooseConfig,
  ResolvedConfig,
  SerializerPayload,
} from './types';
import { DEFAULT_TRACER_NAME } from './types';
import {
  createStatementCapture,
  defaultSerializer,
  type StatementCaptureFn,
} from './statement';

const INSTRUMENTED_FLAG = '__autotelMongooseInstrumented' as const;
const WRAPPED_HOOK_FLAG = '__autotelWrappedHook' as const;

/**
 * Symbol used to store the parent span on Query/Aggregate objects.
 * This preserves context across chainable query methods.
 */
export const _STORED_PARENT_SPAN: unique symbol = Symbol('stored-parent-span');

// ---------------------------------------------------------------------------
// Span creation
// ---------------------------------------------------------------------------

/**
 * Creates a span for a Mongoose operation.
 * Note: db.query.text is NOT set here — callers set it after payload extraction.
 */
function createSpan(
  tracer: Tracer,
  operation: string,
  modelName: string | undefined,
  collectionName: string | undefined,
  config: ResolvedConfig,
): Span {
  const spanName = collectionName
    ? `${operation} ${collectionName}`
    : modelName
      ? `${operation} ${modelName}`
      : `mongoose.${operation}`;

  const attributes: Record<string, any> = {
    [ATTR_DB_SYSTEM_NAME]: DB_SYSTEM_NAME_VALUE_MONGODB,
    [ATTR_DB_OPERATION_NAME]: operation,
  };

  if (collectionName && config.captureCollectionName) {
    attributes[ATTR_DB_COLLECTION_NAME] = collectionName;
  }
  if (config.dbName) {
    attributes[ATTR_DB_NAMESPACE] = config.dbName;
  }
  if (config.peerName) {
    attributes[ATTR_SERVER_ADDRESS] = config.peerName;
  }
  if (config.peerPort) {
    attributes[ATTR_SERVER_PORT] = config.peerPort;
  }

  return tracer.startSpan(spanName, { kind: SpanKind.CLIENT, attributes });
}

// ---------------------------------------------------------------------------
// Wrapper helpers
// ---------------------------------------------------------------------------

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
  getCollectionName: (obj: any) => string | undefined,
  getModelName: (obj: any) => string | undefined,
  tracer: Tracer,
  config: ResolvedConfig,
  captureStatement: StatementCaptureFn,
): void {
  const original = target[methodName];
  if (typeof original !== 'function') {
    return;
  }

  target[methodName] = function instrumented(this: any, ...args: any[]): any {
    const collectionName = getCollectionName(this);
    const modelName = getModelName(this);
    const span = createSpan(
      tracer,
      operation,
      modelName,
      collectionName,
      config,
    );

    return runWithSpan(span, () => {
      try {
        const result = original.apply(this, args);

        // Extract payload from the returned Query object
        if (result && typeof result.exec === 'function') {
          try {
            const payload: SerializerPayload = {};
            if (typeof result.getFilter === 'function') {
              payload.condition = result.getFilter();
            }
            if (result._update !== undefined) {
              payload.updates = result._update;
            }
            if (typeof result.getOptions === 'function') {
              payload.options = result.getOptions();
            }
            if (result._fields !== undefined) {
              payload.fields = result._fields;
            }
            const statementText = captureStatement(operation, payload);
            if (statementText) {
              span.setAttribute(ATTR_DB_QUERY_TEXT, statementText);
            }
          } catch {
            // Ignore errors in payload extraction
          }

          // Wrap exec() to finalize span
          const originalExec = result.exec.bind(result);
          result.exec = function wrappedExec(): Promise<any> {
            try {
              const execPromise = originalExec();
              return Promise.resolve(execPromise)
                .then((value: any) => {
                  finalizeSpan(span);
                  return value;
                })
                .catch((error: unknown) => {
                  finalizeSpan(
                    span,
                    error instanceof Error ? error : new Error(String(error)),
                  );
                  throw error;
                });
            } catch (error) {
              finalizeSpan(
                span,
                error instanceof Error ? error : new Error(String(error)),
              );
              throw error;
            }
          };

          return result; // Return Query, not Promise
        }

        // Fallback for unexpected non-query results
        finalizeSpan(span);
        return result;
      } catch (error) {
        finalizeSpan(
          span,
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  };
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
  getCollectionName: (obj: any) => string | undefined,
  getModelName: (obj: any) => string | undefined,
  tracer: Tracer,
  config: ResolvedConfig,
  captureStatement: StatementCaptureFn,
): void {
  const original = target[methodName];
  if (typeof original !== 'function') {
    return;
  }

  target[methodName] = function instrumented(this: any, ...args: any[]): any {
    const collectionName = getCollectionName(this);
    const modelName = getModelName(this);

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
    );

    try {
      const statementText = captureStatement(operation, payload);
      if (statementText) {
        span.setAttribute(ATTR_DB_QUERY_TEXT, statementText);
      }
    } catch {
      // Ignore serialization errors
    }

    return runWithSpan(span, () => {
      try {
        const result = original.apply(this, args);

        // If result has exec() (e.g., aggregate), wrap it
        if (result && typeof result.exec === 'function') {
          const originalExec = result.exec.bind(result);
          result.exec = function wrappedExec(): Promise<any> {
            try {
              const execPromise = originalExec();
              return Promise.resolve(execPromise)
                .then((value: any) => {
                  finalizeSpan(span);
                  return value;
                })
                .catch((error: unknown) => {
                  finalizeSpan(
                    span,
                    error instanceof Error ? error : new Error(String(error)),
                  );
                  throw error;
                });
            } catch (error) {
              finalizeSpan(
                span,
                error instanceof Error ? error : new Error(String(error)),
              );
              throw error;
            }
          };
          return result;
        }

        // For direct promise results (e.g., create, insertMany)
        if (result && typeof result.then === 'function') {
          return Promise.resolve(result as Promise<any>)
            .then((value) => {
              finalizeSpan(span);
              return value;
            })
            .catch((error: unknown) => {
              finalizeSpan(
                span,
                error instanceof Error ? error : new Error(String(error)),
              );
              throw error;
            });
        }

        finalizeSpan(span);
        return result;
      } catch (error) {
        finalizeSpan(
          span,
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  };
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
  getCollectionName: (obj: any) => string | undefined,
  getModelName: (obj: any) => string | undefined,
  tracer: Tracer,
  config: ResolvedConfig,
  captureStatement: StatementCaptureFn,
): void {
  const original = target[methodName];
  if (typeof original !== 'function') {
    return;
  }

  target[methodName] = function instrumented(this: any, ...args: any[]): any {
    const collectionName = getCollectionName(this);
    const modelName = getModelName(this);

    // Extract document before calling original
    const payload: SerializerPayload = {};
    try {
      if (typeof this.toObject === 'function') {
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
    );

    try {
      const statementText = captureStatement(operation, payload);
      if (statementText) {
        span.setAttribute(ATTR_DB_QUERY_TEXT, statementText);
      }
    } catch {
      // Ignore serialization errors
    }

    return runWithSpan(span, () => {
      try {
        const result = original.apply(this, args);

        // Instance methods return promises
        if (result && typeof result.then === 'function') {
          return Promise.resolve(result as Promise<any>)
            .then((value) => {
              finalizeSpan(span);
              return value;
            })
            .catch((error: unknown) => {
              finalizeSpan(
                span,
                error instanceof Error ? error : new Error(String(error)),
              );
              throw error;
            });
        }

        finalizeSpan(span);
        return result;
      } catch (error) {
        finalizeSpan(
          span,
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  };
}

// ---------------------------------------------------------------------------
// Chainable method wrapping (copied from original)
// ---------------------------------------------------------------------------

/**
 * Wraps chainable Query methods (populate, select, lean, etc.) to capture span context.
 */
function wrapChainableMethod(target: any, methodName: string): void {
  const original = target[methodName];
  if (typeof original !== 'function') {
    return;
  }

  target[methodName] = function captureContext(this: any, ...args: any[]): any {
    const currentSpan = getActiveSpan();
    const result = original.apply(this, args);

    // Store parent span on returned Query for exec() calls
    if (result && typeof result.exec === 'function') {
      (result as any)[_STORED_PARENT_SPAN] = currentSpan;
    }

    return result;
  };
}

// ---------------------------------------------------------------------------
// Schema hook instrumentation (copied from original, updated semconv)
// ---------------------------------------------------------------------------

/**
 * Patches Mongoose Schema hooks (pre/post) to automatically trace them.
 * Only wraps user-defined hooks, skipping Mongoose's internal hooks.
 */
function patchSchemaHooks(
  Schema: any,
  tracer: Tracer,
  config: ResolvedConfig,
): void {
  if (!Schema?.prototype) {
    return;
  }

  const HOOK_FLAG = '__autotelHookInstrumented' as const;
  if ((Schema.prototype as any)[HOOK_FLAG]) {
    return;
  }

  const originalPre = Schema.prototype.pre;
  if (typeof originalPre === 'function') {
    Schema.prototype.pre = function (hookName: string, ...args: any[]): any {
      const handler =
        typeof args[0] === 'function'
          ? args[0]
          : typeof args[1] === 'function'
            ? args[1]
            : null;

      // Only wrap user-defined hooks, skip Mongoose internals
      if (handler && !isMongooseInternalHook(handler)) {
        const wrapped = wrapHookHandler(
          handler,
          hookName,
          'pre',
          tracer,
          config,
        );
        if (typeof args[0] === 'function') {
          args[0] = wrapped;
        } else if (typeof args[1] === 'function') {
          args[1] = wrapped;
        }
      }

      return Reflect.apply(originalPre, this, [hookName, ...args]);
    };
  }

  const originalPost = Schema.prototype.post;
  if (typeof originalPost === 'function') {
    Schema.prototype.post = function (hookName: string, ...args: any[]): any {
      const handler =
        typeof args[0] === 'function'
          ? args[0]
          : typeof args[1] === 'function'
            ? args[1]
            : null;

      // Only wrap user-defined hooks, skip Mongoose internals
      if (handler && !isMongooseInternalHook(handler)) {
        const wrapped = wrapHookHandler(
          handler,
          hookName,
          'post',
          tracer,
          config,
        );
        if (typeof args[0] === 'function') {
          args[0] = wrapped;
        } else if (typeof args[1] === 'function') {
          args[1] = wrapped;
        }
      }

      return Reflect.apply(originalPost, this, [hookName, ...args]);
    };
  }

  (Schema.prototype as any)[HOOK_FLAG] = true;
}

/**
 * Detects if a hook handler is from Mongoose's internal code.
 * Skips private methods, known internal patterns, and functions with
 * Mongoose-internal source code signatures.
 *
 * Note: We intentionally allow anonymous functions because user-defined
 * hooks are often anonymous (e.g., `schema.pre('save', async function() {...})`).
 */
function isMongooseInternalHook(handler: any): boolean {
  if (typeof handler !== 'function') {
    return false;
  }

  const funcName = handler.name || '';

  // Skip private/internal methods (starting with _ or $)
  if (funcName.startsWith('_') || funcName.startsWith('$')) {
    return true;
  }

  // Skip known Mongoose internal hook patterns by name
  const mongooseInternalNamePatterns = [
    'shardingPlugin',
    'mongooseInternalHook',
    'noop',
    'wrapped',
    'bound ',
  ];

  if (
    mongooseInternalNamePatterns.some((pattern) => funcName.includes(pattern))
  ) {
    return true;
  }

  // Check function source for Mongoose-internal patterns
  // These patterns appear in Mongoose's auto-generated validation/transform hooks
  try {
    const source = handler.toString();
    const mongooseInternalSourcePatterns = [
      'this.$__', // Mongoose internal document methods
      'this.$isValid', // Mongoose validation
      'this.$locals', // Mongoose local properties
      '_this.$__', // Mongoose internal with closure
      'schema.s.hooks', // Mongoose hooks system
      'kareem', // Mongoose's hooks library
    ];

    if (
      mongooseInternalSourcePatterns.some((pattern) => source.includes(pattern))
    ) {
      return true;
    }
  } catch {
    // If we can't get source, allow the hook through
  }

  return false;
}

/**
 * Wraps a hook handler to trace its execution.
 * Handles both callback-style (with next) and promise-style hooks.
 */
function wrapHookHandler(
  handler: any,
  hookName: string,
  hookType: 'pre' | 'post',
  tracer: Tracer,
  config: ResolvedConfig,
): any {
  if (typeof handler !== 'function') {
    return handler;
  }

  // Skip if already wrapped to prevent duplicate spans
  if ((handler as any)[WRAPPED_HOOK_FLAG]) {
    return handler;
  }

  const wrappedHook = function wrappedHook(this: any, ...args: any[]): any {
    let modelName: string | undefined;
    let collectionName: string | undefined;

    try {
      if (this.constructor?.modelName) {
        modelName = this.constructor.modelName;
        collectionName =
          this.constructor.collection?.collectionName || modelName;
      } else if (this.model?.modelName) {
        modelName = this.model.modelName;
        collectionName = this.model.collection?.collectionName || modelName;
      }
    } catch {
      // Ignore errors in extracting context
    }

    const spanName = collectionName
      ? `mongoose.${collectionName}.${hookType}.${hookName}`
      : `mongoose.hook.${hookType}.${hookName}`;

    const span = tracer.startSpan(spanName, { kind: SpanKind.INTERNAL });
    span.setAttribute('hook.type', hookType);
    span.setAttribute('hook.operation', hookName);
    if (modelName) {
      span.setAttribute('hook.model', modelName);
    }
    if (collectionName && config.captureCollectionName) {
      span.setAttribute(ATTR_DB_COLLECTION_NAME, collectionName);
    }
    span.setAttribute(ATTR_DB_SYSTEM_NAME, DB_SYSTEM_NAME_VALUE_MONGODB);
    if (config.dbName) {
      span.setAttribute(ATTR_DB_NAMESPACE, config.dbName);
    }

    return runWithSpan(span, () => {
      try {
        const result = handler.apply(this, args);

        if (result && typeof result.then === 'function') {
          return Promise.resolve(result as Promise<any>)
            .then((value) => {
              finalizeSpan(span);
              return value;
            })
            .catch((error: unknown) => {
              finalizeSpan(
                span,
                error instanceof Error ? error : new Error(String(error)),
              );
              throw error;
            });
        }

        finalizeSpan(span);
        return result;
      } catch (error) {
        finalizeSpan(
          span,
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  };

  // Mark as wrapped to prevent double-wrapping
  (wrappedHook as any)[WRAPPED_HOOK_FLAG] = true;
  return wrappedHook;
}

// ---------------------------------------------------------------------------
// Main instrumentation function
// ---------------------------------------------------------------------------

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

  const m = mongoose as any;
  if (m[INSTRUMENTED_FLAG]) {
    return mongoose;
  }

  // Resolve statement-related config separately (they accept undefined)
  const resolvedSerializer = config?.dbStatementSerializer;
  const resolvedRedactor = config?.statementRedactor ?? 'default';

  const finalConfig: ResolvedConfig = {
    dbName: config?.dbName || '',
    peerName: config?.peerName || '',
    peerPort: config?.peerPort || 27_017,
    tracerName: config?.tracerName || DEFAULT_TRACER_NAME,
    captureCollectionName: config?.captureCollectionName ?? true,
    instrumentHooks: config?.instrumentHooks ?? false,
    dbStatementSerializer:
      resolvedSerializer === false
        ? false
        : (resolvedSerializer ?? defaultSerializer),
    statementRedactor: resolvedRedactor,
  };

  const tracer = trace.getTracer(finalConfig.tracerName);

  // Create statement capture function
  const captureStatement = createStatementCapture({
    dbStatementSerializer: resolvedSerializer,
    statementRedactor: resolvedRedactor,
  });

  // Patch Schema hooks only if enabled
  if (m.Schema && finalConfig.instrumentHooks) {
    patchSchemaHooks(m.Schema, tracer, finalConfig);
  }

  // Helper functions
  const getModelCollectionName = (model: any) => {
    try {
      return model.collection?.collectionName || model.modelName;
    } catch {
      return;
    }
  };

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
    { method: 'countDocuments', operation: 'countDocuments' },
    { method: 'estimatedDocumentCount', operation: 'estimatedDocumentCount' },
  ];

  for (const { method, operation } of queryMethods) {
    wrapQueryReturningMethod(
      m.Model,
      method,
      operation,
      getModelCollectionName,
      (model: any) => model.modelName,
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
        (doc: any) => {
          try {
            return (
              doc.constructor?.collection?.collectionName ||
              doc.constructor?.modelName
            );
          } catch {
            return;
          }
        },
        (doc: any) => {
          try {
            return doc.constructor?.modelName;
          } catch {
            return;
          }
        },
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
        (model: any) => {
          try {
            return model.collection?.collectionName;
          } catch {
            return;
          }
        },
        (model: any) => model.modelName,
        tracer,
        finalConfig,
        captureStatement,
      );
    }
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
