/**
 * Functional API for autotel-edge
 *
 * Provides zero-boilerplate tracing helpers that mirror the Node.js runtime
 * implementation while staying optimized for edge environments.
 */

import {
  trace as otelTrace,
  SpanStatusCode,
  type Span,
  type AttributeValue,
} from '@opentelemetry/api';
import type { Attributes } from '@opentelemetry/api';
import type { Sampler } from '@opentelemetry/sdk-trace-base';
import type { TraceContext } from './core/trace-context';
import {
  createTraceContext,
  hasExplicitSpanStatus,
  setSpanName,
} from './core/trace-context';
import {
  getActiveNativeTracer,
  getActiveNativeTraceContext,
  runWithNativeTraceContext,
  createNativeTraceContext,
  createNativeSpanShim,
  type NativeTracer,
} from './core/native-bridge';

// Re-export for convenience
export type { TraceContext } from './core/trace-context';

type AnyFn = (...args: any[]) => any;

type WrappedFunction<TArgs extends any[], TReturn> = (
  ...args: TArgs
) => TReturn | Promise<TReturn>;

/**
 * trace function options
 */
export interface TracingOptions<TArgs extends any[] = any[], TReturn = any> {
  name?: string;
  serviceName?: string;
  sampler?: Sampler;
  attributesFromArgs?: (args: TArgs) => Attributes;
  // Receives the resolved value: async wrappers await before calling this, so
  // `Awaited<TReturn>` matches runtime (and lets async fns annotate the result).
  attributesFromResult?: (result: Awaited<TReturn>) => Attributes;
  attributes?: Attributes;
}

/** @deprecated Use {@link TracingOptions}. */
export type traceOptions<
  TArgs extends any[] = any[],
  TReturn = any,
> = TracingOptions<TArgs, TReturn>;

const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * Get the autotel {@link TraceContext} for the currently active span.
 *
 * Ambient accessor for the edge functional API: call it inside any traced
 * function (or a helper it calls) to reach `setAttribute` and the rest of the
 * context surface without threading a `ctx` parameter. Returns `undefined`
 * when no span is active.
 *
 * @example
 * ```typescript
 * const handler = trace(async function fetch(req: Request) {
 *   getActiveTraceContext()?.setAttribute('http.method', req.method);
 *   return fetch(req);
 * });
 * ```
 */
export function getActiveTraceContext(): TraceContext | undefined {
  const nativeContext = getActiveNativeTraceContext();
  if (nativeContext) return nativeContext;
  const span = otelTrace.getActiveSpan();
  return span ? createTraceContext(span) : undefined;
}

/**
 * Attributes a caller's hook produced.
 *
 * SAFETY: the hooks are declared as returning an object of attribute values;
 * this states that shape for setAttributes, which is the only thing done with
 * it. A hook that returns something else records those keys as they are.
 */
function hookAttributes(attributes: object): Record<string, AttributeValue> {
  return attributes as Record<string, AttributeValue>;
}

function createDummyCtx(): TraceContext {
  // SAFETY: a context for a span that is not recording - every method is a
  // no-op and every id empty, which is what a caller sees when sampling has
  // decided against the span.
  return {
    traceId: '',
    spanId: '',
    correlationId: '',
    setAttribute: () => {},
    setAttributes: () => {},
    setStatus: () => {},
    recordException: () => {},
    addEvent: () => {},
    addLink: () => {},
    addLinks: () => {},
    updateName: () => {},
    isRecording: () => false,
  } as TraceContext;
}

function truncateErrorMessage(message: string): string {
  if (message.length <= MAX_ERROR_MESSAGE_LENGTH) {
    return message;
  }
  return `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}... (truncated)`;
}

/**
 * Record an error onto a native trace context (status + exception) and rethrow.
 * Shared by every native-span code path so the error degradation is identical.
 */
function failNativeContext(ctx: TraceContext, cause: unknown): never {
  ctx.setStatus({
    code: SpanStatusCode.ERROR,
    message: truncateErrorMessage(
      cause instanceof Error ? cause.message : String(cause ?? 'Unknown cause'),
    ),
  });
  ctx.recordException(
    cause instanceof Error ? cause : new Error(String(cause)),
  );
  throw cause;
}

/**
 * Run a factory-produced function inside a native span, applying the same
 * options (attributes / attributesFromArgs / attributesFromResult / code.function)
 * and error degradation as the OTel path. Handles both sync and async functions
 * by branching on the returned value, so async/sync callers share one impl.
 */
function runFactoryInNativeSpan<TArgs extends any[], TReturn>(
  nativeTracer: NativeTracer,
  spanName: string,
  fnFactory: (
    ctx: TraceContext,
  ) => (...args: TArgs) => TReturn | Promise<TReturn>,
  options: traceOptions<TArgs, TReturn>,
  args: TArgs,
): TReturn | Promise<TReturn> {
  return nativeTracer.enterSpan(spanName, (nativeSpan) => {
    const ctx = createNativeTraceContext(
      nativeSpan,
      spanName,
      nativeTracer.correlationId,
    );
    return runWithNativeTraceContext(ctx, () => {
      const actualFn = fnFactory(ctx);

      if (options.attributes) {
        // SAFETY: the options' attributes are the caller's own, already checked
        // against Attributes where the options type declares them.
        ctx.setAttributes(hookAttributes(options.attributes));
      }
      if (options.attributesFromArgs) {
        ctx.setAttributes(hookAttributes(options.attributesFromArgs(args)));
      }

      const onSuccess = (result: Awaited<TReturn>): Awaited<TReturn> => {
        if (options.attributesFromResult) {
          ctx.setAttributes(
            hookAttributes(options.attributesFromResult(result)),
          );
        }
        ctx.setAttribute('code.function', spanName);
        return result;
      };
      const onError = (cause: unknown): never => {
        ctx.setAttribute('code.function', spanName);
        return failNativeContext(ctx, cause);
      };

      try {
        const result = actualFn(...args);
        // SAFETY: as above - the wrapper keeps the caller's own signature.
        return result instanceof Promise
          ? ((result as Promise<Awaited<TReturn>>).then(
              onSuccess,
              onError,
            ) as Promise<TReturn>)
          : (onSuccess(result as Awaited<TReturn>) as TReturn);
      } catch (error) {
        return onError(error);
      }
    });
  });
}

type InstrumentableFunction<TArgs extends any[] = any[], TReturn = any> = ((
  ...args: TArgs
) => TReturn | Promise<TReturn>) & {
  displayName?: string;
  name?: string;
};

function inferFunctionName<TArgs extends any[] = any[], TReturn = any>(
  fn: InstrumentableFunction<TArgs, TReturn>,
): string | undefined {
  const displayName = (fn as { displayName?: string }).displayName;
  if (displayName) {
    return displayName;
  }

  if (fn.name && fn.name !== 'anonymous') {
    return fn.name;
  }

  const source = Function.prototype.toString.call(fn);
  const match = source.match(/function\s+([^(\s]+)/);
  if (match && match[1] && match[1] !== 'anonymous') {
    return match[1];
  }

  return undefined;
}

function getSpanName<TArgs extends any[], TReturn>(
  options: traceOptions<TArgs, TReturn>,
  fn: InstrumentableFunction<TArgs, TReturn>,
  variableName?: string,
): string {
  if (options.name) {
    return options.name;
  }

  let fnName = variableName ?? inferFunctionName(fn);
  fnName = fnName || 'anonymous';

  if (options.serviceName) {
    return `${options.serviceName}.${fnName}`;
  }

  if (fnName && fnName !== 'anonymous') {
    return fnName;
  }

  return 'unknown';
}

function wrapWithTracingSync<TArgs extends any[], TReturn>(
  fnFactory: (
    ctx: TraceContext,
  ) => (...args: TArgs) => TReturn | Promise<TReturn>,
  options: traceOptions<TArgs, TReturn>,
  variableName?: string,
): WrappedFunction<TArgs, TReturn> {
  const tempFn = fnFactory(createDummyCtx());
  const spanName = getSpanName(options, tempFn, variableName);

  const wrappedFunction = function wrappedFunction(
    this: unknown,
    ...args: TArgs
  ): TReturn | Promise<TReturn> {
    const nativeTracer = getActiveNativeTracer();
    if (nativeTracer) {
      return runFactoryInNativeSpan(
        nativeTracer,
        spanName,
        fnFactory,
        options,
        args,
      ) as TReturn;
    }

    const tracer = otelTrace.getTracer('autotel-edge');
    const spanOptions: Record<string, unknown> = options.sampler
      ? { sampler: options.sampler }
      : {};

    return tracer.startActiveSpan(spanName, spanOptions, (span) => {
      setSpanName(span, spanName);

      try {
        const actualFn = fnFactory(createTraceContext(span));

        if (options.attributes) {
          span.setAttributes(hookAttributes(options.attributes));
        }

        if (options.attributesFromArgs) {
          const argsAttrs = options.attributesFromArgs(args);
          span.setAttributes(hookAttributes(argsAttrs));
        }

        const onSuccess = (result: Awaited<TReturn>): Awaited<TReturn> => {
          if (options.attributesFromResult) {
            const resultAttrs = options.attributesFromResult(result);
            span.setAttributes(hookAttributes(resultAttrs));
          }

          span.setAttribute('code.function', spanName);
          if (!hasExplicitSpanStatus(span)) {
            span.setStatus({ code: SpanStatusCode.OK });
          }
          span.end();
          return result;
        };
        const onError = (cause: unknown): never => {
          const message = truncateErrorMessage(
            cause instanceof Error
              ? cause.message
              : String(cause ?? 'Unknown cause'),
          );
          span.setAttribute('code.function', spanName);
          span.setStatus({ code: SpanStatusCode.ERROR, message });
          span.recordException(
            cause instanceof Error ? cause : new Error(String(cause)),
          );
          span.end();
          throw cause;
        };

        const result = actualFn(...args);
        // SAFETY: the wrapped function returns TReturn, which may itself be a
        // promise; whichever it is, onSuccess sees the awaited value and the
        // wrapper hands back what the caller's own signature promises.
        return result instanceof Promise
          ? (result as Promise<Awaited<TReturn>>).then(onSuccess, onError)
          : onSuccess(result as Awaited<TReturn>);
      } catch (error) {
        const message = truncateErrorMessage(
          error instanceof Error
            ? error.message
            : String(error ?? 'Unknown error'),
        );
        span.setAttribute('code.function', spanName);
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        span.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );
        span.end();
        throw error;
      }
      // SAFETY: startActiveSpan returns whatever its callback returned, which
      // is the wrapped function's own result.
    }) as TReturn | Promise<TReturn>;
  };

  Object.defineProperty(wrappedFunction, 'name', {
    value: tempFn.name || 'trace',
    configurable: true,
  });

  return wrappedFunction;
}

/**
 * Wrap an explicit context factory `(ctx) => (...args) => result`.
 * Used by {@link withTracing}; the input is a factory by contract, so there is
 * no plain-vs-factory detection. The runtime wrapper branches on the returned
 * value so Promise-returning functions do not need to be declared `async`.
 */
function wrapFactoryWithTracing<TArgs extends any[], TReturn>(
  factory: (
    ctx: TraceContext,
  ) => (...args: TArgs) => TReturn | Promise<TReturn>,
  options: traceOptions<TArgs, TReturn>,
  variableName?: string,
): WrappedFunction<TArgs, TReturn> {
  return wrapWithTracingSync(factory, options, variableName);
}

/**
 * Wrap a plain function `(...args) => result`. Used by {@link trace} and
 * {@link instrument}: the function receives its real arguments and no context
 * is injected. Reach the active span via {@link getActiveTraceContext} inside
 * the body (or any helper it calls).
 */
function wrapPlainWithTracing<TArgs extends any[], TReturn>(
  fn: (...args: TArgs) => TReturn | Promise<TReturn>,
  options: traceOptions<TArgs, TReturn>,
  variableName?: string,
): WrappedFunction<TArgs, TReturn> {
  const factory = (_ctx: TraceContext) => fn;
  return wrapFactoryWithTracing(factory, options, variableName);
}

/** Run one operation immediately with its span-bound context. */
function runWithTraceContext<TReturn>(
  operation: (ctx: TraceContext) => TReturn | Promise<TReturn>,
  options: traceOptions<[], TReturn>,
): TReturn | Promise<TReturn> {
  return wrapFactoryWithTracing<[], TReturn>(
    (ctx) => () => operation(ctx),
    options,
  )();
}

// Every trace(...) call returns a wrapper; nothing runs until you call what
// comes back. trace.run(...) is the immediate form. Two names, so no call shape
// is ambiguous and a minified parameter name cannot change the dispatch (#166).

// trace(fn)
function traceImpl<TArgs extends any[], TReturn = any>(
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;
// trace(name, fn) / trace(options, fn)
function traceImpl<TArgs extends any[], TReturn = any>(
  name: string,
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;
function traceImpl<TArgs extends any[], TReturn = any>(
  options: traceOptions<TArgs, TReturn>,
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;
// trace(name) / trace(options) - returns a wrapper factory
function traceImpl(
  name: string,
): <TArgs extends any[], TReturn = any>(
  fn: (...args: TArgs) => TReturn,
) => (...args: TArgs) => TReturn;
function traceImpl<TArgs extends any[], TReturn = any>(
  options: traceOptions<TArgs, TReturn>,
): (fn: (...args: TArgs) => TReturn) => (...args: TArgs) => TReturn;
// Implementation
function traceImpl<TArgs extends any[] = any[], TReturn = any>(
  fnOrNameOrOptions:
    | ((...args: TArgs) => TReturn)
    | ((...args: TArgs) => Promise<TReturn>)
    | string
    | traceOptions<TArgs, TReturn>,
  maybeFn?:
    ((...args: TArgs) => TReturn) | ((...args: TArgs) => Promise<TReturn>),
): WrappedFunction<TArgs, TReturn> {
  // trace(fn) - no name given, so the wrapper infers one.
  if (typeof fnOrNameOrOptions === 'function') {
    return wrapPlainWithTracing(
      fnOrNameOrOptions as (...args: TArgs) => TReturn,
      {} as traceOptions<TArgs, TReturn>,
    );
  }

  const options: traceOptions<TArgs, TReturn> =
    typeof fnOrNameOrOptions === 'string'
      ? ({ name: fnOrNameOrOptions } as traceOptions<TArgs, TReturn>)
      : fnOrNameOrOptions;

  // trace(name) / trace(options) - the function is still to come.
  if (maybeFn === undefined) {
    return ((fn: (...args: TArgs) => TReturn) =>
      wrapPlainWithTracing(fn, options)) as unknown as WrappedFunction<
      TArgs,
      TReturn
    >;
  }

  return wrapPlainWithTracing(maybeFn, options);
}

/**
 * Run one named operation immediately and return its result, with the
 * {@link TraceContext} passed in. The counterpart to {@link trace}, which
 * always hands back a wrapper.
 */
function run<TReturn = any>(
  name: string,
  operation: (ctx: TraceContext) => Promise<TReturn>,
): Promise<TReturn>;
function run<TReturn = any>(
  name: string,
  operation: (ctx: TraceContext) => TReturn,
): TReturn;
function run<TReturn = any>(
  options: traceOptions<[], TReturn>,
  operation: (ctx: TraceContext) => Promise<TReturn>,
): Promise<TReturn>;
function run<TReturn = any>(
  options: traceOptions<[], TReturn>,
  operation: (ctx: TraceContext) => TReturn,
): TReturn;
function run<TReturn = any>(
  nameOrOptions: string | traceOptions<[], TReturn>,
  operation: (ctx: TraceContext) => TReturn | Promise<TReturn>,
): TReturn | Promise<TReturn> {
  if (typeof operation !== 'function') {
    throw new TypeError(
      'trace.run(name, operation): operation must be a function',
    );
  }

  const options: traceOptions<[], TReturn> =
    typeof nameOrOptions === 'string' ? { name: nameOrOptions } : nameOrOptions;

  return runWithTraceContext(operation, options);
}

export const trace = Object.assign(traceImpl, { run });

/**
 * The explicit `(ctx) => (...args) => result` factory API. Reach the span via
 * the injected `ctx`, or from anywhere via ambient {@link getActiveTraceContext}.
 */
export function withTracing<TArgs extends any[] = any[], TReturn = any>(
  options: traceOptions<TArgs, TReturn> = {},
) {
  return (
    fnFactory: (
      ctx: TraceContext,
    ) => (...args: TArgs) => TReturn | Promise<TReturn>,
  ): WrappedFunction<TArgs, TReturn> =>
    wrapFactoryWithTracing(fnFactory, options);
}

function shouldSkip(
  key: string,
  fn: Function,
  skip?: (string | RegExp | ((key: string, fn: Function) => boolean))[],
): boolean {
  if (key.startsWith('_')) {
    return true;
  }

  if (!skip || skip.length === 0) {
    return false;
  }

  for (const pattern of skip) {
    if (typeof pattern === 'string' && key === pattern) {
      return true;
    }
    if (pattern instanceof RegExp && pattern.test(key)) {
      return true;
    }
    if (typeof pattern === 'function' && pattern(key, fn)) {
      return true;
    }
  }

  return false;
}

type AnyInstrumentable = (...args: any[]) => any;

export interface InstrumentOptions<
  T extends Record<string, AnyInstrumentable> = Record<
    string,
    AnyInstrumentable
  >,
> extends traceOptions {
  functions: T;
  overrides?: Record<string, Partial<traceOptions>>;
  skip?: (string | RegExp | ((key: string, fn: Function) => boolean))[];
}

export interface SingleInstrumentOptions<
  TFunction extends AnyInstrumentable = AnyInstrumentable,
> extends traceOptions {
  key: string;
  fn: TFunction;
}

export function instrument<TFunction extends AnyInstrumentable>(
  options: SingleInstrumentOptions<TFunction>,
): TFunction;
export function instrument<T extends Record<string, AnyInstrumentable>>(
  options: InstrumentOptions<T>,
): T;
export function instrument<
  T extends Record<string, AnyInstrumentable>,
  TFunction extends AnyInstrumentable,
>(
  options: InstrumentOptions<T> | SingleInstrumentOptions<TFunction>,
): T | TFunction {
  if (!options || typeof options !== 'object') {
    throw new TypeError(
      'instrument: expected { key, fn } or { functions: { name: fn } }',
    );
  }

  if ('key' in options || 'fn' in options) {
    const { key, fn, ...tracingOptions } =
      options as SingleInstrumentOptions<TFunction>;
    if (typeof key !== 'string' || key.trim() === '') {
      throw new TypeError(
        'instrument: "key" must be a non-empty string in the { key, fn } form',
      );
    }
    if (typeof fn !== 'function') {
      throw new TypeError(
        'instrument: "fn" must be a function in the { key, fn } form',
      );
    }
    return wrapPlainWithTracing(fn, tracingOptions, key) as TFunction;
  }

  const { functions, ...tracingOptions } = options;
  if (!functions || typeof functions !== 'object') {
    throw new TypeError(
      'instrument: expected { key, fn } or { functions: { name: fn } }',
    );
  }
  const instrumented: Record<string, AnyInstrumentable> = {};

  for (const key of Object.keys(functions)) {
    const fn = functions[key];

    if (typeof fn !== 'function') {
      instrumented[key] = fn;
      continue;
    }

    if (shouldSkip(key, fn, tracingOptions.skip)) {
      instrumented[key] = fn;
      continue;
    }

    const fnOptions: traceOptions = {
      ...tracingOptions,
      ...tracingOptions.overrides?.[key],
      name: tracingOptions.overrides?.[key]?.name ?? tracingOptions.name,
    };

    const boundFn = fn.bind(functions) as AnyFn;

    instrumented[key] = wrapPlainWithTracing(boundFn, fnOptions, key);
  }

  return instrumented as T;
}

export interface SpanOptions {
  name: string;
  attributes?: Record<string, string | number | boolean>;
}

// Aligned with trace(): accept a name string OR full SpanOptions as the first
// argument so span() and trace() share the same calling conventions.
export function span<T = unknown>(name: string, fn: (span: Span) => T): T;
export function span<T = unknown>(
  name: string,
  fn: (span: Span) => Promise<T>,
): Promise<T>;
export function span<T = unknown>(
  options: SpanOptions,
  fn: (span: Span) => T,
): T;
export function span<T = unknown>(
  options: SpanOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T>;
export function span<T = unknown>(
  nameOrOptions: string | SpanOptions,
  fn: (span: Span) => T | Promise<T>,
): T | Promise<T> {
  const options: SpanOptions =
    typeof nameOrOptions === 'string' ? { name: nameOrOptions } : nameOrOptions;
  const tracer = otelTrace.getTracer('autotel-edge');

  const execute = (span: Span) => {
    setSpanName(span, options.name);

    try {
      if (options.attributes) {
        for (const [key, value] of Object.entries(options.attributes)) {
          span.setAttribute(key, value);
        }
      }

      const result = fn(span);

      if (result instanceof Promise) {
        return result
          .then((value) => {
            span.setAttribute('code.function', options.name);
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return value;
          })
          .catch((error) => {
            const message = truncateErrorMessage(
              error instanceof Error
                ? error.message
                : String(error ?? 'Unknown error'),
            );
            span.setAttribute('code.function', options.name);
            span.setStatus({ code: SpanStatusCode.ERROR, message });
            span.recordException(
              error instanceof Error ? error : new Error(String(error)),
            );
            span.end();
            throw error;
          });
      }

      span.setAttribute('code.function', options.name);
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return result;
    } catch (error) {
      const message = truncateErrorMessage(
        error instanceof Error
          ? error.message
          : String(error ?? 'Unknown error'),
      );
      span.setAttribute('code.function', options.name);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      span.recordException(
        error instanceof Error ? error : new Error(String(error)),
      );
      span.end();
      throw error;
    }
  };

  const nativeTracer = getActiveNativeTracer();
  if (nativeTracer) {
    const nativeResult = nativeTracer.enterSpan(options.name, (nativeSpan) => {
      const traceContext = createNativeTraceContext(
        nativeSpan,
        options.name,
        nativeTracer.correlationId,
      );
      return runWithNativeTraceContext(traceContext, () =>
        execute(createNativeSpanShim(nativeSpan, nativeTracer.correlationId)),
      );
    });
    if (nativeResult instanceof Promise) {
      return nativeResult;
    }
    return nativeResult as T;
  }

  const result = tracer.startActiveSpan(options.name, execute);

  if (result instanceof Promise) {
    return result;
  }

  return result as T;
}

/**
 * `enterSpan(name, callback)` — a Cloudflare-familiar alias for {@link span}.
 *
 * Mirrors the shape of Cloudflare's `tracing.enterSpan()` so CF users can keep
 * the API they know, but with autotel superpowers: it works on every runtime
 * (not just Workers), supports `span.setAttributes()` bulk-set, and falls back
 * to autotel's OTLP pipeline when no native tracer is active. When a native
 * tracer *is* active (e.g. on a Worker with tracing enabled), the span nests
 * inside Cloudflare's native waterfall.
 */
export function enterSpan<T = unknown>(name: string, fn: (span: Span) => T): T;
export function enterSpan<T = unknown>(
  name: string,
  fn: (span: Span) => Promise<T>,
): Promise<T>;
export function enterSpan<T = unknown>(
  name: string,
  fn: (span: Span) => T | Promise<T>,
): T | Promise<T> {
  return span(name, fn as (span: Span) => T);
}
