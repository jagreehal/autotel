// Note: `any` is only used for dynamic method wrapping on runtime objects.
// Type-safe interfaces are used for all public APIs.
// Mongoose is a devDependency so we type-check against the real API; consumers use the peer.

import type { Mongoose } from 'mongoose';
import { otelTrace as trace, context, SpanKind } from 'autotel';
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
  ATTR_CODE_FUNCTION_NAME,
  ATTR_MONGOOSE_METHOD_NAME,
  ATTR_MONGOOSE_METHOD_TYPE,
  ATTR_MONGOOSE_METHOD_MODEL,
  ATTR_MONGOOSE_METHOD_PARAMETERS,
  ATTR_MONGOOSE_METHOD_PARAMETER_COUNT,
  DB_SYSTEM_NAME_VALUE_MONGODB,
} from './constants';
import type {
  InstrumentMongooseConfig,
  ResolvedConfig,
  ResolvedCustomMethods,
  CustomMethodsConfig,
  CustomMethodType,
  MethodSelector,
  SerializerPayload,
} from './types';
import { DEFAULT_TRACER_NAME } from './types';
import {
  createStatementCapture,
  createParameterCapture,
  defaultSerializer,
  type StatementCaptureFn,
} from './statement';

const INSTRUMENTED_FLAG = '__autotelMongooseInstrumented' as const;
const WRAPPED_HOOK_FLAG = '__autotelWrappedHook' as const;
const WRAPPED_METHOD_FLAG = '__autotelWrappedMethod' as const;
const MODEL_PATCHED_FLAG = '__autotelModelPatched' as const;
const PROXIED_COLLECTION_FLAG = '__autotelProxiedCollection' as const;

/**
 * Per-Mongoose-instance registry of the resolved tracer + config.
 *
 * Custom-function wrappers are installed once on the (potentially shared)
 * schema object, so they must NOT close over a single instance's
 * tracer/config — a schema reused across instances/connections would otherwise
 * be permanently bound to whichever instrumented it first. Instead each wrapper
 * resolves the owning Mongoose instance from its runtime `this` and looks up
 * the config here at call time. An instance that was never instrumented (or has
 * custom methods disabled) is absent, so its calls pass straight through.
 */
const INSTANCE_REGISTRY = new WeakMap<
  object,
  { tracer: Tracer; config: ResolvedConfig }
>();

/** Resolves the owning Mongoose instance from a custom function's `this`. */
function resolveMongooseInstance(
  self: any,
  methodType: CustomMethodType,
): object | undefined {
  try {
    switch (methodType) {
      case 'static': {
        // `this` is the Model.
        return self?.base ?? self?.db?.base;
      }
      case 'instance': {
        // `this` is the Document; its constructor is the Model.
        return self?.constructor?.base ?? self?.db?.base;
      }
      case 'query': {
        // `this` is the Query.
        return self?.model?.base;
      }
    }
  } catch {
    // Ignore — treated as "not instrumented".
  }
  return undefined;
}

/** Picks the selector for a given method category from a resolved config. */
function selectorFor(
  cm: ResolvedCustomMethods,
  methodType: CustomMethodType,
): MethodSelector {
  switch (methodType) {
    case 'static': {
      return cm.statics;
    }
    case 'instance': {
      return cm.methods;
    }
    case 'query': {
      return cm.query;
    }
  }
}

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
 * Returns an idempotent finalizer for a span. Every wrapper invocation may try
 * to close its span from more than one place — a callback, an `exec()`
 * continuation, a promise settlement, a synchronous return, or a thrown error —
 * and the span must be ended exactly once. The first call wins; later calls are
 * no-ops. A non-Error rejection is normalized to an `Error`.
 */
function createSpanFinalizer(span: Span): (error?: unknown) => void {
  let done = false;
  return (error?: unknown): void => {
    if (done) {
      return;
    }
    done = true;
    finalizeSpan(
      span,
      error === undefined || error === null
        ? undefined
        : error instanceof Error
          ? error
          : new Error(String(error)),
    );
  };
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
 * "the span ends when the work ends" lives in exactly one place.
 */
function settleSpan(result: any, finalize: (error?: unknown) => void): any {
  if (result && typeof result.exec === 'function') {
    const originalExec = result.exec.bind(result);
    result.exec = function wrappedExec(): Promise<any> {
      try {
        return Promise.resolve(originalExec()).then(
          (value: any) => {
            finalize();
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
    return result;
  }

  if (result && typeof result.then === 'function') {
    return Promise.resolve(result as Promise<any>).then(
      (value) => {
        finalize();
        return value;
      },
      (error: unknown) => {
        finalize(error);
        throw error;
      },
    );
  }

  finalize();
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
function deferFinalizeToCallback(
  args: any[],
  span: Span,
  finalize: (error?: unknown) => void,
): { callArgs: any[]; deferred: boolean } {
  const lastIndex = args.length - 1;
  const maybeCallback = lastIndex >= 0 ? args[lastIndex] : undefined;
  if (typeof maybeCallback !== 'function') {
    return { callArgs: args, deferred: false };
  }

  const callArgs = [...args];
  callArgs[lastIndex] = function tracedCallback(
    this: any,
    ...callbackArgs: any[]
  ): any {
    try {
      return runWithSpan(span, () => maybeCallback.apply(this, callbackArgs));
    } finally {
      finalize(callbackArgs[0]);
    }
  };
  return { callArgs, deferred: true };
}

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

    const finalize = createSpanFinalizer(span);
    return runWithSpan(span, () => {
      try {
        const result = original.apply(this, args);

        // Extract the query payload from the returned Query before it executes.
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
        }

        // settleSpan wraps exec() (Query) or finalizes a non-query result.
        return settleSpan(result, finalize);
      } catch (error) {
        finalize(error);
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

    const finalize = createSpanFinalizer(span);
    return runWithSpan(span, () => {
      try {
        // exec() (e.g. aggregate), promise (create/insertMany), or sync value.
        return settleSpan(original.apply(this, args), finalize);
      } catch (error) {
        finalize(error);
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

    const finalize = createSpanFinalizer(span);
    return runWithSpan(span, () => {
      try {
        // Instance methods (save/deleteOne) return promises; sync is tolerated.
        return settleSpan(original.apply(this, args), finalize);
      } catch (error) {
        finalize(error);
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
    'timestampsPreSave',
    'timestampsPreUpdate',
    'handleTimestampOption',
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
 *
 * Exported for unit testing against Kareem directly; not part of the public
 * package API (`index.ts` does not re-export it).
 */
export function wrapHookHandler(
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

  const startHookSpan = (self: any) => {
    let modelName: string | undefined;
    let collectionName: string | undefined;

    try {
      if (self.constructor?.modelName) {
        modelName = self.constructor.modelName;
        collectionName =
          self.constructor.collection?.collectionName || modelName;
      } else if (self.model?.modelName) {
        modelName = self.model.modelName;
        collectionName = self.model.collection?.collectionName || modelName;
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

    return span;
  };

  const invokeHook = (
    self: any,
    span: Span,
    args: any[],
    callbackStyle: boolean,
  ) =>
    runWithSpan(span, () => {
      try {
        const result = handler.apply(self, args);

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

        // Only finalize synchronously for non-callback hooks.
        // Callback-style hooks finalize in the wrappedNext above.
        if (!callbackStyle) {
          finalizeSpan(span);
        }
        return result;
      } catch (error) {
        finalizeSpan(
          span,
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });

  const wrappedHook = function wrappedHook(
    this: any,
    ...runtimeArgs: any[]
  ): any {
    // Captured before the span becomes active, so it points at the true
    // parent (the operation span / prior sibling's parent) — not at this
    // hook's own span. Used to fence off the span's context when we hand
    // control back to Kareem via `next()` below.
    const parentContext = context.active();
    const span = startHookSpan(this);

    // Whether this invocation is callback-style is decided at *call* time, and
    // `next` — by Mongoose convention — is always the handler's *last* declared
    // parameter, i.e. `handler.length - 1`. But `pre` and `post` reach Kareem
    // through different calling conventions, so detection differs:
    //
    //   - `post` hooks: Kareem *always* appends a real `next`
    //     (`kareem/index.js` `newArgs.push(nextCallback)`). The hook is
    //     callback-style only if the handler's declared slot is the one Kareem
    //     filled with a function. Checking that exact slot (rather than
    //     scanning) matters both ways: scanning from the front would grab a
    //     leading Model/Document (Mongoose Models are functions); accepting a
    //     function *anywhere* would grab the appended `next` even for a data
    //     hook like `post('save', (doc) => {})` that never reads it — deferring
    //     finalization to a callback the handler never calls, leaking the span.
    //     Pinning to the declared slot also subsumes the old `init` carve-out:
    //     `post('init', (doc))` is handed `[doc]` with no callback, so it is
    //     simply promise/sync-style.
    //
    //   - `pre` hooks: Kareem's `execPre` calls the handler with the operation
    //     args and *never* passes a callback. So a declared parameter means the
    //     handler is callback-style and we must synthesize `next` ourselves;
    //     there is no downstream callback to forward to.
    //
    // Restoring the original arity on this wrapper (see `defineProperty` below)
    // is what lets Kareem's own exact-arity checks line up in the `post` case.
    const expectedIndex = handler.length - 1;
    const realCallback =
      expectedIndex >= 0 && typeof runtimeArgs[expectedIndex] === 'function'
        ? (runtimeArgs[expectedIndex] as (...args: any[]) => void)
        : undefined;
    const isCallbackStyle =
      hookType === 'pre' ? handler.length > 0 : realCallback !== undefined;

    if (!isCallbackStyle) {
      // Promise- or sync-style: pass Kareem's args through untouched and let
      // `invokeHook` finalize on the returned promise, or synchronously.
      return invokeHook(this, span, runtimeArgs, false);
    }

    const wrappedNext = function wrappedNext(this: any, ...nextArgs: any[]) {
      const err = nextArgs[0];
      if (err) {
        finalizeSpan(span, err instanceof Error ? err : new Error(String(err)));
      } else {
        finalizeSpan(span);
      }
      // Forward to Kareem's real callback (post); a synthesized `pre` callback
      // has nothing downstream to call.
      //
      // Restore the parent context first. Under Kareem's callback protocol
      // (Mongoose < 8 / kareem v2), `next()` is often invoked from inside a
      // hook's own async continuation (e.g. `Model.findById(...).then(next)`),
      // which still runs with this hook's span active. Kareem advances the
      // chain synchronously from within that callback, so the *next* sibling
      // hook — and the query spans it opens — would otherwise be parented to
      // this already-ended span. Fencing the handoff keeps siblings siblings.
      if (typeof realCallback === 'function') {
        const cb = realCallback;
        return context.with(parentContext, () => cb.apply(this, nextArgs));
      }
      return;
    };

    // Put `next` at the handler's declared position. For `post` this replaces
    // Kareem's real callback in place, keeping surrounding args (e.g. `doc` in
    // `post('findOneAndUpdate', (doc, next))`) in the order the handler
    // declared. For `pre` it fills the slot Mongoose left empty.
    const callArgs = [...runtimeArgs];
    callArgs[expectedIndex] = wrappedNext;
    return invokeHook(this, span, callArgs, true);
  };

  // Kareem inspects `fn.length` with *exact* comparisons — e.g.
  // `post.fn.length === numArgs + 2` to detect error-handling middleware, and
  // `post.length === numArgs + 1` to decide whether to await the callback.
  // Our `...runtimeArgs` wrapper reports length 0, which would collapse every
  // handler's arity and silently break both checks, so restore the original.
  // Same idiom as `packages/autotel-edge/src/core/context.ts`.
  Object.defineProperty(wrappedHook, 'length', {
    enumerable: false,
    configurable: true,
    writable: false,
    value: handler.length,
  });

  // Mark as wrapped to prevent double-wrapping
  (wrappedHook as any)[WRAPPED_HOOK_FLAG] = true;
  return wrappedHook;
}

// ---------------------------------------------------------------------------
// Custom user-defined functions (statics / methods / query helpers)
// ---------------------------------------------------------------------------

/**
 * Resolves the `customMethods` config into a concrete, defaults-applied shape.
 * Omitted/true → wrap everything and capture (redacted) parameters.
 */
function resolveCustomMethods(
  config: InstrumentMongooseConfig | undefined,
): ResolvedCustomMethods {
  const setting = config?.customMethods;

  if (setting === false) {
    return {
      enabled: false,
      statics: false,
      methods: false,
      query: false,
      captureParameters: false,
    };
  }

  // Default and explicit-true both mean "maximum observability".
  const obj: CustomMethodsConfig =
    setting === undefined || setting === true ? {} : setting;

  const cp = obj.captureParameters;
  let captureParameters: ResolvedCustomMethods['captureParameters'] = false;
  if (cp !== false) {
    captureParameters = createParameterCapture({
      parameterConfig: cp === undefined || cp === true ? undefined : cp,
      // Parameters inherit the same PII redaction as db.query.text by default.
      statementRedactor: config?.statementRedactor ?? 'default',
    });
  }

  return {
    enabled: true,
    statics: obj.statics ?? true,
    methods: obj.methods ?? true,
    query: obj.query ?? true,
    captureParameters,
  };
}

/**
 * Evaluates whether a named function in a category should be instrumented.
 * Supports boolean, include-list, and `{ include, exclude }` selectors.
 */
function selectorAllows(selector: MethodSelector, name: string): boolean {
  if (selector === false) {
    return false;
  }
  if (selector === true) {
    return true;
  }
  if (Array.isArray(selector)) {
    return selector.includes(name);
  }
  if (selector.include && !selector.include.includes(name)) {
    return false;
  }
  if (selector.exclude && selector.exclude.includes(name)) {
    return false;
  }
  return true;
}

/**
 * Derives model + collection names from the runtime `this` of a custom
 * function, which differs by category (Model / Document / Query).
 */
function resolveModelContext(
  self: any,
  methodType: CustomMethodType,
): { modelName?: string; collectionName?: string } {
  try {
    switch (methodType) {
      case 'static': {
        return {
          modelName: self?.modelName,
          collectionName: self?.collection?.collectionName || self?.modelName,
        };
      }
      case 'instance': {
        const ctor = self?.constructor;
        return {
          modelName: ctor?.modelName,
          collectionName: ctor?.collection?.collectionName || ctor?.modelName,
        };
      }
      case 'query': {
        const model = self?.model;
        return {
          modelName: model?.modelName,
          collectionName: model?.collection?.collectionName || model?.modelName,
        };
      }
    }
  } catch {
    // Ignore — fall through to empty context.
  }
  return {};
}

/**
 * Wraps a single user-defined function so its invocation is traced. Purely
 * observational: preserves `this`, the return value, and error propagation.
 *
 * The tracer, config, and selection are resolved per Mongoose instance at call
 * time (see {@link INSTANCE_REGISTRY}), so a schema shared across instances or
 * connections is never bound to whichever config instrumented it first. Calls
 * from a non-instrumented, disabled, or de-selected instance pass straight
 * through with no span.
 */
function wrapCustomFunction(
  original: (...args: any[]) => any,
  methodName: string,
  methodType: CustomMethodType,
): (...args: any[]) => any {
  if ((original as any)[WRAPPED_METHOD_FLAG]) {
    return original;
  }

  const wrapped = function instrumentedCustomFn(
    this: any,
    ...args: any[]
  ): any {
    // Resolve the owning instance's tracer/config at call time.
    const instance = resolveMongooseInstance(this, methodType);
    const entry = instance ? INSTANCE_REGISTRY.get(instance) : undefined;
    if (
      !entry ||
      !entry.config.customMethods.enabled ||
      !selectorAllows(
        selectorFor(entry.config.customMethods, methodType),
        methodName,
      )
    ) {
      // Not instrumented / disabled / de-selected for this instance.
      return original.apply(this, args);
    }

    const { tracer, config } = entry;
    const captureParameters = config.customMethods.captureParameters;

    const { modelName, collectionName } = resolveModelContext(this, methodType);

    const spanName = modelName
      ? `mongoose.${modelName}.${methodName}`
      : `mongoose.${methodType}.${methodName}`;

    const span = tracer.startSpan(spanName, { kind: SpanKind.INTERNAL });
    span.setAttribute(ATTR_DB_SYSTEM_NAME, DB_SYSTEM_NAME_VALUE_MONGODB);
    span.setAttribute(ATTR_CODE_FUNCTION_NAME, methodName);
    span.setAttribute(ATTR_MONGOOSE_METHOD_NAME, methodName);
    span.setAttribute(ATTR_MONGOOSE_METHOD_TYPE, methodType);
    if (modelName) {
      span.setAttribute(ATTR_MONGOOSE_METHOD_MODEL, modelName);
    }
    if (collectionName && config.captureCollectionName) {
      span.setAttribute(ATTR_DB_COLLECTION_NAME, collectionName);
    }
    if (config.dbName) {
      span.setAttribute(ATTR_DB_NAMESPACE, config.dbName);
    }

    if (captureParameters) {
      span.setAttribute(ATTR_MONGOOSE_METHOD_PARAMETER_COUNT, args.length);
      try {
        const params = captureParameters(args, { methodName, methodType });
        if (params !== undefined) {
          span.setAttribute(ATTR_MONGOOSE_METHOD_PARAMETERS, params);
        }
      } catch {
        // Never let parameter capture break the call.
      }
    }

    const finalize = createSpanFinalizer(span);
    return runWithSpan(span, () => {
      // Query helpers return a chainable Query; the DB call is traced on exec().
      // Finalize immediately so we don't hold the span open across the chain.
      if (methodType === 'query') {
        try {
          const result = original.apply(this, args);
          finalize();
          return result;
        } catch (error) {
          finalize(error);
          throw error;
        }
      }

      // Statics/instance methods may be callback-style (older Mongoose code).
      const { callArgs, deferred } = deferFinalizeToCallback(
        args,
        span,
        finalize,
      );
      try {
        const result = original.apply(this, callArgs);

        // A Query/Aggregate or Promise settles the span on its own completion,
        // even when a callback was also supplied (idempotent finalize dedupes).
        if (
          result &&
          (typeof result.exec === 'function' ||
            typeof result.then === 'function')
        ) {
          return settleSpan(result, finalize);
        }

        // Synchronous return: a deferred callback owns finalization; otherwise
        // finalize now.
        if (!deferred) {
          finalize();
        }
        return result;
      } catch (error) {
        finalize(error);
        throw error;
      }
    });
  };

  // Preserve the original name for stack traces / debugging.
  try {
    Object.defineProperty(wrapped, 'name', {
      value: original.name || methodName,
      configurable: true,
    });
  } catch {
    // Ignore — non-fatal.
  }
  // Preserve arity too. Mongoose doesn't inspect it for statics/methods/query
  // helpers today, but the `...args` wrapper otherwise reports length 0 — the
  // same latent footgun the hook wrapper's `defineProperty` guards against.
  try {
    Object.defineProperty(wrapped, 'length', {
      value: original.length,
      configurable: true,
    });
  } catch {
    // Ignore — non-fatal.
  }
  (wrapped as any)[WRAPPED_METHOD_FLAG] = true;
  return wrapped;
}

/**
 * Wraps every user-defined function on a schema in place (statics / methods /
 * query) at model-compile time. Mutating the schema's collections before
 * compilation means Mongoose copies the wrapped versions onto the Model, its
 * prototype, and its query class.
 *
 * Wrapping is unconditional and idempotent: each wrapper decides per Mongoose
 * instance at call time whether to actually trace (honoring that instance's
 * `enabled` flag and include/exclude selectors). This keeps a schema shared
 * across instances correct — a function excluded by one instance can still be
 * traced by another, and vice versa — while a function is only ever wrapped
 * once.
 */
/**
 * Functions Mongoose itself injects into `schema.statics`/`methods`/`query`
 * (e.g. the `timestamps: true` option adds an `initializeTimestamps` instance
 * method). These are framework internals, not user code, so we skip them to
 * avoid noisy spans. Names starting with `$` (Mongoose's internal prefix) are
 * also skipped.
 */
const MONGOOSE_INTERNAL_FUNCTION_NAMES = new Set<string>([
  'initializeTimestamps',
]);

function isMongooseInternalFunctionName(name: string): boolean {
  return name.startsWith('$') || MONGOOSE_INTERNAL_FUNCTION_NAMES.has(name);
}

/**
 * Detects a compiled Mongoose Model assigned onto a schema collection — e.g.
 * the `Patches` model attached to `schema.statics` by history/audit plugins
 * (`schema.statics.Patches = mongoose.model(...)`). A Model is a constructor
 * function carrying its own statics (`find`, `create`, …); wrapping it in a
 * plain tracing function would drop those and break callers, so it must be
 * skipped — both at the compile-time scan and on later assignment.
 */
function isMongooseModelLike(fn: any): boolean {
  try {
    return (
      typeof fn === 'function' &&
      typeof fn.modelName === 'string' &&
      fn.schema != null
    );
  } catch {
    return false;
  }
}

/** Whether a value assigned to a schema collection should be wrapped. */
function shouldWrapCustomFunction(name: string, value: any): boolean {
  return (
    typeof value === 'function' &&
    !isMongooseInternalFunctionName(name) &&
    !(value as any)[WRAPPED_METHOD_FLAG] &&
    !isMongooseModelLike(value)
  );
}

function instrumentSchemaCustomFunctions(schema: any): void {
  if (!schema) {
    return;
  }

  // Wraps the functions already present on a collection, then replaces it with
  // a write-trapping Proxy so anything added *later* is wrapped as it is
  // assigned. This makes tracing independent of the order in which custom
  // functions are attached relative to `instrumentMongoose()`.
  //
  // Scope note: the common case (e.g. a model that attaches all its statics
  // before its single `mongoose.model()` call) is already covered by the
  // up-front scan below — Mongoose copies those at compile time. The Proxy is
  // the defensive path for functions added *after* the first compile: a late
  // plugin, or a schema compiled into more than one model. Mongoose does not
  // back-propagate post-compile `schema.statics` writes to an already-compiled
  // model, so the Proxy matters when the schema is compiled again afterwards.
  const wrapCollection = (
    collection: any,
    methodType: CustomMethodType,
  ): any => {
    if (!collection || collection[PROXIED_COLLECTION_FLAG]) {
      return collection;
    }

    for (const name of Object.keys(collection)) {
      const fn = collection[name];
      if (isMongooseModelLike(fn)) {
        continue;
      }
      if (shouldWrapCustomFunction(name, fn)) {
        collection[name] = wrapCustomFunction(fn, name, methodType);
      }
    }

    try {
      Object.defineProperty(collection, PROXIED_COLLECTION_FLAG, {
        value: true,
        enumerable: false,
        configurable: true,
      });
    } catch {
      // Can't mark it — fall back to the (already wrapped) plain object.
      return collection;
    }

    return new Proxy(collection, {
      set(target, prop, value): boolean {
        (target as any)[prop] =
          typeof prop === 'string' && shouldWrapCustomFunction(prop, value)
            ? wrapCustomFunction(value, prop, methodType)
            : value;
        return true;
      },
    });
  };

  schema.statics = wrapCollection(schema.statics, 'static');
  schema.methods = wrapCollection(schema.methods, 'instance');
  schema.query = wrapCollection(schema.query, 'query');
}

/**
 * Patches `mongoose.model()` (and `Connection.prototype.model()`) so custom
 * functions are wrapped automatically as each model compiles. Idempotent per
 * host and per function. Whether a wrapped function actually traces is decided
 * per instance at call time, so it is safe for the patch to be global.
 */
function patchModelFactory(m: any, config: ResolvedConfig): void {
  if (!config.customMethods.enabled) {
    return;
  }

  const patchHost = (host: any): void => {
    if (!host || typeof host.model !== 'function' || host[MODEL_PATCHED_FLAG]) {
      return;
    }
    const originalModel = host.model;
    host.model = function patchedModel(
      this: any,
      nameOrSchema: any,
      schema?: any,
      ...rest: any[]
    ): any {
      if (schema && typeof schema === 'object') {
        try {
          instrumentSchemaCustomFunctions(schema);
        } catch {
          // Never let instrumentation break model compilation.
        }
      }
      return Reflect.apply(originalModel, this, [
        nameOrSchema,
        schema,
        ...rest,
      ]);
    };
    host[MODEL_PATCHED_FLAG] = true;
  };

  patchHost(m);
  if (m.Connection?.prototype) {
    patchHost(m.Connection.prototype);
  }
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
