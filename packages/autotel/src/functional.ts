/**
 * Functional API for non-class code
 *
 * Three approaches for different use cases:
 * 1. trace() - Zero-ceremony HOF for single functions
 * 2. withTracing() - Middleware-style composable wrapper
 * 3. instrument() - Batch auto-instrumentation for modules
 *
 * @example trace() - Single function
 * ```typescript
 * export const createUser = trace(async (data) => {
 *   getActiveTraceContext()?.setAttribute('user.id', data.id)
 *   return await db.users.create(data)
 * })
 * ```
 *
 * @example withTracing() - Composable middleware
 * ```typescript
 * export const createUser = withTracing({
 *   name: 'user.create'
 * })(ctx => async (data) => {
 *   ctx.setAttribute('user.id', data.id)
 *   return await db.users.create(data)
 * })
 * ```
 *
 * @example instrument() - Batch instrumentation
 * ```typescript
 * export default instrument({
 *   createUser: async (data) => { },
 *   updateUser: async (id, data) => { }
 * }, { serviceName: 'user' })
 * ```
 */

import {
  SpanStatusCode,
  trace as otelTrace,
  context,
  propagation,
  type Span,
  type Counter,
  type Histogram,
  type Attributes,
} from '@opentelemetry/api';
import { getConfig } from './config';
import { getConfig as getInitConfig, getSdk } from './init';
import { getForceFlushableProvider } from './tracer-provider';
import {
  type Sampler,
  type SamplingContext,
  AlwaysSampler,
  AUTOTEL_SAMPLING_TAIL_KEEP,
  AUTOTEL_SAMPLING_TAIL_EVALUATED,
  AUTOTEL_SAMPLING_RATE,
} from './sampling';
import { getEventQueue } from './track';
import type { TraceContext } from './trace-context';
import {
  createTraceContext,
  getActiveContextWithBaggage,
  getContextStorage,
} from './trace-context';
import { setSpanName } from './trace-helpers';
import { runInOperationContext } from './operation-context';
import { inferVariableNameFromCallStack } from './variable-name-inference';

/**
 * Complete trace context containing trace identifiers and span methods
 *
 * The ctx parameter in trace() functions provides:
 * - traceId, spanId, correlationId from the active span
 * - Span manipulation methods (setAttribute, setAttributes, setStatus, recordException)
 *
 * For custom context, access it directly in your functions (standard OpenTelemetry pattern).
 *
 * @example
 * ```typescript
 * import { trace } from 'autotel'
 *
 * export const createUser = withTracing({})((ctx) => async (data: CreateUserData) => {
 *   // Get custom context directly (standard OTel approach)
 *   const userId = getCurrentUserId()
 *   const tenantId = getCurrentTenant()
 *
 *   // Use ctx for span operations and trace IDs
 *   ctx.setAttribute('user.id', data.id)
 *   ctx.setAttribute('user.tenant', tenantId)
 *   console.log(ctx.traceId)  // Trace IDs available
 * })
 * ```
 */
export type { TraceContext } from './trace-context';

let unknownSpanNameWarningEmitted = false;

type WrappedFunction<TArgs extends unknown[], TReturn> = (
  ...args: TArgs
) => TReturn | Promise<TReturn>;

function resolveVariableName(
  named: InstrumentableFunction,
  variableName?: string,
): string | undefined {
  const suppliedFunctionName = inferFunctionName(named);
  const callStackVariableName = suppliedFunctionName
    ? undefined
    : inferVariableNameFromCallStack();
  return variableName || suppliedFunctionName || callStackVariableName;
}

/**
 * Wrap an explicit context factory `(ctx) => (...args) => result`.
 * Used by {@link withTracing}; the input is a factory by contract, so there is
 * no plain-vs-factory detection. The factory is never invoked at construction
 * time — only when the wrapper is called.
 */
function wrapFactoryWithTracing<TArgs extends unknown[], TReturn>(
  factory: (
    ctx: TraceContext,
  ) => (...args: TArgs) => TReturn | Promise<TReturn>,
  options: TracingOptions<TArgs, TReturn>,
  variableName?: string,
): WrappedFunction<TArgs, TReturn> {
  const effectiveVariableName = resolveVariableName(
    factory as InstrumentableFunction,
    variableName,
  );
  return wrapWithTracingSync(
    factory,
    options,
    effectiveVariableName,
  ) as WrappedFunction<TArgs, TReturn>;
}

/**
 * Wrap a plain function `(...args) => result`. Used by {@link trace} and
 * {@link instrument}: the function receives its real arguments and no context
 * is injected. Reach the active span via {@link getActiveTraceContext} inside
 * the body (or any helper it calls).
 */
function wrapPlainWithTracing<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn | Promise<TReturn>,
  options: TracingOptions<TArgs, TReturn>,
  variableName?: string,
): WrappedFunction<TArgs, TReturn> {
  const effectiveVariableName = resolveVariableName(
    fn as InstrumentableFunction,
    variableName,
  );
  const factory = (_ctx: TraceContext) => fn;
  return wrapWithTracingSync(
    factory,
    options,
    effectiveVariableName,
  ) as WrappedFunction<TArgs, TReturn>;
}

/**
 * Common options for functional tracing
 */
export interface TracingOptions<
  TArgs extends unknown[] = unknown[],
  TReturn = unknown,
> {
  /**
   * Span name (highest priority)
   * If provided, this is used as the span name
   */
  name?: string;

  /**
   * Service name (used to compose final span name)
   * If name not provided, span name becomes: ${serviceName}.${functionName}
   */
  serviceName?: string;

  /**
   * Sampling strategy
   * @default AlwaysSampler
   */
  sampler?: Sampler;

  /**
   * Enable metrics collection (counter, histogram)
   * @default false
   */
  withMetrics?: boolean;

  /**
   * Extract attributes from function arguments
   */
  attributesFromArgs?: (args: TArgs) => Record<string, unknown>;

  /**
   * Extract attributes from function result
   */
  attributesFromResult?: (result: TReturn) => Record<string, unknown>;

  /**
   * Capture the function arguments onto the span as `autotel.input`
   * (JSON, truncated). One arg is captured directly; multiple are captured as
   * an array. Off by default — opt in per call. Tools (visualizers, devtools)
   * read this alongside `ai.toolCall.args` to show function I/O uniformly.
   * Avoid on args with secrets/PII, or pair with a redacting processor.
   */
  captureInput?: boolean;

  /**
   * Capture the function return value onto the span as `autotel.output`
   * (JSON, truncated). Off by default. Same caveats as {@link captureInput}.
   */
  captureOutput?: boolean;

  /**
   * Start a new root span instead of creating a child
   * Useful for serverless entry points
   * @default false
   */
  startNewRoot?: boolean;

  /**
   * Flush events queue when span ends
   * Only flushes on root spans (to avoid excessive flushing)
   * @default true
   */
  flushOnRootSpanEnd?: boolean;

  /**
   * Span kind for semantic convention compliance
   * Used for messaging (PRODUCER/CONSUMER), HTTP (CLIENT/SERVER), etc.
   * @default SpanKind.INTERNAL
   */
  spanKind?: import('@opentelemetry/api').SpanKind;

  /**
   * Classify a thrown value as a real error. Return `false` to treat the throw
   * as expected control flow: the span is marked OK, no exception is recorded,
   * and the value is rethrown untouched. Use this for framework control-flow
   * signals that propagate via `throw` but are not failures — e.g. TanStack
   * Router / Next.js `redirect()` and `notFound()`.
   * @default every throw is treated as an error
   */
  isError?: (error: unknown) => boolean;
}

/**
 * Options for instrument() batch instrumentation
 */
export interface InstrumentOptions<
  T extends Record<string, AnyInstrumentable> = Record<
    string,
    AnyInstrumentable
  >,
> extends TracingOptions {
  /** Object whose function properties should be instrumented */
  functions: T;
  /**
   * Per-function configuration overrides
   */
  overrides?: Record<string, Partial<TracingOptions>>;

  /**
   * Functions to skip (won't be instrumented)
   * Supports:
   * - String keys: 'functionName'
   * - RegExp: /^_internal/
   * - Predicate: (key, fn) => boolean
   *
   * By default, functions starting with _ are skipped
   */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  skip?: (string | RegExp | ((key: string, fn: Function) => boolean))[];
}

/**
 * Options for instrumenting one function with an explicit stable key.
 */
export interface SingleInstrumentOptions<
  TFunction extends AnyInstrumentable = AnyInstrumentable,
> extends TracingOptions {
  /** Stable function key used for span naming */
  key: string;
  /** Function to instrument */
  fn: TFunction;
}

// Maximum error message length to prevent span bloat
const MAX_ERROR_MESSAGE_LENGTH = 500;

function createDummyCtx<
  TBaggage extends Record<string, unknown> | undefined = undefined,
>(): TraceContext<TBaggage> {
  // `recordException` / `addEvent` are no-op shims kept for the same
  // compatibility window as `createTraceContext` (see trace-context.ts).
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
    getBaggage: () => {},
    setBaggage: () => '',
    deleteBaggage: () => {},
    getAllBaggage: () => new Map(),
  } as unknown as TraceContext<TBaggage>;
}

/** Attribute keys for opt-in function I/O capture (see TracingOptions). */
const AUTOTEL_INPUT_ATTR = 'autotel.input';
const AUTOTEL_OUTPUT_ATTR = 'autotel.output';
const CAPTURE_MAX_CHARS = 4096;

/** JSON-serialize a captured value, defensively (truncate, swallow cycles). */
function serializeCapture(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    const json = typeof value === 'string' ? value : JSON.stringify(value);
    if (json === undefined) return undefined;
    return json.length > CAPTURE_MAX_CHARS
      ? `${json.slice(0, CAPTURE_MAX_CHARS)}…[truncated]`
      : json;
  } catch {
    return undefined;
  }
}

/** `autotel.input` from args (single arg captured directly, else the array). */
function captureInputAttrs(
  args: unknown[],
  enabled?: boolean,
): Record<string, unknown> {
  if (!enabled) return {};
  const s = serializeCapture(args.length === 1 ? args[0] : args);
  return s === undefined ? {} : { [AUTOTEL_INPUT_ATTR]: s };
}

/** `autotel.output` from the return value. */
function captureOutputAttrs(
  result: unknown,
  enabled?: boolean,
): Record<string, unknown> {
  if (!enabled) return {};
  const s = serializeCapture(result);
  return s === undefined ? {} : { [AUTOTEL_OUTPUT_ATTR]: s };
}

// Symbol to prevent double-instrumentation (idempotency flag)
const INSTRUMENTED_SYMBOL = Symbol.for('autotel.functional.instrumented');

type InstrumentedFlag = {
  [INSTRUMENTED_SYMBOL]?: true;
};

function hasInstrumentationFlag(value: unknown): value is InstrumentedFlag {
  return (
    (typeof value === 'function' || typeof value === 'object') &&
    value !== null &&
    Boolean((value as InstrumentedFlag)[INSTRUMENTED_SYMBOL])
  );
}

/**
 * Truncate error message to prevent span bloat
 */
function truncateErrorMessage(message: string): string {
  if (message.length <= MAX_ERROR_MESSAGE_LENGTH) {
    return message;
  }
  return `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}... (truncated)`;
}

/** Per-invocation state the terminal span handlers close over. */
interface SpanFinalizeContext {
  span: Span;
  spanName: string;
  duration: number;
  callCounter?: Counter;
  durationHistogram?: Histogram;
  handleTailSampling: (
    success: boolean,
    duration: number,
    error?: Error,
  ) => void;
  /** Extra attributes to merge (e.g. captured args); absent on immediate-exec paths. */
  extraAttributes?: Attributes;
}

/**
 * Terminal handling for a value thrown by a traced function. Shared by all four
 * `trace()` execution paths (immediate + wrapper, sync + async) so the outcome
 * rules live in exactly one place. Ends the span; the caller flushes (await/void)
 * and rethrows.
 *
 * If `isError` classifies the throw as expected control flow — e.g. a framework
 * `redirect()` / `notFound()` signal — it is recorded as a success outcome with
 * an OK status and no exception. Otherwise it is recorded as an error.
 */
function finalizeThrownSpan(
  error: unknown,
  isError: ((error: unknown) => boolean) | undefined,
  ctx: SpanFinalizeContext,
): void {
  const {
    span,
    spanName,
    duration,
    callCounter,
    durationHistogram,
    handleTailSampling,
    extraAttributes,
  } = ctx;

  const baseAttributes: Attributes = {
    ...extraAttributes,
    'operation.name': spanName,
    'code.function': spanName,
    'operation.duration': duration,
  };

  if (isError && !isError(error)) {
    callCounter?.add(1, { operation: spanName, status: 'success' });
    durationHistogram?.record(duration, {
      operation: spanName,
      status: 'success',
    });
    span.setStatus({ code: SpanStatusCode.OK });
    span.setAttributes({ ...baseAttributes, 'operation.success': true });
    handleTailSampling(true, duration);
    span.end();
    return;
  }

  callCounter?.add(1, { operation: spanName, status: 'error' });
  durationHistogram?.record(duration, { operation: spanName, status: 'error' });

  const truncatedMessage = truncateErrorMessage(
    error instanceof Error ? error.message : 'Unknown error',
  );

  span.setStatus({ code: SpanStatusCode.ERROR, message: truncatedMessage });
  span.setAttributes({
    ...baseAttributes,
    'operation.success': false,
    error: true,
    'exception.type': error instanceof Error ? error.constructor.name : 'Error',
    'exception.message': truncatedMessage,
  });
  if (error instanceof Error && error.stack) {
    span.setAttribute(
      'exception.stack',
      error.stack.slice(0, MAX_ERROR_MESSAGE_LENGTH),
    );
  }
  const thrown = error instanceof Error ? error : new Error(String(error));
  span.recordException(thrown);
  // Samplers read result.error, so hand them a real Error rather than
  // whatever the code threw.
  handleTailSampling(false, duration, thrown);
  span.end();
}

type InstrumentableFunction<
  TArgs extends unknown[] = unknown[],
  TReturn = unknown,
> = ((...args: TArgs) => TReturn | Promise<TReturn>) & {
  displayName?: string;
  name?: string;
};

/**
 * Constraint alias for `instrument()` and friends. `never[]` parameters make
 * every concretely-typed function (e.g. `(name: string) => Promise<User>`)
 * satisfy the constraint under `strictFunctionTypes` without resorting to
 * `any`. Use ONLY in constraint positions — the concrete `T` is still
 * inferred from the actual argument, so call-site argument and return types
 * are fully preserved.
 */
type AnyInstrumentable = ((...args: never[]) => unknown) & {
  displayName?: string;
  name?: string;
};

/**
 * Try to infer function name from function properties
 * Checks for displayName, name, or other metadata that might be set
 */
function inferFunctionName<
  TArgs extends unknown[] = unknown[],
  TReturn = unknown,
>(fn: InstrumentableFunction<TArgs, TReturn>): string | undefined {
  // Check for displayName property (sometimes set by bundlers)
  const displayName = (fn as { displayName?: string }).displayName;
  if (displayName) {
    return displayName;
  }

  // Check function.name (works for named functions and modern arrow function assignment)
  // Note: Empty string is falsy, so this handles both undefined and ''
  if (fn.name && fn.name !== 'anonymous' && fn.name !== '') {
    return fn.name;
  }

  // Try to extract name from function source (for function declarations)
  const source = Function.prototype.toString.call(fn);
  const match = source.match(/function\s+([^(\s]+)/);
  if (match && match[1] && match[1] !== 'anonymous') {
    return match[1];
  }

  return undefined;
}

/**
 * Determine span name using priority:
 * 1. Explicit name option
 * 2. serviceName + functionName
 * 3. Inferred from function/variable name (including stack trace fallback)
 * 4. Fallback to 'unknown'
 */
function getSpanName<TArgs extends unknown[], TReturn>(
  options: TracingOptions<TArgs, TReturn>,
  fn: InstrumentableFunction<TArgs, TReturn>,
  variableName?: string,
): string {
  // 1. Explicit name
  if (options.name) {
    return options.name;
  }

  // 2. Try variable name, function name, or function properties
  let fnName = variableName || inferFunctionName(fn);

  // Default to 'anonymous' if still no name
  fnName = fnName || 'anonymous';

  // 2. serviceName + functionName
  if (options.serviceName) {
    return `${options.serviceName}.${fnName}`;
  }

  // 3. Inferred from function name
  if (fnName && fnName !== 'anonymous') {
    return fnName;
  }

  // 4. Fallback
  const initConfig = getInitConfig();
  if (
    typeof process !== 'undefined' &&
    process.env.NODE_ENV !== 'production' &&
    !unknownSpanNameWarningEmitted &&
    initConfig?.logger?.warn
  ) {
    unknownSpanNameWarningEmitted = true;
    initConfig.logger.warn(
      {},
      '[autotel] Span name resolved to "unknown". Pass an explicit name, for example trace("operation.name", fn).',
    );
  }
  return 'unknown';
}

/**
 * Check if function should be skipped
 */
function shouldSkip(
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  fn: Function,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  skip?: (string | RegExp | ((key: string, fn: Function) => boolean))[],
): boolean {
  // Default: skip functions starting with _
  if (key.startsWith('_')) {
    return true;
  }

  if (!skip || skip.length === 0) {
    return false;
  }

  for (const rule of skip) {
    if (typeof rule === 'string' && key === rule) {
      return true;
    } else if (rule instanceof RegExp && rule.test(key)) {
      return true;
    } else if (typeof rule === 'function' && rule(key, fn)) {
      return true;
    }
  }

  return false;
}

/**
 * Get current trace context value (internal helper)
 *
 * Returns base context (trace IDs) + span methods from the active span.
 */
function getCtxValue<
  TBaggage extends Record<string, unknown> | undefined = undefined,
>(): TraceContext<TBaggage> | null {
  const activeSpan = otelTrace.getActiveSpan();
  if (!activeSpan) return null;

  // Use shared utility to create trace context
  return createTraceContext<TBaggage>(activeSpan);
}

/**
 * Get the autotel {@link TraceContext} for the currently active span.
 *
 * This is the ambient accessor for the functional API: instead of threading a
 * `ctx` parameter through a factory, call this inside any traced function (or a
 * helper it calls) to reach `setAttribute`, `setUser`, `getBaggage`, and the
 * rest of the context surface. Returns `undefined` when no span is active.
 *
 * @example
 * ```typescript
 * const getUser = trace('getUser', async (id: string) => {
 *   getActiveTraceContext()?.setAttribute('user.id', id);
 *   return db.users.find(id);
 * });
 * ```
 *
 * @see getActiveSpan for the raw OpenTelemetry span
 * @see getRequestLogger which reads the active context when called with no args
 */
export function getActiveTraceContext<
  TBaggage extends Record<string, unknown> | undefined = undefined,
>(): TraceContext<TBaggage> | undefined {
  return getCtxValue<TBaggage>() ?? undefined;
}

/**
 * Context object that lazily evaluates the active span on property access
 *
 * Access trace context directly without function call syntax.
 *
 * @example
 * ```typescript
 * import { trace, ctx } from 'autotel'
 *
 * export const createUser = trace(async (data) => {
 *   // Direct property access - no function call!
 *   if (ctx.traceId) {
 *     ctx.setAttribute('user.id', data.id)
 *     console.log('Trace:', ctx.traceId)
 *   }
 * })
 * ```
 */
export const ctx = new Proxy({} as TraceContext, {
  get(_target, prop) {
    const ctxValue = getCtxValue();
    if (!ctxValue) {
      return;
    }
    return ctxValue[prop as keyof typeof ctxValue];
  },

  has(_target, prop) {
    const ctxValue = getCtxValue();
    if (!ctxValue) {
      return false;
    }
    return prop in ctxValue;
  },

  ownKeys() {
    const ctxValue = getCtxValue();
    if (!ctxValue) {
      return [];
    }
    return Object.keys(ctxValue);
  },

  getOwnPropertyDescriptor(_target, prop) {
    const ctxValue = getCtxValue();
    if (!ctxValue) {
      return;
    }
    return Object.getOwnPropertyDescriptor(ctxValue, prop);
  },
});

/**
 * Build the root-operation flush policy once and reuse it for wrapped and
 * immediate execution. Async operations await this function; sync operations
 * trigger it without blocking.
 */
function createRootTelemetryFlusher(
  options: Pick<TracingOptions, 'flushOnRootSpanEnd'>,
  isRootSpan: boolean,
): () => Promise<void> {
  const initConfig = getInitConfig();
  const shouldFlush =
    options.flushOnRootSpanEnd ?? initConfig?.flushOnRootSpanEnd ?? true;
  const shouldFlushSpans = initConfig?.forceFlushOnShutdown ?? false;

  return async () => {
    if (!shouldFlush || !isRootSpan) return;

    try {
      const queue = getEventQueue();
      if (queue && queue.size() > 0) {
        await queue.flush();
      }

      if (shouldFlushSpans) {
        const tracerProvider = getForceFlushableProvider(getSdk());
        await tracerProvider?.forceFlush();
      }
    } catch (error) {
      const logger = getInitConfig()?.logger;
      logger?.error?.(
        { err: error instanceof Error ? error : undefined },
        `[autotel] Auto-flush failed${error instanceof Error ? '' : `: ${String(error)}`}`,
      );
    }
  };
}

/**
 * Give every root operation its own baggage context without replacing a
 * caller's existing scope. AsyncLocalStorage keeps the scope alive until an
 * async result settles and restores the previous store afterwards.
 */
function runWithTraceContextStorage<TResult>(fn: () => TResult): TResult {
  const storage = getContextStorage();
  if (storage.getStore()) return fn();
  return storage.run({ value: context.active() }, fn);
}

/**
 * Core tracing wrapper for sync functions (internal implementation)
 */
function wrapWithTracingSync<TArgs extends unknown[], TReturn>(
  fnFactory: (
    ctx: TraceContext,
  ) => (...args: TArgs) => TReturn | Promise<TReturn>,
  options: TracingOptions<TArgs, TReturn>,
  variableName?: string,
): WrappedFunction<TArgs, TReturn> {
  // Idempotency check: if already instrumented, return as-is
  if (hasInstrumentationFlag(fnFactory)) {
    // If already instrumented, we need to extract the original factory
    // For now, we'll just proceed - this edge case is handled by the wrapped function check
  }

  const config = getConfig();
  const tracer = config.tracer;
  const meter = config.meter;
  // Annotate as Sampler so the optional hooks stay visible. Inference would
  // narrow to AlwaysSampler and hide them behind `in` checks.
  const sampler: Sampler = options.sampler || new AlwaysSampler();

  const spanName = getSpanName(
    options,
    fnFactory as unknown as InstrumentableFunction<TArgs, TReturn>,
    variableName,
  );

  // Metrics setup (if enabled)
  const callCounter = options.withMetrics
    ? meter.createCounter(`${spanName}.calls`, {
        description: `Call count for ${spanName}`,
        unit: '1',
      })
    : undefined;

  const durationHistogram = options.withMetrics
    ? meter.createHistogram(`${spanName}.duration`, {
        description: `Duration for ${spanName}`,
        unit: 'ms',
      })
    : undefined;

  // Return wrapped function
  function wrappedFunction(
    this: unknown,
    ...args: TArgs
  ): TReturn | Promise<TReturn> {
    const samplingContext: SamplingContext = {
      operationName: spanName,
      args,
      metadata: {},
    };

    const shouldSample = sampler.shouldSample(samplingContext);
    // Read the rate next to the decision that produced it: a windowed sampler
    // can move on to a new rate before the span closes.
    const sampleRate = sampler.sampleRate?.(samplingContext);
    const needsTailSampling = sampler.needsTailSampling?.() ?? false;

    // If not sampling and no tail sampling, execute without tracing
    if (!shouldSample && !needsTailSampling) {
      const fn = fnFactory(createDummyCtx());
      return fn.call(this, ...args);
    }

    const startTime = performance.now();

    const isRootSpan =
      options.startNewRoot || otelTrace.getActiveSpan() === undefined;
    const flushRootTelemetry = createRootTelemetryFlusher(options, isRootSpan);

    // Build span options including root and kind
    const spanOptions: import('@opentelemetry/api').SpanOptions = {};
    if (options.startNewRoot) {
      spanOptions.root = true;
    }
    if (options.spanKind !== undefined) {
      spanOptions.kind = options.spanKind;
    }

    const parentContext = getActiveContextWithBaggage();
    return tracer.startActiveSpan(
      spanName,
      spanOptions,
      parentContext,
      (span) => {
        // Run within operation context so events can auto-capture operation.name
        return runInOperationContext(spanName, () =>
          runWithTraceContextStorage(() => {
            let shouldKeepSpan = true;

            // Store span name for trace context helpers
            setSpanName(span, spanName);

            // Only worth recording when the sampler actually dropped events.
            if (sampleRate !== undefined && sampleRate > 1) {
              span.setAttribute(AUTOTEL_SAMPLING_RATE, sampleRate);
            }

            // Create trace context for this span using shared utility
            const ctxValue = createTraceContext(span);

            // Get the actual function from the factory
            const fn = fnFactory(ctxValue);

            // Extract attributes only when actually tracing
            // This avoids expensive preprocessing when sampling rejects the trace
            const argsAttributes: Attributes = {
              ...captureInputAttrs(args, options.captureInput),
              ...(options.attributesFromArgs
                ? options.attributesFromArgs(args)
                : {}),
            } as Attributes;

            const handleTailSampling = (
              success: boolean,
              duration: number,
              error?: Error,
            ) => {
              if (needsTailSampling && sampler.shouldKeepTrace) {
                shouldKeepSpan = sampler.shouldKeepTrace(samplingContext, {
                  success,
                  duration,
                  error,
                });
                span.setAttribute(AUTOTEL_SAMPLING_TAIL_KEEP, shouldKeepSpan);
                span.setAttribute(AUTOTEL_SAMPLING_TAIL_EVALUATED, true);
              }
            };

            const onSuccess = (result: TReturn) => {
              const duration = performance.now() - startTime;

              callCounter?.add(1, {
                operation: spanName,
                status: 'success',
              });

              durationHistogram?.record(duration, {
                operation: spanName,
                status: 'success',
              });

              const resultAttributes = {
                ...captureOutputAttrs(result, options.captureOutput),
                ...(options.attributesFromResult
                  ? options.attributesFromResult(result)
                  : {}),
              };

              span.setStatus({ code: SpanStatusCode.OK });
              span.setAttributes({
                ...argsAttributes,
                ...resultAttributes,
                'operation.name': spanName,
                'code.function': spanName,
                'operation.duration': duration,
                'operation.success': true,
              });

              handleTailSampling(true, duration);

              span.end();
              return result;
            };

            const onError = (error: unknown): never => {
              finalizeThrownSpan(error, options.isError, {
                span,
                spanName,
                duration: performance.now() - startTime,
                callCounter,
                durationHistogram,
                handleTailSampling,
                extraAttributes: argsAttributes,
              });
              throw error;
            };

            try {
              callCounter?.add(1, {
                operation: spanName,
                status: 'started',
              });

              const result = context.with(getActiveContextWithBaggage(), () =>
                fn.call(this, ...args),
              );

              if (result instanceof Promise) {
                return result.then(
                  async (value) => {
                    const completed = onSuccess(value);
                    await flushRootTelemetry();
                    return completed;
                  },
                  async (error) => {
                    try {
                      return onError(error);
                    } finally {
                      await flushRootTelemetry();
                    }
                  },
                );
              }

              const completed = onSuccess(result);
              void flushRootTelemetry();
              return completed;
            } catch (error) {
              try {
                return onError(error);
              } finally {
                void flushRootTelemetry();
              }
            }
          }),
        );
      },
    );
  }

  // Mark as instrumented to prevent double-wrapping
  (wrappedFunction as InstrumentedFlag)[INSTRUMENTED_SYMBOL] = true;

  Object.defineProperty(wrappedFunction, 'name', {
    value: variableName || 'trace',
    configurable: true,
  });

  return wrappedFunction as WrappedFunction<TArgs, TReturn>;
}

/**
 * Approach 1: trace() - Zero-ceremony HOF
 *
 * Wrap a plain function with automatic tracing. The function receives its real
 * arguments; no context parameter is injected. Use
 * {@link getActiveTraceContext} inside the function, or use {@link withTracing}
 * for the explicit `(ctx) => (...args) => result` factory form.
 *
 * @example Auto-inferred name - Plain function
 * ```typescript
 * export const createUser = trace(async (data) => {
 *   return await db.users.create(data)
 * })
 * // → Traced as "createUser"
 * ```
 *
 * @example Ambient context access
 * ```typescript
 * export const createUser = trace(async (data) => {
 *   getActiveTraceContext()?.setAttribute('user.id', data.id)
 *   return await db.users.create(data)
 * })
 * ```
 *
 * @example Custom name - Plain function
 * ```typescript
 * export const createUser = trace('user.create', async (data) => {
 *   return await db.users.create(data)
 * })
 * // → Traced as "user.create"
 * ```
 *
 * @example Explicit factory context with withTracing()
 * ```typescript
 * export const createUser = withTracing({ name: 'user.create' })((ctx) => async (data) => {
 *   ctx.setAttribute('user.id', data.id)
 *   return await db.users.create(data)
 * })
 * ```
 *
 * @example Full options - Plain function
 * ```typescript
 * export const createUser = trace({
 *   name: 'user.create',
 *   sampler: new AdaptiveSampler(),
 *   withMetrics: true
 * }, async (data) => {
 *   return await db.users.create(data)
 * })
 * ```
 *
 */
// Plain-function overloads. `trace()` always wraps a plain function that
// receives its real arguments; it never injects a context parameter and never
// inspects the function. Reach the active span via getActiveTraceContext()
// inside the body. For the explicit `(ctx) => (args) => result` factory form,
// use withTracing(). `TReturn` captures the return type verbatim, so async
// functions infer `(...args) => Promise<...>` with no separate overload.

// trace(fn)
export function trace<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;
// trace(name, fn)
export function trace<TArgs extends unknown[], TReturn>(
  name: string,
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;
// trace(options, fn)
export function trace<TArgs extends unknown[], TReturn>(
  options: TracingOptions<TArgs, TReturn>,
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;
// Implementation
export function trace<TArgs extends unknown[] = unknown[], TReturn = unknown>(
  fnOrNameOrOptions:
    | ((...args: TArgs) => TReturn)
    | ((...args: TArgs) => Promise<TReturn>)
    | string
    | TracingOptions<TArgs, TReturn>,
  maybeFn?:
    ((...args: TArgs) => TReturn) | ((...args: TArgs) => Promise<TReturn>),
): WrappedFunction<TArgs, TReturn> {
  // trace(fn) - the function is plain; it receives its real arguments and no
  // context is injected. Reach the active span via getActiveTraceContext().
  if (typeof fnOrNameOrOptions === 'function') {
    return wrapPlainWithTracing(
      fnOrNameOrOptions as (...args: TArgs) => TReturn,
      {} as TracingOptions<TArgs, TReturn>,
    );
  }

  // trace(name, fn) or trace(options, fn)
  if (!maybeFn) {
    throw new Error('trace(name|options, fn): fn is required');
  }

  const options: TracingOptions<TArgs, TReturn> =
    typeof fnOrNameOrOptions === 'string'
      ? ({ name: fnOrNameOrOptions } as TracingOptions<TArgs, TReturn>)
      : fnOrNameOrOptions;

  return wrapPlainWithTracing(maybeFn as (...args: TArgs) => TReturn, options);
}

/**
 * Approach 2: withTracing() - Middleware-style composable wrapper
 *
 * Returns a HOF that wraps functions with tracing.
 * Perfect for composition and reusable configuration.
 *
 * @example Standard usage
 * ```typescript
 * export const createUser = withTracing({
 *   name: 'user.create'
 * })(ctx => async (data) => {
 *   ctx.setAttribute('user.id', data.id)
 *   return await db.users.create(data)
 * })
 * ```
 *
 * @example Composable
 * ```typescript
 * const tracer = withTracing({ serviceName: 'user' })
 *
 * export const createUser = tracer(ctx => async (data) => { })
 * export const updateUser = tracer(ctx => async (id, data) => { })
 * ```
 *
 * @example With other middleware
 * ```typescript
 * export const createUser = compose(
 *   withAuth({ role: 'admin' }),
 *   withTracing({ name: 'user.create' }),
 *   withRateLimit({ max: 100 })
 * )(ctx => async (data) => { })
 * ```
 */
export function withTracing<
  TCfgArgs extends unknown[] = unknown[],
  TCfgReturn = unknown,
>(options: TracingOptions<TCfgArgs, TCfgReturn> = {}) {
  return <TArgs extends TCfgArgs, TReturn extends TCfgReturn>(
    fnFactory: (
      ctx: TraceContext,
    ) => (...args: TArgs) => TReturn | Promise<TReturn>,
  ): WrappedFunction<TArgs, TReturn> =>
    wrapFactoryWithTracing<TArgs, TReturn>(fnFactory, options);
}

/**
 * Approach 3: instrument() - Batch auto-instrumentation
 *
 * Instrument an entire module/object at once.
 * Closest to @Instrumented decorator pattern.
 *
 * @example Basic usage
 * ```typescript
 * export default instrument({
 *   functions: {
 *     createUser: async (data) => { },
 *     updateUser: async (id, data) => { },
 *     deleteUser: async (id) => { }
 *   },
 *   serviceName: 'user',
 *   sampler: new AdaptiveSampler()
 * })
 * // → Traced as "user.createUser", "user.updateUser", "user.deleteUser"
 * ```
 *
 * @example Per-function overrides
 * ```typescript
 * export default instrument({
 *   functions: {
 *     createUser: async (data) => { },
 *     deleteUser: async (id) => { }
 *   },
 *   serviceName: 'user',
 *   overrides: {
 *     deleteUser: {
 *       sampler: new AlwaysSampler(),
 *       withMetrics: true
 *     }
 *   }
 * })
 * ```
 *
 * @example Skip functions
 * ```typescript
 * export default instrument({
 *   functions: {
 *     createUser: async (data) => { },
 *     _internal: async () => { }, // Auto-skipped (_-prefix)
 *     deleteUser: async (id) => { }
 *   },
 *   serviceName: 'user',
 *   skip: [/^test/, (key) => key.includes('debug')]
 * })
 * ```
 */
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

  const { functions, ...tracingOptions } = options as InstrumentOptions<T>;
  if (!functions || typeof functions !== 'object') {
    throw new TypeError(
      'instrument: expected { key, fn } or { functions: { name: fn } }',
    );
  }
  const instrumented: Partial<T> = {};

  for (const key of Object.keys(functions)) {
    const typedKey = key as keyof T;
    const fn = functions[typedKey];

    // Skip if not a function or undefined - just pass through the value
    if (!fn || typeof fn !== 'function') {
      instrumented[typedKey] = fn as T[typeof typedKey];
      continue;
    }

    // Only instrument own enumerable async functions
    // Check if should skip
    if (shouldSkip(key, fn, tracingOptions.skip)) {
      instrumented[typedKey] = fn as T[typeof typedKey];
      continue;
    }

    // Merge base options with per-function overrides
    const fnOptions: TracingOptions = {
      ...tracingOptions,
      ...tracingOptions.overrides?.[key],
      // If no explicit name, use key as function name
      name: tracingOptions.overrides?.[key]?.name,
    };

    // Bind function to original object to preserve 'this' context
    // This ensures methods can access state on the original object
    const boundFn = fn.bind(functions);

    // Convert plain function to factory pattern for trace()
    // For instrument(), we create a factory that ignores ctx and returns the original function
    const fnFactory = (ctx: TraceContext) => {
      void ctx;
      return boundFn;
    };

    // Wrap with tracing (sync or async based on implementation)
    instrumented[typedKey] = wrapFactoryWithTracing(
      fnFactory,
      fnOptions,
      key,
    ) as unknown as T[typeof typedKey];
  }

  return instrumented as T;
}

/**
 * Options for span() function
 */
export interface SpanOptions {
  /** Span name */
  name: string;
  /** Attributes to set on the span */
  attributes?: Record<string, string | number | boolean>;
  /** OpenTelemetry span kind */
  spanKind?: import('@opentelemetry/api').SpanKind;
}

/**
 * Execute a function within a named span
 *
 * Useful for adding tracing to specific code blocks without wrapping
 * the entire function. Supports both synchronous and asynchronous functions.
 *
 * Mirrors `trace()`: pass a span name as the first argument for the common
 * case, or full `SpanOptions` when you need to attach attributes.
 *
 * @example
 * ```typescript
 * // Name shorthand
 * await span('payment.charge', async (span) => {
 *   await chargeCustomer(order);
 * })
 *
 * // Full options when attributes are needed
 * await span(
 *   { name: 'payment.charge', attributes: { amount: order.total } },
 *   async (span) => {
 *     await chargeCustomer(order);
 *   },
 * )
 *
 * // Sync
 * const total = span('calculateTotal', (span) => {
 *   return items.reduce((sum, item) => sum + item.price, 0);
 * })
 * ```
 */
// Overloads — sync first (more specific match), then async.
// Each shape is offered with a string name OR a full SpanOptions object so
// span() aligns with trace()'s argument flexibility.
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
// Implementation
export function span<T = unknown>(
  nameOrOptions: string | SpanOptions,
  fn: (span: Span) => T | Promise<T>,
): T | Promise<T> {
  const options: SpanOptions =
    typeof nameOrOptions === 'string' ? { name: nameOrOptions } : nameOrOptions;
  const config = getConfig();
  const tracer = config.tracer;
  const { name, attributes, spanKind } = options;

  const executeSpan = (span: Span) => {
    // Run within operation context so events can auto-capture operation.name
    return runInOperationContext(name, () => {
      try {
        // Set attributes
        if (attributes) {
          for (const [key, value] of Object.entries(attributes)) {
            span.setAttribute(key, value);
          }
        }

        const result = fn(span);

        // Check if result is a Promise
        if (result instanceof Promise) {
          return result
            .then((resolved) => {
              span.setStatus({ code: SpanStatusCode.OK });
              span.end();
              return resolved;
            })
            .catch((error) => {
              const errorMessage =
                error instanceof Error
                  ? error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH)
                  : String(error).slice(0, MAX_ERROR_MESSAGE_LENGTH);

              span.setAttribute('error.message', errorMessage);
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: errorMessage,
              });

              span.recordException(
                error instanceof Error ? error : new Error(String(error)),
              );
              span.end();
              throw error;
            });
        } else {
          // Synchronous function
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return result;
        }
      } catch (error) {
        // Synchronous error handling
        const errorMessage =
          error instanceof Error
            ? error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH)
            : String(error).slice(0, MAX_ERROR_MESSAGE_LENGTH);

        span.setAttribute('error.message', errorMessage);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: errorMessage,
        });

        span.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );
        span.end();
        throw error;
      }
    });
  };

  const parentContext = getActiveContextWithBaggage();
  const result = tracer.startActiveSpan(
    name,
    spanKind === undefined ? {} : { kind: spanKind },
    parentContext,
    executeSpan,
  );

  // tracer.startActiveSpan might return a Promise even for sync callbacks
  // Check if it's a Promise and handle accordingly
  if (result instanceof Promise) {
    return result;
  }

  return result as T;
}

/**
 * Options for withNewContext() function
 */
export interface WithNewContextOptions<T = unknown> {
  /** Function to execute in new root context */
  fn: () => Promise<T>;
}

/**
 * Execute a function in a new root context (prevents span propagation)
 *
 * Useful when you want to start a completely new trace without
 * parent-child relationships.
 *
 * @example
 * ```typescript
 * async function handleWebhook(payload: WebhookPayload) {
 *   // This creates a new root trace, not connected to the HTTP request trace
 *   await withNewContext({
 *     fn: async () => {
 *       await span('webhook.process', async () => {
 *         await processWebhookPayload(payload)
 *       })
 *     }
 *   })
 * }
 * ```
 */
export async function withNewContext<T = unknown>(
  options: WithNewContextOptions<T>,
): Promise<T> {
  const { fn } = options;
  const config = getConfig();
  const tracer = config.tracer;

  // Start a new root span (breaks trace propagation)
  return tracer.startActiveSpan('root', { root: true }, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(
        error instanceof Error ? error : new Error(String(error)),
      );
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Options for withBaggage() function
 */
export interface WithBaggageOptions<T = unknown> {
  /** Baggage entries to set (key-value pairs) */
  baggage: Record<string, string>;
  /** Function to execute with the updated baggage */
  fn: () => T | Promise<T>;
}

/**
 * Execute a function with updated baggage entries
 *
 * Baggage is immutable in OpenTelemetry, so this helper creates a new context
 * with the specified baggage entries and runs the function within that context.
 * All child spans created within the function will inherit the baggage.
 *
 * @example Setting baggage for downstream services
 * ```typescript
 * import { withTracing, withBaggage } from 'autotel';
 *
 * export const createOrder = withTracing({ name: 'order.create' })((ctx) => async (order: Order) => {
 *   // Set baggage that will be propagated to downstream HTTP calls
 *   return await withBaggage({
 *     baggage: {
 *       'tenant.id': order.tenantId,
 *       'user.id': order.userId,
 *     },
 *     fn: async () => {
 *       // This HTTP call will include the baggage in headers
 *       await fetch('/api/charge', {
 *         method: 'POST',
 *         body: JSON.stringify(order),
 *       });
 *     },
 *   });
 * });
 * ```
 *
 * @example Using with existing baggage
 * ```typescript
 * export const processOrder = withTracing({ name: 'order.process' })((ctx) => async (order: Order) => {
 *   // Read existing baggage
 *   const tenantId = ctx.getBaggage('tenant.id');
 *
 *   // Add additional baggage entries
 *   return await withBaggage({
 *     baggage: {
 *       'order.id': order.id,
 *       'order.amount': String(order.amount),
 *     },
 *     fn: async () => {
 *       await charge(order);
 *     },
 *   });
 * });
 * ```
 */
export function withBaggage<T = unknown>(
  options: WithBaggageOptions<T>,
): T | Promise<T> {
  const { baggage: baggageEntries, fn } = options;
  const currentContext = context.active();

  // Get existing baggage or create new
  let updatedBaggage =
    propagation.getBaggage(currentContext) ?? propagation.createBaggage();

  // Set all baggage entries
  for (const [key, value] of Object.entries(baggageEntries)) {
    updatedBaggage = updatedBaggage.setEntry(key, { value });
  }

  // Create new context with updated baggage
  const newContext = propagation.setBaggage(currentContext, updatedBaggage);

  // Sync contextStorage so nested traces (via getActiveContextWithBaggage) see the baggage.
  // Use run() instead of enterWith() to properly scope the context changes.
  const ctxStorage = getContextStorage();
  const previousStored = ctxStorage.getStore();
  const baggageEnrichedStored = previousStored
    ? { value: propagation.setBaggage(previousStored.value, updatedBaggage) }
    : { value: newContext };

  // Run the function within the new context, scoped properly
  const result = previousStored
    ? ctxStorage.run(baggageEnrichedStored, () => context.with(newContext, fn))
    : context.with(newContext, fn);

  if (result instanceof Promise) {
    // For async operations, ensure context is restored after the promise settles
    return result.then(
      (value) => {
        // Restore original context before resolving
        if (previousStored) {
          return ctxStorage.run(previousStored, () => value);
        }
        return value;
      },
      (error) => {
        // Restore original context before rejecting
        if (previousStored) {
          return ctxStorage.run(previousStored, () => {
            throw error;
          });
        }
        throw error;
      },
    );
  }

  // Sync function - context automatically restored when scope exits
  return result;
}
