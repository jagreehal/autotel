import {
  SpanStatusCode,
  context,
  trace as otelTrace,
  type Attributes,
  type Counter,
  type Histogram,
  type Span,
  type SpanKind,
} from '@opentelemetry/api';
import { getConfig } from './config';
import { promiseFromThenable } from './is-thenable';
import { evidenceAttribute } from './evidence';
import { getConfig as getInitConfig, getSdk } from './init';
import { runInOperationContext } from './operation-context';
import {
  AlwaysSampler,
  AUTOTEL_SAMPLING_RATE,
  AUTOTEL_SAMPLING_TAIL_EVALUATED,
  AUTOTEL_SAMPLING_TAIL_KEEP,
  isForceKept,
  debugCaptureRequested,
  type Sampler,
  type SamplingContext,
} from './sampling';
import { getEventQueue } from './track';
import {
  createTraceContext,
  getActiveContextWithBaggage,
  getContextStorage,
  hasExplicitSpanStatus,
  type TraceContext,
} from './trace-context';
import { setSpanName } from './trace-helpers';
import { getForceFlushableProvider } from './tracer-provider';
import { inferVariableNameFromCallStack } from './variable-name-inference';
import type { UnknownRecord } from './values';
import { asString, isDevelopment } from './values';

export type WrappedFunction<TArgs extends unknown[], TReturn> = (
  ...args: TArgs
) => TReturn | Promise<TReturn>;

/**
 * Constraint alias for `instrument()` and friends. `never[]` parameters make
 * every concretely-typed function satisfy the constraint under
 * `strictFunctionTypes` while preserving its inferred call signature.
 */
export type AnyInstrumentable = ((...args: never[]) => unknown) & {
  displayName?: string;
  name?: string;
};

/** Common options for functional tracing. */
export interface TracingOptions<
  TArgs extends unknown[] = unknown[],
  TReturn = unknown,
> {
  /**
   * Span name (highest priority).
   * If provided, this is used as the span name.
   */
  name?: string;
  /**
   * Service name used to compose `${serviceName}.${functionName}` when no
   * explicit name is provided.
   */
  serviceName?: string;
  /**
   * Sampling strategy.
   * @default AlwaysSampler
   */
  sampler?: Sampler;
  /**
   * Enable call and duration metrics.
   * @default false
   */
  withMetrics?: boolean;
  /** Extract attributes from function arguments. */
  attributesFromArgs?: (args: TArgs) => Attributes;
  /** Extract attributes from the function result. */
  /** Receives the resolved value when the function returns a Promise. */
  attributesFromResult?: (result: Awaited<TReturn>) => Attributes;
  /**
   * Capture arguments on the span as the truncated JSON `autotel.input`
   * attribute. One argument is captured directly; multiple arguments are an
   * array. Avoid this for secrets/PII, or pair it with a redacting processor.
   */
  captureInput?: boolean;
  /**
   * Capture the result on the span as the truncated JSON `autotel.output`
   * attribute. The same sensitive-data caveats as {@link captureInput} apply.
   */
  captureOutput?: boolean;
  /**
   * Start a new root span instead of creating a child.
   * Useful for serverless entry points.
   * @default false
   */
  startNewRoot?: boolean;
  /**
   * Flush telemetry when a root span ends.
   * @default true
   */
  flushOnRootSpanEnd?: boolean;
  /**
   * OpenTelemetry span kind for semantic convention compliance.
   * @default SpanKind.INTERNAL
   */
  spanKind?: SpanKind;
  /**
   * Classify a thrown value as a real error. Returning false treats the throw
   * as expected control flow: the span is marked OK, no exception is recorded,
   * and the original value is rethrown. This supports framework signals such
   * as `redirect()` and `notFound()`.
   * @default every throw is treated as an error
   */
  isError?: (cause: unknown) => boolean;
}

/** Options for `instrument()` batch instrumentation. */
export interface InstrumentOptions<
  T extends Record<string, AnyInstrumentable> = Record<
    string,
    AnyInstrumentable
  >,
> extends TracingOptions {
  /** Object whose function properties should be instrumented. */
  functions: T;
  /** Per-function configuration overrides. */
  overrides?: Record<string, Partial<TracingOptions>>;
  /**
   * Functions to skip. Supports string keys, regular expressions, and
   * predicates. Functions whose keys start with `_` are skipped by default.
   */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  skip?: (string | RegExp | ((key: string, fn: Function) => boolean))[];
}

/** Options for instrumenting one function with an explicit stable key. */
export interface SingleInstrumentOptions<
  TFunction extends AnyInstrumentable = AnyInstrumentable,
> extends TracingOptions {
  /** Stable function key used for span naming. */
  key: string;
  /** Function to instrument. */
  fn: TFunction;
}

export const FUNCTIONAL_ERROR_MESSAGE_LIMIT = 500;
const AUTOTEL_INPUT_ATTR = 'autotel.input';
const AUTOTEL_OUTPUT_ATTR = 'autotel.output';
const CAPTURE_MAX_CHARS = 4096;

let unknownSpanNameWarningEmitted = false;

type InstrumentableFunction<
  TArgs extends unknown[] = unknown[],
  TReturn = unknown,
> = ((...args: TArgs) => TReturn | Promise<TReturn>) & {
  displayName?: string;
  name?: string;
};

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
  extraAttributes?: Attributes;
}

function inferFunctionName<
  TArgs extends unknown[] = unknown[],
  TReturn = unknown,
>(fn: InstrumentableFunction<TArgs, TReturn>): string | undefined {
  if (fn.displayName) return fn.displayName;
  if (fn.name && fn.name !== 'anonymous') return fn.name;

  const match = Function.prototype.toString
    .call(fn)
    .match(/function\s+([^(\s]+)/);
  return match?.[1] && match[1] !== 'anonymous' ? match[1] : undefined;
}

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

function getSpanName<TArgs extends unknown[], TReturn>(
  options: TracingOptions<TArgs, TReturn>,
  fn: InstrumentableFunction<TArgs, TReturn>,
  variableName?: string,
): string {
  if (options.name) return options.name;

  const fnName = variableName || inferFunctionName(fn) || 'anonymous';
  if (options.serviceName) return `${options.serviceName}.${fnName}`;
  if (fnName !== 'anonymous') return fnName;

  const initConfig = getInitConfig();
  if (
    isDevelopment() &&
    !unknownSpanNameWarningEmitted &&
    initConfig?.logger?.warn
  ) {
    unknownSpanNameWarningEmitted = true;
    initConfig.logger.warn(
      {},
      '[autotel] Span name resolved to "unknown". Use instrument({ key: "operation.name", fn }) for a reusable named wrapper.',
    );
  }
  return 'unknown';
}

function createDummyCtx<
  TBaggage extends UnknownRecord | undefined = undefined,
>(): TraceContext<TBaggage> {
  // SAFETY: a context for a span that is not recording. Every method is a
  // no-op and every id is empty, which is what each caller sees when
  // sampling has decided against the span - the shape is TraceContext's, the
  // hop is only because a bag of no-ops cannot be inferred as one.
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

/**
 * Serialize a captured value, and say whether the ceiling cut it. The flag is
 * separate from the text because `…[truncated]` inside the value is only
 * legible to a human reading one span — a backend cannot filter on it.
 */
function serializeCapture(
  value: unknown,
): { text: string; truncated: boolean } | undefined {
  if (value === undefined) return undefined;
  try {
    const json = asString(value) ?? JSON.stringify(value);
    if (json === undefined) return undefined;
    return json.length > CAPTURE_MAX_CHARS
      ? {
          text: `${json.slice(0, CAPTURE_MAX_CHARS)}…[truncated]`,
          truncated: true,
        }
      : { text: json, truncated: false };
  } catch {
    return undefined;
  }
}

function captureAttrs(
  value: unknown,
  valueAttr: string,
  field: string,
  enabled?: boolean,
): Attributes {
  if (!enabled) return {};
  const serialized = serializeCapture(value);
  if (serialized === undefined) return {};
  return {
    [valueAttr]: serialized.text,
    ...(serialized.truncated && { [evidenceAttribute(field)]: 'truncated' }),
  };
}

function captureInputAttrs(args: unknown[], enabled?: boolean): Attributes {
  return captureAttrs(
    args.length === 1 ? args[0] : args,
    AUTOTEL_INPUT_ATTR,
    'input',
    enabled,
  );
}

function captureOutputAttrs(result: unknown, enabled?: boolean): Attributes {
  return captureAttrs(result, AUTOTEL_OUTPUT_ATTR, 'output', enabled);
}

function truncateErrorMessage(message: string): string {
  return message.length <= FUNCTIONAL_ERROR_MESSAGE_LIMIT
    ? message
    : `${message.slice(0, FUNCTIONAL_ERROR_MESSAGE_LIMIT)}... (truncated)`;
}

function finalizeThrownSpan(
  error: unknown,
  isError: ((cause: unknown) => boolean) | undefined,
  finalizeContext: SpanFinalizeContext,
): void {
  const {
    span,
    spanName,
    duration,
    callCounter,
    durationHistogram,
    handleTailSampling,
    extraAttributes,
  } = finalizeContext;
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
      error.stack.slice(0, FUNCTIONAL_ERROR_MESSAGE_LIMIT),
    );
  }
  const thrown = error instanceof Error ? error : new Error(String(error));
  span.recordException(thrown);
  handleTailSampling(false, duration, thrown);
  span.end();
}

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
      if (queue && queue.size() > 0) await queue.flush();
      if (shouldFlushSpans) {
        const tracerProvider = getForceFlushableProvider(getSdk());
        await tracerProvider?.forceFlush();
      }
    } catch (error) {
      getInitConfig()?.logger?.error?.(
        { err: error instanceof Error ? error : undefined },
        `[autotel] Auto-flush failed${error instanceof Error ? '' : `: ${String(error)}`}`,
      );
    }
  };
}

function runWithTraceContextStorage<TResult>(fn: () => TResult): TResult {
  const storage = getContextStorage();
  if (storage.getStore()) return fn();
  return storage.run({ value: context.active() }, fn);
}

function wrapWithTracingSync<TArgs extends unknown[], TReturn>(
  fnFactory: (
    ctx: TraceContext,
    // PromiseLike, not just Promise: see promiseFromThenable.
  ) => (...args: TArgs) => TReturn | PromiseLike<TReturn>,
  options: TracingOptions<TArgs, TReturn>,
  variableName?: string,
): WrappedFunction<TArgs, TReturn> {
  const { tracer, meter } = getConfig();
  const sampler: Sampler = options.sampler || new AlwaysSampler();
  // SAFETY: getSpanName reads only `name` and `displayName` off the function
  // it is given, to infer a span name. A factory has those too - it is the
  // caller's own function - and nothing else about it is read.
  const spanName = getSpanName(
    options,
    fnFactory as unknown as InstrumentableFunction<TArgs, TReturn>,
    variableName,
  );
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
    const sampleRate = sampler.sampleRate?.(samplingContext);
    const needsTailSampling = sampler.needsTailSampling?.() ?? false;

    if (!shouldSample && !needsTailSampling) {
      const unsampled = fnFactory(createDummyCtx()).call(this, ...args);
      // A thenable becomes a real Promise here so the unsampled path hands back
      // the same shape as the sampled one. Synchronous results stay synchronous.
      // promiseFromThenable() returns undefined only for a non-thenable, so the
      // fallback is a plain TReturn — a narrowing the compiler cannot see.
      return (promiseFromThenable(unsampled) ?? unsampled) as
        TReturn | Promise<TReturn>;
    }

    const startTime = performance.now();
    const isRootSpan =
      options.startNewRoot || otelTrace.getActiveSpan() === undefined;
    const flushRootTelemetry = createRootTelemetryFlusher(options, isRootSpan);
    const spanOptions: import('@opentelemetry/api').SpanOptions = {};
    if (options.startNewRoot) spanOptions.root = true;
    if (options.spanKind !== undefined) spanOptions.kind = options.spanKind;

    return tracer.startActiveSpan(
      spanName,
      spanOptions,
      getActiveContextWithBaggage(),
      (span) =>
        runInOperationContext(spanName, () =>
          runWithTraceContextStorage(() => {
            let shouldKeepSpan = true;
            setSpanName(span, spanName);
            if (sampleRate !== undefined && sampleRate > 1) {
              span.setAttribute(AUTOTEL_SAMPLING_RATE, sampleRate);
            }

            const fn = fnFactory(createTraceContext(span));
            const argsAttributes: Attributes = {
              ...captureInputAttrs(args, options.captureInput),
              ...options.attributesFromArgs?.(args),
            };
            const handleTailSampling = (
              success: boolean,
              duration: number,
              error?: Error,
            ) => {
              if (
                needsTailSampling &&
                sampler.shouldKeepTrace &&
                !isForceKept(span) &&
                !debugCaptureRequested()
              ) {
                shouldKeepSpan = sampler.shouldKeepTrace(samplingContext, {
                  success,
                  duration,
                  error,
                });
                span.setAttribute(AUTOTEL_SAMPLING_TAIL_KEEP, shouldKeepSpan);
                span.setAttribute(AUTOTEL_SAMPLING_TAIL_EVALUATED, true);
              }
            };
            const onSuccess = (result: Awaited<TReturn>) => {
              const duration = performance.now() - startTime;
              callCounter?.add(1, {
                operation: spanName,
                status: 'success',
              });
              durationHistogram?.record(duration, {
                operation: spanName,
                status: 'success',
              });
              const resultAttributes: Attributes = {
                ...captureOutputAttrs(result, options.captureOutput),
                ...options.attributesFromResult?.(result),
              };
              if (!hasExplicitSpanStatus(span)) {
                span.setStatus({ code: SpanStatusCode.OK });
              }
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
            const onError = (cause: unknown): never => {
              finalizeThrownSpan(cause, options.isError, {
                span,
                spanName,
                duration: performance.now() - startTime,
                callCounter,
                durationHistogram,
                handleTailSampling,
                extraAttributes: argsAttributes,
              });
              throw cause;
            };

            try {
              callCounter?.add(1, {
                operation: spanName,
                status: 'started',
              });
              const result = context.with(
                otelTrace.setSpan(getActiveContextWithBaggage(), span),
                () => fn.call(this, ...args),
              );
              // Anything thenable, not just native Promises.
              const resultPromise = promiseFromThenable(result);
              if (resultPromise) {
                return resultPromise.then(
                  async (value) => {
                    // SAFETY: Promise fulfillment is the awaited function result.
                    const completed = onSuccess(value as Awaited<TReturn>);
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
              // SAFETY: this branch established that the result is synchronous.
              const completed = onSuccess(result as Awaited<TReturn>);
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
        ),
    );
  }

  Object.defineProperty(wrappedFunction, 'name', {
    value: variableName || 'trace',
    configurable: true,
  });
  return wrappedFunction;
}

/** Wrap an explicit `(ctx) => (...args) => result` context factory. */
export function wrapFactoryWithTracing<TArgs extends unknown[], TReturn>(
  factory: (
    ctx: TraceContext,
    // PromiseLike, not just Promise: see promiseFromThenable.
  ) => (...args: TArgs) => TReturn | PromiseLike<TReturn>,
  options: TracingOptions<TArgs, TReturn>,
  variableName?: string,
): WrappedFunction<TArgs, TReturn> {
  return wrapWithTracingSync(
    factory,
    options,
    // SAFETY: resolveVariableName reads the function's own name, which every
    // function has.
    resolveVariableName(factory as InstrumentableFunction, variableName),
  );
}

/** Wrap a plain function without injecting a context argument. */
export function wrapPlainWithTracing<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn | Promise<TReturn>,
  options: TracingOptions<TArgs, TReturn>,
  variableName?: string,
): WrappedFunction<TArgs, TReturn> {
  const effectiveVariableName = resolveVariableName(
    // SAFETY: as above - only the function's own name is read.
    fn as InstrumentableFunction,
    variableName,
  );
  return wrapWithTracingSync(
    (_ctx: TraceContext) => fn,
    options,
    effectiveVariableName,
  );
}

/** Run one operation immediately with its span-bound context. */
export function runWithTraceContext<TReturn>(
  operation: (ctx: TraceContext) => TReturn | Promise<TReturn>,
  options: TracingOptions<[], TReturn>,
): TReturn | Promise<TReturn> {
  const wrapped = wrapFactoryWithTracing<[], TReturn>(
    (ctx) => () => operation(ctx),
    options,
  );
  return wrapped();
}
