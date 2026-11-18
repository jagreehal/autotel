/** Spans for user-defined statics, instance methods and query helpers. */

import { selectorAllows } from './selector';
import { SpanKind } from 'autotel';
import type { Tracer } from 'autotel';
import { runWithSpan } from 'autotel/trace-helpers';
import {
  ATTR_DB_SYSTEM_NAME,
  ATTR_DB_COLLECTION_NAME,
  ATTR_DB_NAMESPACE,
  ATTR_CODE_FUNCTION_NAME,
  ATTR_MONGOOSE_METHOD_NAME,
  ATTR_MONGOOSE_METHOD_TYPE,
  ATTR_MONGOOSE_METHOD_MODEL,
  ATTR_MONGOOSE_METHOD_PARAMETERS,
  ATTR_MONGOOSE_METHOD_PARAMETER_COUNT,
  DB_SYSTEM_NAME_VALUE_MONGODB,
} from './constants';
import type {
  CustomMethodType,
  CustomMethodsConfig,
  InstrumentMongooseConfig,
  MethodSelector,
  ResolvedConfig,
  ResolvedCustomMethods,
} from './types.js';
import { createParameterCapture } from './statement';
import { asRecord, callFunction, isFunction } from './values.js';
import {
  hasMarker,
  setMarker,
  WRAPPED_METHOD_FLAG,
  MODEL_PATCHED_FLAG,
  PROXIED_COLLECTION_FLAG,
} from './markers';
import {
  createSpanFinalizer,
  settleSpan,
  deferFinalizeToCallback,
} from './span-lifecycle';

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
export const INSTANCE_REGISTRY = new WeakMap<
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
 * Resolves the `customMethods` config into a concrete, defaults-applied shape.
 * Omitted/true → wrap everything and capture (redacted) parameters.
 */
export function resolveCustomMethods(
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
 * Derives model + collection names from the runtime `this` of a custom
 * function, which differs by category (Model / Document / Query).
 */
/** Where a traced custom method's model and collection names came from. */
interface ModelContext {
  modelName?: string;
  collectionName?: string;
}

function resolveModelContext(
  self: any,
  methodType: CustomMethodType,
): ModelContext {
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
  if (hasMarker(original, WRAPPED_METHOD_FLAG)) {
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
  setMarker(wrapped, WRAPPED_METHOD_FLAG);
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
function shouldWrapCustomFunction(name: string, value: unknown): boolean {
  return (
    isFunction(value) &&
    !isMongooseInternalFunctionName(name) &&
    !hasMarker(value, WRAPPED_METHOD_FLAG) &&
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
        // SAFETY: a proxy set trap writes whatever key it was given; the
        // collection this wraps is mongoose's, whose members are untyped here.
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
export function patchModelFactory(m: any, config: ResolvedConfig): void {
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
      if (asRecord(schema)) {
        try {
          instrumentSchemaCustomFunctions(schema);
        } catch {
          // Never let instrumentation break model compilation.
        }
      }
      return callFunction(originalModel, this, [nameOrSchema, schema, ...rest]);
    };
    host[MODEL_PATCHED_FLAG] = true;
  };

  patchHost(m);
  if (m.Connection?.prototype) {
    patchHost(m.Connection.prototype);
  }
}
