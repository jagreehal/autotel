/* eslint-disable @typescript-eslint/no-explicit-any */
// Note: `any` is only used for dynamic method wrapping on runtime objects.
// Type-safe interfaces are used for all public APIs.

import { SpanKind, otelTrace as trace, type Span, type Tracer } from 'autotel';
import {
  SEMATTRS_DB_SYSTEM,
  SEMATTRS_DB_OPERATION,
  SEMATTRS_DB_MONGODB_COLLECTION,
  SEMATTRS_DB_NAME,
  SEMATTRS_NET_PEER_NAME,
  SEMATTRS_NET_PEER_PORT,
} from '../common/constants';
import {
  runWithSpan,
  finalizeSpan,
  getActiveSpan,
} from 'autotel/trace-helpers';

const DEFAULT_TRACER_NAME = 'autotel-plugins/mongoose';
const DEFAULT_DB_SYSTEM = 'mongoose';
const INSTRUMENTED_FLAG = '__autotelMongooseInstrumented' as const;

/**
 * Symbol used to store the parent span on Query/Aggregate objects.
 * This preserves context across chainable query methods.
 */
export const _STORED_PARENT_SPAN: unique symbol = Symbol('stored-parent-span');

/**
 * Configuration options for Mongoose instrumentation.
 * Focused on Mongoose 8+ with promise-based API only.
 */
export interface MongooseInstrumentationConfig {
  /**
   * Database name to include in spans.
   */
  dbName?: string;

  /**
   * Remote hostname or IP address of the MongoDB server.
   */
  peerName?: string;

  /**
   * Remote port number of the MongoDB server (default: 27017).
   */
  peerPort?: number;

  /**
   * Custom tracer name (default: "autotel-plugins/mongoose").
   */
  tracerName?: string;

  /**
   * Whether to capture collection names in spans (default: true).
   */
  captureCollectionName?: boolean;

  /**
   * Whether to instrument Schema hooks (pre/post save, validate, etc).
   * Disabled by default because hooks interact with Mongoose plugins.
   * Enable only if you have user-defined hooks you want to trace.
   * (default: false)
   */
  instrumentHooks?: boolean;
}

/**
 * Creates a span for a Mongoose operation.
 */
function createSpan(
  tracer: Tracer,
  operation: string,
  modelName: string | undefined,
  collectionName: string | undefined,
  config: Required<MongooseInstrumentationConfig>,
): Span {
  const spanName = collectionName
    ? `mongoose.${collectionName}.${operation}`
    : modelName
      ? `mongoose.${modelName}.${operation}`
      : `mongoose.${operation}`;

  const attributes: Record<string, any> = {
    [SEMATTRS_DB_SYSTEM]: DEFAULT_DB_SYSTEM,
    [SEMATTRS_DB_OPERATION]: operation,
  };

  if (collectionName && config.captureCollectionName) {
    attributes[SEMATTRS_DB_MONGODB_COLLECTION] = collectionName;
  }

  if (config.dbName) {
    attributes[SEMATTRS_DB_NAME] = config.dbName;
  }

  if (config.peerName) {
    attributes[SEMATTRS_NET_PEER_NAME] = config.peerName;
  }

  if (config.peerPort) {
    attributes[SEMATTRS_NET_PEER_PORT] = config.peerPort;
  }

  return tracer.startSpan(spanName, { kind: SpanKind.CLIENT, attributes });
}

/**
 * Wraps a method to trace Query/Aggregate execution with proper span lifecycle.
 * Returns the Query/Aggregate object with wrapped exec() to finalize span.
 */
function wrapQueryMethod(
  target: any,
  methodName: string,
  operation: string,
  getCollectionName: (obj: any) => string | undefined,
  getModelName: (obj: any) => string | undefined,
  tracer: Tracer,
  config: Required<MongooseInstrumentationConfig>,
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

        // If result is a Query/Aggregate, wrap exec() and preserve it
        if (result && typeof result.exec === 'function') {
          const originalExec = result.exec.bind(result);

          result.exec = function wrappedExec(): Promise<any> {
            try {
              const execPromise = originalExec();

              return Promise.resolve(execPromise)
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
            } catch (error) {
              finalizeSpan(
                span,
                error instanceof Error ? error : new Error(String(error)),
              );
              throw error;
            }
          };

          return result; // Return Query/Aggregate, not Promise
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
 * Wraps chainable Query methods (find, findOne, etc.) to capture span context.
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

/**
 * Patches Mongoose Schema hooks (pre/post) to automatically trace them.
 * Only wraps user-defined hooks, skipping Mongoose's internal hooks.
 */
function patchSchemaHooks(
  Schema: any,
  tracer: Tracer,
  config: Required<MongooseInstrumentationConfig>,
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
 * Skips private methods (starting with _) and known Mongoose internals.
 */
function isMongooseInternalHook(handler: any): boolean {
  if (typeof handler !== 'function') {
    return false;
  }

  const funcName = handler.name || '';

  // Skip private/internal methods (starting with _ or __)
  if (funcName.startsWith('_')) {
    return true;
  }

  // Skip other known Mongoose internal hooks
  const mongooseInternalPatterns = [
    'shardingPlugin',
    'mongooseInternalHook',
    'noop',
    '$__',
  ];

  return mongooseInternalPatterns.some((pattern) => funcName.includes(pattern));
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
  config: Required<MongooseInstrumentationConfig>,
): any {
  if (typeof handler !== 'function') {
    return handler;
  }

  return function wrappedHook(this: any, ...args: any[]): any {
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
      span.setAttribute(SEMATTRS_DB_MONGODB_COLLECTION, collectionName);
    }
    span.setAttribute(SEMATTRS_DB_SYSTEM, DEFAULT_DB_SYSTEM);
    if (config.dbName) {
      span.setAttribute(SEMATTRS_DB_NAME, config.dbName);
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
 * import { instrumentMongoose } from 'autotel-plugins/mongoose';
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
  mongoose: any,
  config?: MongooseInstrumentationConfig,
): typeof mongoose {
  if (!mongoose?.Model) {
    return mongoose;
  }

  if (mongoose[INSTRUMENTED_FLAG]) {
    return mongoose;
  }

  const finalConfig: Required<MongooseInstrumentationConfig> = {
    dbName: config?.dbName || '',
    peerName: config?.peerName || '',
    peerPort: config?.peerPort || 27_017,
    tracerName: config?.tracerName || DEFAULT_TRACER_NAME,
    captureCollectionName: config?.captureCollectionName ?? true,
    instrumentHooks: config?.instrumentHooks ?? false,
  };

  const tracer = trace.getTracer(finalConfig.tracerName);

  // Patch Schema hooks only if enabled
  if (mongoose.Schema && finalConfig.instrumentHooks) {
    patchSchemaHooks(mongoose.Schema, tracer, finalConfig);
  }

  // Helper functions
  const getModelCollectionName = (model: any) => {
    try {
      return model.collection?.collectionName || model.modelName;
    } catch {
      return;
    }
  };

  // Patch Query methods
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
    wrapQueryMethod(
      mongoose.Model,
      method,
      operation,
      getModelCollectionName,
      (model: any) => model.modelName,
      tracer,
      finalConfig,
    );

    // Also patch chainable Query methods to capture context
    if (mongoose.Query?.prototype?.[method]) {
      wrapChainableMethod(mongoose.Query.prototype, method);
    }
  }

  // Patch Model instance methods
  const instanceMethods = ['save', 'deleteOne'];
  for (const method of instanceMethods) {
    if (mongoose.Model.prototype[method]) {
      wrapQueryMethod(
        mongoose.Model.prototype,
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
      );
    }
  }

  // Patch Model static methods
  const staticMethods = ['create', 'insertMany', 'aggregate', 'bulkWrite'];
  for (const method of staticMethods) {
    if (mongoose.Model[method]) {
      wrapQueryMethod(
        mongoose.Model,
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
    if (mongoose.Query?.prototype?.[method]) {
      wrapChainableMethod(mongoose.Query.prototype, method);
    }
  }

  mongoose[INSTRUMENTED_FLAG] = true;
  return mongoose;
}

/**
 * Legacy export for backwards compatibility.
 * @deprecated Use `instrumentMongoose` instead.
 */
export class MongooseInstrumentation {
  constructor(private config?: MongooseInstrumentationConfig) {}

  enable(mongoose: any): void {
    instrumentMongoose(mongoose, this.config);
  }
}
