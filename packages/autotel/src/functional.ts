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
 * export const createUser = trace(ctx => async (data) => {
 *   ctx.setAttribute('user.id', data.id)
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
} from '@opentelemetry/api';
import { getConfig } from './config';
import { getConfig as getInitConfig, getSdk } from './init';
import { type Sampler, type SamplingContext, AlwaysSampler } from './sampling';
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
 * export const createUser = trace(ctx => async (data: CreateUserData) => {
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

/**
 * Helper type to extract function signature from factory pattern
 * This helps TypeScript infer types correctly for factory functions
 */
type ExtractFunctionSignature<T> = T extends (ctx: TraceContext) => infer F
  ? F extends (...args: infer Args) => infer Return
    ? (...args: Args) => Return
    : never
  : never;

/**
 * Helper type to exclude functions that return functions from immediate execution overloads
 */
type ExcludeFactoryReturn<T> = T extends (ctx: TraceContext) => infer F
  ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
    F extends (...args: any[]) => any
    ? never
    : T
  : T;

type GenericFunction = (...args: unknown[]) => unknown;

const FACTORY_NAME_HINTS = new Set([
  'ctx',
  '_ctx',
  'context',
  'tracecontext',
  'tracectx',
]);
const TRACE_FACTORY_SET = new WeakSet<object>();

const SINGLE_LINE_COMMENT_REGEX = /\/\/.*$/gm;
const MULTI_LINE_COMMENT_REGEX = /\/\*[\s\S]*?\*\//gm;
const PARAM_TOKEN_SANITIZE_REGEX = new RegExp(String.raw`[{}\[\]\s]`, 'g');

function markAsTraceFactory(fn: object): void {
  TRACE_FACTORY_SET.add(fn);
}

function hasFactoryMark(fn: object): boolean {
  return TRACE_FACTORY_SET.has(fn);
}

function sanitizeParameterToken(token: string): string {
  const [firstToken] = token.split('=');
  return (firstToken ?? '').replaceAll(PARAM_TOKEN_SANITIZE_REGEX, '').trim();
}

function getFirstParameterToken(fn: GenericFunction): string | null {
  let source = Function.prototype.toString.call(fn);
  source = source
    .replaceAll(MULTI_LINE_COMMENT_REGEX, '')
    .replaceAll(SINGLE_LINE_COMMENT_REGEX, '')
    .trim();

  // Arrow functions
  const arrowMatch = source.match(
    /^(?:async\s*)?(?:\(([^)]*)\)|([^=()]+))\s*=>/,
  );
  if (arrowMatch) {
    const params = (arrowMatch[1] ?? arrowMatch[2] ?? '').split(',');
    const first = params[0]?.trim();
    if (first) {
      return sanitizeParameterToken(first);
    }
    return null;
  }

  // Function declarations/expressions
  const functionMatch = source.match(/^[^(]*\(([^)]*)\)/);
  if (functionMatch) {
    const params = functionMatch[1]?.split(',');
    const first = params?.[0]?.trim();
    if (first) {
      return sanitizeParameterToken(first);
    }
  }

  return null;
}

function looksLikeTraceFactory(fn: GenericFunction): boolean {
  if (hasFactoryMark(fn)) {
    return true;
  }

  if (fn.length === 0) {
    return false;
  }

  const firstParam = getFirstParameterToken(fn);
  if (!firstParam) {
    return false;
  }

  const normalized = firstParam.toLowerCase();
  if (
    FACTORY_NAME_HINTS.has(normalized) ||
    normalized.startsWith('ctx') ||
    normalized.startsWith('_ctx') ||
    normalized.startsWith('trace') ||
    normalized.endsWith('ctx') || // Match baseCtx, spanCtx, etc.
    normalized.includes('context') // Match traceContext, spanContext, etc.
  ) {
    return true;
  }

  return false;
}

/**
 * Check if a function that takes ctx returns another function (factory pattern)
 * vs returning a value directly (immediate execution pattern)
 *
 * IMPORTANT: For async functions, we skip probing entirely and assume immediate execution.
 * This is because:
 * - Factory pattern: `(ctx) => async (...args) => result` - outer function is SYNC
 * - Immediate execution: `async (ctx) => result` - function itself is ASYNC
 *
 * Probing async functions by executing them causes side effects (like creating orphan spans)
 * because the async function starts executing synchronously until the first await.
 */
function isFactoryReturningFunction(
  fnWithCtx: (ctx: TraceContext) => unknown,
): boolean {
  // Async functions with ctx parameter are always immediate execution
  // because factory patterns have a sync outer function that returns the async inner
  if (isAsyncFunction(fnWithCtx)) {
    return false;
  }

  try {
    const result = fnWithCtx(createDummyCtx());
    return typeof result === 'function';
  } catch {
    // If the function throws when called with dummy ctx, assume it's immediate execution
    // since factory functions typically just return a function and don't execute logic
    return false;
  }
}

function isTraceFactoryFunction<TArgs extends unknown[], TReturn>(
  fn:
    | ((...args: TArgs) => TReturn)
    | ((ctx: TraceContext) => (...args: TArgs) => TReturn),
): fn is (ctx: TraceContext) => (...args: TArgs) => TReturn {
  if (typeof fn !== 'function') {
    return false;
  }

  if (hasFactoryMark(fn)) {
    return true;
  }

  if (looksLikeTraceFactory(fn as GenericFunction)) {
    markAsTraceFactory(fn);
    return true;
  }

  return false;
}

function ensureTraceFactory<TArgs extends unknown[], TReturn>(
  fnOrFactory:
    | ((...args: TArgs) => TReturn | Promise<TReturn>)
    | ((ctx: TraceContext) => (...args: TArgs) => TReturn | Promise<TReturn>),
): (ctx: TraceContext) => (...args: TArgs) => TReturn | Promise<TReturn> {
  if (isTraceFactoryFunction(fnOrFactory)) {
    return fnOrFactory;
  }

  const plainFn = fnOrFactory as (...args: TArgs) => TReturn | Promise<TReturn>;
  const factory = (ctx: TraceContext) => {
    void ctx;
    return plainFn;
  };
  markAsTraceFactory(factory);
  return factory;
}

type WrappedFunction<TArgs extends unknown[], TReturn> = (
  ...args: TArgs
) => TReturn | Promise<TReturn>;

function wrapFactoryWithTracing<TArgs extends unknown[], TReturn>(
  fnOrFactory:
    | ((...args: TArgs) => TReturn | Promise<TReturn>)
    | ((ctx: TraceContext) => (...args: TArgs) => TReturn | Promise<TReturn>),
  options: TracingOptions<TArgs, TReturn>,
  variableName?: string,
): WrappedFunction<TArgs, TReturn> {
  const factory = ensureTraceFactory(fnOrFactory);

  // Get the inner function (the actual function being traced)
  const sampleFn = factory(createDummyCtx());

  // Infer function name with priority:
  // 1. Explicit variable name (from instrument() or explicit name parameter)
  // 2. Inner function name (named function expressions - e.g., "async function createUser")
  // 3. Variable name from call stack (inferred from const assignment, for arrow functions)
  // 4. Factory function name (for cases where factory itself is named)
  const innerFunctionName = inferFunctionName(
    sampleFn as InstrumentableFunction,
  );
  const callStackVariableName = innerFunctionName
    ? undefined
    : inferVariableNameFromCallStack(); // Only infer from call stack if no inner function name
  const factoryName = inferFunctionName(factory as InstrumentableFunction);
  const effectiveVariableName =
    variableName || innerFunctionName || callStackVariableName || factoryName;

  const useAsyncWrapper = isAsyncFunction(sampleFn);

  if (useAsyncWrapper) {
    return wrapWithTracing(
      factory as (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
      options,
      effectiveVariableName,
    ) as WrappedFunction<TArgs, TReturn>;
  }

  return wrapWithTracingSync(
    factory as (ctx: TraceContext) => (...args: TArgs) => TReturn,
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
}

/**
 * Options for instrument() batch instrumentation
 */
export interface InstrumentOptions<
  T extends Record<string, InstrumentableFunction> = Record<
    string,
    InstrumentableFunction
  >,
> extends TracingOptions {
  /** Functions to instrument */
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

// Maximum error message length to prevent span bloat
const MAX_ERROR_MESSAGE_LENGTH = 500;

function createDummyCtx<
  TBaggage extends Record<string, unknown> | undefined = undefined,
>(): TraceContext<TBaggage> {
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

function isAsyncFunction(fn: unknown): boolean {
  return typeof fn === 'function' && fn.constructor?.name === 'AsyncFunction';
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

type InstrumentableFunction<
  TArgs extends unknown[] = unknown[],
  TReturn = unknown,
> = ((...args: TArgs) => TReturn | Promise<TReturn>) & {
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
export const ctx = new Proxy(
  {},
  {
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
  },
);

/**
 * Core tracing wrapper for async functions (internal implementation)
 */
function wrapWithTracing<TArgs extends unknown[], TReturn>(
  fnFactory: (
    ctx: TraceContext,
  ) => (...args: TArgs) => TReturn | Promise<TReturn>,
  options: TracingOptions<TArgs, TReturn>,
  variableName?: string,
): (...args: TArgs) => Promise<TReturn> {
  // Idempotency check: if already instrumented, return as-is
  if (hasInstrumentationFlag(fnFactory)) {
    // Already instrumented - proceed
  }

  const config = getConfig();
  const tracer = config.tracer;
  const meter = config.meter;
  const sampler = options.sampler || new AlwaysSampler();

  const tempFn = fnFactory(createDummyCtx());
  const spanName = getSpanName(options, tempFn, variableName);

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

  const wrappedFunction = async function wrappedFunction(
    this: unknown,
    ...args: TArgs
  ): Promise<TReturn> {
    const samplingContext: SamplingContext = {
      operationName: spanName,
      args,
      metadata: {},
    };

    const shouldSample = sampler.shouldSample(samplingContext);
    const needsTailSampling =
      'needsTailSampling' in sampler &&
      typeof sampler.needsTailSampling === 'function'
        ? sampler.needsTailSampling()
        : false;

    if (!shouldSample && !needsTailSampling) {
      const fn = fnFactory(createDummyCtx());
      return await fn.call(this, ...args);
    }

    const startTime = performance.now();
    const isRootSpan =
      options.startNewRoot || otelTrace.getActiveSpan() === undefined;
    const shouldAutoFlush =
      options.flushOnRootSpanEnd ?? getInitConfig()?.flushOnRootSpanEnd ?? true;
    const shouldAutoFlushSpans = getInitConfig()?.forceFlushOnShutdown ?? false;

    const flushIfNeeded = async () => {
      if (!shouldAutoFlush || !isRootSpan) return;

      try {
        // Flush events queue
        const queue = getEventQueue();
        if (queue && queue.size() > 0) {
          await queue.flush();
        }

        // Flush OpenTelemetry spans if enabled
        if (shouldAutoFlushSpans) {
          const sdk = getSdk();
          if (sdk) {
            try {
              // Type assertion needed as getTracerProvider is not in the public NodeSDK interface
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const sdkAny = sdk as any;
              if (typeof sdkAny.getTracerProvider === 'function') {
                const tracerProvider = sdkAny.getTracerProvider();
                if (
                  tracerProvider &&
                  typeof tracerProvider.forceFlush === 'function'
                ) {
                  await tracerProvider.forceFlush();
                }
              }
            } catch {
              // Ignore errors when accessing tracer provider (may not be available in test mocks)
            }
          }
        }
      } catch (error) {
        const initConfig = getInitConfig();
        const logger = initConfig?.logger;
        if (logger?.error) {
          if (error instanceof Error) {
            logger.error('[autotel] Auto-flush failed', error);
          } else {
            logger.error(`[autotel] Auto-flush failed: ${String(error)}`);
          }
        }
      }
    };

    // Build span options including root and kind
    const spanOptions: import('@opentelemetry/api').SpanOptions = {};
    if (options.startNewRoot) {
      spanOptions.root = true;
    }
    if (options.spanKind !== undefined) {
      spanOptions.kind = options.spanKind;
    }

    return tracer.startActiveSpan(spanName, spanOptions, async (span) => {
      // Run within operation context so events can auto-capture operation.name
      return runInOperationContext(spanName, async () => {
        let shouldKeepSpan = true;

        setSpanName(span, spanName);

        // Initialize context storage with the active context BEFORE creating trace context
        const initialContext = context.active();
        const contextStorage = getContextStorage();
        if (!contextStorage.getStore()) {
          contextStorage.enterWith(initialContext);
        }

        const ctxValue = createTraceContext(span);
        const fn = fnFactory(ctxValue);
        const argsAttributes = options.attributesFromArgs
          ? options.attributesFromArgs(args)
          : {};

        const handleTailSampling = (
          success: boolean,
          duration: number,
          error?: unknown,
        ) => {
          if (
            needsTailSampling &&
            'shouldKeepTrace' in sampler &&
            typeof sampler.shouldKeepTrace === 'function'
          ) {
            shouldKeepSpan = sampler.shouldKeepTrace(samplingContext, {
              success,
              duration,
              error,
            });
            span.setAttribute('sampling.tail.keep', shouldKeepSpan);
            span.setAttribute('sampling.tail.evaluated', true);
          }
        };

        const onSuccess = async (result: TReturn) => {
          const duration = performance.now() - startTime;

          callCounter?.add(1, {
            operation: spanName,
            status: 'success',
          });

          durationHistogram?.record(duration, {
            operation: spanName,
            status: 'success',
          });

          const resultAttributes = options.attributesFromResult
            ? options.attributesFromResult(result)
            : {};

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
          await flushIfNeeded();
          return result;
        };

        const onError = async (error: unknown): Promise<never> => {
          const duration = performance.now() - startTime;

          callCounter?.add(1, {
            operation: spanName,
            status: 'error',
          });

          durationHistogram?.record(duration, {
            operation: spanName,
            status: 'error',
          });

          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          const truncatedMessage = truncateErrorMessage(errorMessage);

          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: truncatedMessage,
          });

          span.setAttributes({
            ...argsAttributes,
            'operation.name': spanName,
            'code.function': spanName,
            'operation.duration': duration,
            'operation.success': false,
            error: true,
            'exception.type':
              error instanceof Error ? error.constructor.name : 'Error',
            'exception.message': truncatedMessage,
          });

          if (error instanceof Error && error.stack) {
            span.setAttribute(
              'exception.stack',
              error.stack.slice(0, MAX_ERROR_MESSAGE_LENGTH),
            );
          }

          span.recordException(
            error instanceof Error ? error : new Error(String(error)),
          );

          handleTailSampling(false, duration, error);

          span.end();
          await flushIfNeeded();
          throw error;
        };

        try {
          callCounter?.add(1, {
            operation: spanName,
            status: 'started',
          });

          // Execute the user's function with the updated context
          // This ensures ctx.setBaggage() changes are visible to OpenTelemetry operations
          // (like BaggageSpanProcessor, child spans, etc.)
          // We use getActiveContextWithBaggage() which checks the stored context,
          // so if baggage is set during execution, it will be picked up
          const executeWithContext = async () => {
            // Get the current context (may have been updated by ctx.setBaggage())
            const currentContext = getActiveContextWithBaggage();
            // Establish the context in OpenTelemetry's context manager
            return context.with(currentContext, async () => {
              return fn.call(this, ...args);
            });
          };
          const result = await executeWithContext();

          return await onSuccess(result);
        } catch (error) {
          await onError(error);
          throw error;
        }
      });
    });
  };

  // Mark as instrumented to prevent double-wrapping
  (wrappedFunction as InstrumentedFlag)[INSTRUMENTED_SYMBOL] = true;

  Object.defineProperty(wrappedFunction, 'name', {
    value: tempFn.name || 'trace',
    configurable: true,
  });

  return wrappedFunction;
}

/**
 * Core tracing wrapper for sync functions (internal implementation)
 */
function wrapWithTracingSync<TArgs extends unknown[], TReturn>(
  fnFactory: (ctx: TraceContext) => (...args: TArgs) => TReturn,
  options: TracingOptions<TArgs, TReturn>,
  variableName?: string,
): (...args: TArgs) => TReturn {
  // Idempotency check: if already instrumented, return as-is
  if (hasInstrumentationFlag(fnFactory)) {
    // If already instrumented, we need to extract the original factory
    // For now, we'll just proceed - this edge case is handled by the wrapped function check
  }

  const config = getConfig();
  const tracer = config.tracer;
  const meter = config.meter;
  const sampler = options.sampler || new AlwaysSampler();

  // We need to get a reference function name for span naming
  // Create a minimal dummy context just for extracting the function name
  // This won't affect actual tracing - we use the real context inside the span
  const tempFn = fnFactory(createDummyCtx());
  const spanName = getSpanName(options, tempFn, variableName);

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
    const needsTailSampling =
      'needsTailSampling' in sampler &&
      typeof sampler.needsTailSampling === 'function'
        ? sampler.needsTailSampling()
        : false;

    // If not sampling and no tail sampling, execute without tracing
    if (!shouldSample && !needsTailSampling) {
      const fn = fnFactory(createDummyCtx());
      return fn.call(this, ...args);
    }

    const startTime = performance.now();

    // Track if this is a root span for auto-flush
    const isRootSpan =
      options.startNewRoot || otelTrace.getActiveSpan() === undefined;
    const shouldAutoFlush =
      options.flushOnRootSpanEnd ?? getInitConfig()?.flushOnRootSpanEnd ?? true;
    const shouldAutoFlushSpans = getInitConfig()?.forceFlushOnShutdown ?? false;

    // Note: This is intentionally fire-and-forget (void) for synchronous functions.
    // Synchronous functions cannot await flush completion without blocking execution.
    // The forceFlushOnShutdown guarantee only applies to async functions.
    const flushIfNeeded = () => {
      if (!shouldAutoFlush || !isRootSpan) return;

      // Flush events queue
      const queue = getEventQueue();
      if (queue && queue.size() > 0) {
        void queue.flush().catch((error) => {
          const initConfig = getInitConfig();
          const logger = initConfig?.logger;
          if (logger?.error) {
            if (error instanceof Error) {
              logger.error('[autotel] Auto-flush failed', error);
            } else {
              logger.error(`[autotel] Auto-flush failed: ${String(error)}`);
            }
          }
        });
      }

      // Flush OpenTelemetry spans if enabled
      if (shouldAutoFlushSpans) {
        const sdk = getSdk();
        if (sdk) {
          try {
            // Type assertion needed as getTracerProvider is not in the public NodeSDK interface
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sdkAny = sdk as any;
            if (typeof sdkAny.getTracerProvider === 'function') {
              const tracerProvider = sdkAny.getTracerProvider();
              if (
                tracerProvider &&
                typeof tracerProvider.forceFlush === 'function'
              ) {
                void tracerProvider.forceFlush().catch((error: unknown) => {
                  const initConfig = getInitConfig();
                  const logger = initConfig?.logger;
                  if (logger?.error) {
                    if (error instanceof Error) {
                      logger.error('[autotel] Span flush failed', error);
                    } else {
                      logger.error(
                        `[autotel] Span flush failed: ${String(error)}`,
                      );
                    }
                  }
                });
              }
            }
          } catch {
            // Ignore errors when accessing tracer provider (may not be available in test mocks)
          }
        }
      }
    };

    // Build span options including root and kind
    const spanOptions: import('@opentelemetry/api').SpanOptions = {};
    if (options.startNewRoot) {
      spanOptions.root = true;
    }
    if (options.spanKind !== undefined) {
      spanOptions.kind = options.spanKind;
    }

    return tracer.startActiveSpan(spanName, spanOptions, (span) => {
      // Run within operation context so events can auto-capture operation.name
      return runInOperationContext(spanName, () => {
        let shouldKeepSpan = true;

        // Store span name for trace context helpers
        setSpanName(span, spanName);

        // Create trace context for this span using shared utility
        const ctxValue = createTraceContext(span);

        // Get the actual function from the factory
        const fn = fnFactory(ctxValue);

        // Extract attributes only when actually tracing
        // This avoids expensive preprocessing when sampling rejects the trace
        const argsAttributes = options.attributesFromArgs
          ? options.attributesFromArgs(args)
          : {};

        const handleTailSampling = (
          success: boolean,
          duration: number,
          error?: unknown,
        ) => {
          if (
            needsTailSampling &&
            'shouldKeepTrace' in sampler &&
            typeof sampler.shouldKeepTrace === 'function'
          ) {
            shouldKeepSpan = sampler.shouldKeepTrace(samplingContext, {
              success,
              duration,
              error,
            });
            span.setAttribute('sampling.tail.keep', shouldKeepSpan);
            span.setAttribute('sampling.tail.evaluated', true);
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

          const resultAttributes = options.attributesFromResult
            ? options.attributesFromResult(result)
            : {};

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
          void flushIfNeeded();
          return result;
        };

        const onError = (error: unknown): never => {
          const duration = performance.now() - startTime;

          callCounter?.add(1, {
            operation: spanName,
            status: 'error',
          });

          durationHistogram?.record(duration, {
            operation: spanName,
            status: 'error',
          });

          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          const truncatedMessage = truncateErrorMessage(errorMessage);

          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: truncatedMessage,
          });

          span.setAttributes({
            ...argsAttributes,
            'operation.name': spanName,
            'code.function': spanName,
            'operation.duration': duration,
            'operation.success': false,
            error: true,
            'exception.type':
              error instanceof Error ? error.constructor.name : 'Error',
            'exception.message': truncatedMessage,
          });

          span.recordException(
            error instanceof Error ? error : new Error(String(error)),
          );

          handleTailSampling(false, duration, error);

          span.end();
          void flushIfNeeded();
          throw error;
        };

        try {
          callCounter?.add(1, {
            operation: spanName,
            status: 'started',
          });

          const result = fn.call(this, ...args);

          if (result instanceof Promise) {
            return result.then(onSuccess, onError);
          }

          return onSuccess(result);
        } catch (error) {
          return onError(error);
        }
      });
    });
  }

  // Mark as instrumented to prevent double-wrapping
  (wrappedFunction as InstrumentedFlag)[INSTRUMENTED_SYMBOL] = true;

  // Preserve function name for better debugging
  // Use the same tempFn we created earlier for span naming
  Object.defineProperty(wrappedFunction, 'name', {
    value: tempFn.name || 'trace',
    configurable: true,
  });

  return wrappedFunction as unknown as (...args: TArgs) => TReturn;
}

/**
 * Execute a function immediately within a trace span
 * Used for the immediate execution pattern: trace((ctx) => result)
 */
function executeImmediately<TReturn = unknown>(
  fn: (ctx: TraceContext) => TReturn | Promise<TReturn>,
  options: TracingOptions<unknown[], unknown>,
): TReturn | Promise<TReturn> {
  const config = getConfig();
  const tracer = config.tracer;
  const meter = config.meter;
  const sampler = options.sampler || new AlwaysSampler();

  // Get span name from options or use 'anonymous'
  const spanName = options.name || 'anonymous';

  const samplingContext: SamplingContext = {
    operationName: spanName,
    args: [],
    metadata: {},
  };

  const shouldSample = sampler.shouldSample(samplingContext);
  const needsTailSampling =
    'needsTailSampling' in sampler &&
    typeof sampler.needsTailSampling === 'function'
      ? sampler.needsTailSampling()
      : false;

  if (!shouldSample && !needsTailSampling) {
    return fn(createDummyCtx());
  }

  const startTime = performance.now();
  const isRootSpan =
    options.startNewRoot || otelTrace.getActiveSpan() === undefined;
  const shouldAutoFlush =
    options.flushOnRootSpanEnd ?? getInitConfig()?.flushOnRootSpanEnd ?? true;
  const shouldAutoFlushSpans = getInitConfig()?.forceFlushOnShutdown ?? false;

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

  const flushIfNeeded = async () => {
    if (!shouldAutoFlush || !isRootSpan) return;

    try {
      // Flush events queue
      const queue = getEventQueue();
      if (queue && queue.size() > 0) {
        await queue.flush();
      }

      // Flush OpenTelemetry spans if enabled
      if (shouldAutoFlushSpans) {
        const sdk = getSdk();
        if (sdk) {
          try {
            // Type assertion needed as getTracerProvider is not in the public NodeSDK interface
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sdkAny = sdk as any;
            if (typeof sdkAny.getTracerProvider === 'function') {
              const tracerProvider = sdkAny.getTracerProvider();
              if (
                tracerProvider &&
                typeof tracerProvider.forceFlush === 'function'
              ) {
                await tracerProvider.forceFlush();
              }
            }
          } catch {
            // Ignore errors when accessing tracer provider (may not be available in test mocks)
          }
        }
      }
    } catch (error) {
      const initConfig = getInitConfig();
      const logger = initConfig?.logger;
      if (logger?.error) {
        if (error instanceof Error) {
          logger.error('[autotel] Auto-flush failed', error);
        } else {
          logger.error(`[autotel] Auto-flush failed: ${String(error)}`);
        }
      }
    }
  };

  // Build span options including root and kind
  const spanOptions: import('@opentelemetry/api').SpanOptions = {};
  if (options.startNewRoot) {
    spanOptions.root = true;
  }
  if (options.spanKind !== undefined) {
    spanOptions.kind = options.spanKind;
  }

  return tracer.startActiveSpan(spanName, spanOptions, (span) => {
    return runInOperationContext(spanName, () => {
      let shouldKeepSpan = true;

      setSpanName(span, spanName);
      const ctxValue = createTraceContext(span);

      const handleTailSampling = (
        success: boolean,
        duration: number,
        error?: unknown,
      ) => {
        if (
          needsTailSampling &&
          'shouldKeepTrace' in sampler &&
          typeof sampler.shouldKeepTrace === 'function'
        ) {
          shouldKeepSpan = sampler.shouldKeepTrace(samplingContext, {
            success,
            duration,
            error,
          });
          span.setAttribute('sampling.tail.keep', shouldKeepSpan);
          span.setAttribute('sampling.tail.evaluated', true);
        }
      };

      // Sync handlers for synchronous results (can't await)
      // NOTE: forceFlushOnShutdown will NOT block for synchronous trace() calls
      // Flush is fire-and-forget, so spans may be dropped if process exits immediately
      const onSuccessSync = (result: TReturn) => {
        const duration = performance.now() - startTime;

        callCounter?.add(1, {
          operation: spanName,
          status: 'success',
        });

        durationHistogram?.record(duration, {
          operation: spanName,
          status: 'success',
        });

        span.setStatus({ code: SpanStatusCode.OK });
        span.setAttributes({
          'operation.name': spanName,
          'code.function': spanName,
          'operation.duration': duration,
          'operation.success': true,
        });

        handleTailSampling(true, duration);

        span.end();
        void flushIfNeeded();
        return result;
      };

      const onErrorSync = (error: unknown): never => {
        const duration = performance.now() - startTime;

        callCounter?.add(1, {
          operation: spanName,
          status: 'error',
        });

        durationHistogram?.record(duration, {
          operation: spanName,
          status: 'error',
        });

        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        const truncatedMessage = truncateErrorMessage(errorMessage);

        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: truncatedMessage,
        });

        span.setAttributes({
          'operation.name': spanName,
          'code.function': spanName,
          'operation.duration': duration,
          'operation.success': false,
          error: true,
          'exception.type':
            error instanceof Error ? error.constructor.name : 'Error',
          'exception.message': truncatedMessage,
        });

        if (error instanceof Error && error.stack) {
          span.setAttribute(
            'exception.stack',
            error.stack.slice(0, MAX_ERROR_MESSAGE_LENGTH),
          );
        }

        span.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );

        handleTailSampling(false, duration, error);

        span.end();
        void flushIfNeeded();
        throw error;
      };

      // Async handlers for Promise results (await flush)
      const onSuccessAsync = async (result: TReturn) => {
        const duration = performance.now() - startTime;

        callCounter?.add(1, {
          operation: spanName,
          status: 'success',
        });

        durationHistogram?.record(duration, {
          operation: spanName,
          status: 'success',
        });

        span.setStatus({ code: SpanStatusCode.OK });
        span.setAttributes({
          'operation.name': spanName,
          'code.function': spanName,
          'operation.duration': duration,
          'operation.success': true,
        });

        handleTailSampling(true, duration);

        span.end();
        await flushIfNeeded();
        return result;
      };

      const onErrorAsync = async (error: unknown): Promise<never> => {
        const duration = performance.now() - startTime;

        callCounter?.add(1, {
          operation: spanName,
          status: 'error',
        });

        durationHistogram?.record(duration, {
          operation: spanName,
          status: 'error',
        });

        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        const truncatedMessage = truncateErrorMessage(errorMessage);

        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: truncatedMessage,
        });

        span.setAttributes({
          'operation.name': spanName,
          'code.function': spanName,
          'operation.duration': duration,
          'operation.success': false,
          error: true,
          'exception.type':
            error instanceof Error ? error.constructor.name : 'Error',
          'exception.message': truncatedMessage,
        });

        if (error instanceof Error && error.stack) {
          span.setAttribute(
            'exception.stack',
            error.stack.slice(0, MAX_ERROR_MESSAGE_LENGTH),
          );
        }

        span.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );

        handleTailSampling(false, duration, error);

        span.end();
        await flushIfNeeded();
        throw error;
      };

      try {
        callCounter?.add(1, {
          operation: spanName,
          status: 'started',
        });

        const result = fn(ctxValue);

        // Check if result is a Promise - use async handlers to await flush
        if (result instanceof Promise) {
          return result.then(onSuccessAsync, onErrorAsync);
        }

        // Synchronous result - use sync handlers
        return onSuccessSync(result);
      } catch (error) {
        return onErrorSync(error);
      }
    });
  });
}

/**
 * Approach 1: trace() - Zero-ceremony HOF
 *
 * Wrap a single function with automatic tracing.
 * The function receives a context object as the first parameter.
 *
 * Supports two patterns:
 * 1. **Factory pattern** - Returns a traced function: `trace(ctx => (...args) => result)`
 * 2. **Immediate execution** - Executes immediately with tracing: `trace(ctx => result)`
 *
 * @example Auto-inferred name - Plain function
 * ```typescript
 * export const createUser = trace(async (data) => {
 *   return await db.users.create(data)
 * })
 * // → Traced as "createUser"
 * ```
 *
 * @example Auto-inferred name - Factory pattern (with ctx access)
 * ```typescript
 * export const createUser = trace(ctx => async (data) => {
 *   ctx.setAttribute('user.id', data.id)
 *   return await db.users.create(data)
 * })
 * // → Traced as "createUser", returns wrapped function
 * ```
 *
 * @example Immediate execution - Execute once with tracing
 * ```typescript
 * // Wraps an existing function and executes immediately
 * function timed<T>(fn: () => Promise<T>): Promise<T> {
 *   return trace(async (ctx) => {
 *     ctx.setAttribute('operation', 'timed')
 *     return await fn()
 *   })
 * }
 * // → Executes immediately, returns result directly
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
 * @example Custom name - Factory pattern
 * ```typescript
 * export const createUser = trace('user.create', ctx => async (data) => {
 *   ctx.setAttribute('user.id', data.id)
 *   return await db.users.create(data)
 * })
 * // → Traced as "user.create"
 * ```
 *
 * @example Custom name - Immediate execution
 * ```typescript
 * const result = trace('fetch.user', async (ctx) => {
 *   ctx.setAttribute('userId', '123')
 *   return await fetchUser('123')
 * })
 * // → Executes immediately with span name "fetch.user"
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
 * @example Full options - Factory pattern
 * ```typescript
 * export const createUser = trace({
 *   name: 'user.create',
 *   sampler: new AdaptiveSampler(),
 *   withMetrics: true
 * }, ctx => async (data) => {
 *   ctx.setAttribute('user.id', data.id)
 *   return await db.users.create(data)
 * })
 * ```
 */
// Sync overloads - Ordered from most specific to most generic for better type inference

// Single argument - Specific overloads with TraceContext first
// Overload 1a: Immediate execution - sync function with context
export function trace<
  TBaggage extends Record<string, unknown> | undefined = undefined,
  TReturn = unknown,
>(fn: (ctx: TraceContext<TBaggage>) => TReturn): TReturn;
// Overload 1b: Factory sync function with no args - non-generic for type inference
export function trace<
  TBaggage extends Record<string, unknown> | undefined = undefined,
>(fnFactory: (ctx: TraceContext<TBaggage>) => () => unknown): () => unknown;
// Overload 1c: Factory sync function - non-generic for type inference
export function trace<
  TBaggage extends Record<string, unknown> | undefined = undefined,
  TArgs extends unknown[] = unknown[],
  TReturn = unknown,
>(
  fnFactory: (ctx: TraceContext<TBaggage>) => (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;
// Overload 1d: Factory sync function with no args returning explicit type (typed generic)
export function trace<TReturn = unknown>(
  fnFactory: (ctx: TraceContext) => () => TReturn,
): () => TReturn;
// Overload 1e: Factory sync function - use conditional type to extract signature
// This overload is more specific and helps TypeScript infer types from factory functions
export function trace<
  TFactory extends (ctx: TraceContext) => (...args: unknown[]) => unknown,
>(fnFactory: TFactory): ExtractFunctionSignature<TFactory>;
// Overload 1f: Generic factory sync function (fallback)
export function trace<TArgs extends unknown[], TReturn = unknown>(
  fnFactory: (ctx: TraceContext) => (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;

// Single argument - Plain function overloads (no ctx parameter)
// Overload 1g: Plain sync function with no args
export function trace<TReturn = unknown>(fn: () => TReturn): () => TReturn;
// Overload 1h: Plain sync function (generic fallback)
export function trace<TArgs extends unknown[], TReturn = unknown>(
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;

// Two arguments - name + function - Specific overloads with TraceContext first
// Overload 2a: Name + immediate execution sync with context
// This overload only matches functions that DON'T return functions (factories)
export function trace<TReturn = unknown>(
  name: string,
  fn: ExcludeFactoryReturn<(ctx: TraceContext) => TReturn>,
): TReturn;
// Overload 2b: Name + factory sync function with no args
export function trace<TReturn = unknown>(
  name: string,
  fnFactory: (ctx: TraceContext) => () => TReturn,
): () => TReturn;
// Overload 2c: Name + factory sync function - non-generic for type inference
export function trace<TArgs extends unknown[], TReturn>(
  name: string,
  fnFactory: (ctx: TraceContext) => (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;
// Overload 2d: Name + factory sync function - use conditional type to extract signature
// This overload allows TypeScript to infer types from the factory function parameter
export function trace<
  TFactory extends (ctx: TraceContext) => (...args: unknown[]) => unknown,
>(name: string, fnFactory: TFactory): ExtractFunctionSignature<TFactory>;
// Overload 2e: Name + factory sync function (fallback)
export function trace<TArgs extends unknown[] = unknown[], TReturn = unknown>(
  name: string,
  fnFactory: (ctx: TraceContext) => (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;

// Two arguments - name + function - Plain function overloads
// Overload 2f: Name + plain sync function
export function trace<TArgs extends unknown[] = unknown[], TReturn = unknown>(
  name: string,
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;

// Two arguments - options + function - Specific overloads with TraceContext first
// Overload 3a: Options + immediate execution sync with context
export function trace<TReturn = unknown>(
  options: TracingOptions<[], TReturn>,
  fn: (ctx: TraceContext) => TReturn,
): TReturn;
// Overload 3b: Options + factory sync function with no args
export function trace<TReturn = unknown>(
  options: TracingOptions<[], TReturn>,
  fnFactory: (ctx: TraceContext) => () => TReturn,
): () => TReturn;
// Overload 3c: Options + factory sync function - non-generic for type inference
export function trace<TArgs extends unknown[], TReturn>(
  options: TracingOptions<TArgs, TReturn>,
  fnFactory: (ctx: TraceContext) => (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;
// Overload 3d: Options + factory sync function (fallback)
export function trace<TArgs extends unknown[] = unknown[], TReturn = unknown>(
  options: TracingOptions<TArgs, TReturn>,
  fnFactory: (ctx: TraceContext) => (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;

// Two arguments - options + function - Plain function overloads
// Overload 3e: Options + plain sync function
export function trace<TArgs extends unknown[] = unknown[], TReturn = unknown>(
  options: TracingOptions<TArgs, TReturn>,
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;

// Async overloads - Ordered from most specific to most generic

// Single argument - Specific async overloads with TraceContext first
// Overload 4a: Immediate execution - async function with context
export function trace<TReturn = unknown>(
  fn: (ctx: TraceContext) => Promise<TReturn>,
): Promise<TReturn>;
// Overload 4b: Factory async function with no args - non-generic for type inference
export function trace(
  fnFactory: (ctx: TraceContext) => () => Promise<unknown>,
): () => Promise<unknown>;
// Overload 4c: Factory async function - non-generic for type inference
export function trace<TArgs extends unknown[], TReturn>(
  fnFactory: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn>;
// Overload 4d: Factory async function with no args (typed generic)
export function trace<TReturn = unknown>(
  fnFactory: (ctx: TraceContext) => () => Promise<TReturn>,
): () => Promise<TReturn>;
// Overload 4e: Factory async function - use conditional type to extract signature
export function trace<
  TFactory extends (
    ctx: TraceContext,
  ) => (...args: unknown[]) => Promise<unknown>,
>(fnFactory: TFactory): ExtractFunctionSignature<TFactory>;
// Overload 4f: Generic factory async function (fallback)
export function trace<TArgs extends unknown[] = unknown[], TReturn = unknown>(
  fnFactory: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn>;

// Single argument - Plain async function overloads (no ctx parameter)
// Overload 4g: Plain async function with no args
export function trace<TReturn = unknown>(
  fn: () => Promise<TReturn>,
): () => Promise<TReturn>;
// Overload 4h: Plain async function (generic fallback)
export function trace<TArgs extends unknown[] = unknown[], TReturn = unknown>(
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn>;

// Two arguments - name + async function - Specific overloads with TraceContext first
// Overload 5a: Name + immediate execution async with context
// This overload only matches functions that DON'T return functions (factories)
export function trace<TReturn = unknown>(
  name: string,
  fn: ExcludeFactoryReturn<(ctx: TraceContext) => Promise<TReturn>>,
): Promise<TReturn>;
// Overload 5b: Name + factory async function with no args
export function trace<TReturn = unknown>(
  name: string,
  fnFactory: (ctx: TraceContext) => () => Promise<TReturn>,
): () => Promise<TReturn>;
// Overload 5c: Name + factory async function - non-generic for type inference
export function trace<TArgs extends unknown[], TReturn>(
  name: string,
  fnFactory: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn>;
// Overload 5d: Name + factory async function - use conditional type to extract signature
// This overload allows TypeScript to infer types from the factory function parameter
export function trace<
  TFactory extends (
    ctx: TraceContext,
  ) => (...args: unknown[]) => Promise<unknown>,
>(name: string, fnFactory: TFactory): ExtractFunctionSignature<TFactory>;
// Overload 5e: Name + factory async function (fallback)
export function trace<TArgs extends unknown[] = unknown[], TReturn = unknown>(
  name: string,
  fnFactory: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn>;

// Two arguments - name + async function - Plain function overloads
// Overload 5f: Name + plain async function
export function trace<TArgs extends unknown[] = unknown[], TReturn = unknown>(
  name: string,
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn>;

// Two arguments - options + async function - Specific overloads with TraceContext first
// Overload 6a: Options + immediate execution async with context
export function trace<TReturn = unknown>(
  options: TracingOptions<[], TReturn>,
  fn: (ctx: TraceContext) => Promise<TReturn>,
): Promise<TReturn>;
// Overload 6b: Options + factory async function with no args
export function trace<TReturn = unknown>(
  options: TracingOptions<[], TReturn>,
  fnFactory: (ctx: TraceContext) => () => Promise<TReturn>,
): () => Promise<TReturn>;
// Overload 6c: Options + factory async function - non-generic for type inference
export function trace<TArgs extends unknown[], TReturn>(
  options: TracingOptions<TArgs, TReturn>,
  fnFactory: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn>;
// Overload 6d: Options + factory async function (fallback)
export function trace<TArgs extends unknown[] = unknown[], TReturn = unknown>(
  options: TracingOptions<TArgs, TReturn>,
  fnFactory: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn>;

// Two arguments - options + async function - Plain function overloads
// Overload 6e: Options + plain async function
export function trace<TArgs extends unknown[] = unknown[], TReturn = unknown>(
  options: TracingOptions<TArgs, TReturn>,
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn>;

// Implementation
export function trace<TArgs extends unknown[] = unknown[], TReturn = unknown>(
  fnOrNameOrOptions:
    | ((...args: TArgs) => TReturn)
    | ((...args: TArgs) => Promise<TReturn>)
    | ((ctx: TraceContext) => (...args: TArgs) => TReturn)
    | ((ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>)
    | ((ctx: TraceContext) => TReturn)
    | ((ctx: TraceContext) => Promise<TReturn>)
    | string
    | TracingOptions<TArgs, TReturn>,
  maybeFn?:
    | ((...args: TArgs) => TReturn)
    | ((...args: TArgs) => Promise<TReturn>)
    | ((ctx: TraceContext) => (...args: TArgs) => TReturn)
    | ((ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>)
    | ((ctx: TraceContext) => TReturn)
    | ((ctx: TraceContext) => Promise<TReturn>),
): WrappedFunction<TArgs, TReturn> | TReturn | Promise<TReturn> {
  // Handle: trace(fn) - single argument
  if (typeof fnOrNameOrOptions === 'function') {
    // Check if it's immediate execution pattern: (ctx) => result
    if (
      looksLikeTraceFactory(fnOrNameOrOptions as GenericFunction) &&
      !isFactoryReturningFunction(
        fnOrNameOrOptions as (ctx: TraceContext) => unknown,
      )
    ) {
      // Immediate execution pattern
      return executeImmediately(
        fnOrNameOrOptions as (ctx: TraceContext) => TReturn | Promise<TReturn>,
        {},
      ) as WrappedFunction<TArgs, TReturn> | TReturn | Promise<TReturn>;
    }
    // Factory pattern or plain function
    return wrapFactoryWithTracing(
      fnOrNameOrOptions as (...args: TArgs) => TReturn,
      {} as TracingOptions<TArgs, TReturn>,
    );
  }

  // Handle: trace(name, fn) or trace(options, fn) - two arguments
  if (typeof fnOrNameOrOptions === 'string') {
    if (!maybeFn) {
      throw new Error('trace(name, fn): fn is required');
    }
    // Check if it's immediate execution pattern
    if (
      looksLikeTraceFactory(maybeFn as GenericFunction) &&
      !isFactoryReturningFunction(maybeFn as (ctx: TraceContext) => unknown)
    ) {
      // Immediate execution pattern with name
      return executeImmediately(
        maybeFn as (ctx: TraceContext) => TReturn | Promise<TReturn>,
        { name: fnOrNameOrOptions },
      ) as WrappedFunction<TArgs, TReturn> | TReturn | Promise<TReturn>;
    }
    return wrapFactoryWithTracing(
      maybeFn as (...args: TArgs) => TReturn,
      { name: fnOrNameOrOptions } as TracingOptions<TArgs, TReturn>,
    );
  }

  // Handle: trace(options, fn)
  if (!maybeFn) {
    throw new Error('trace(options, fn): fn is required');
  }

  // Check if it's immediate execution pattern
  if (
    looksLikeTraceFactory(maybeFn as GenericFunction) &&
    !isFactoryReturningFunction(maybeFn as (ctx: TraceContext) => unknown)
  ) {
    // Immediate execution pattern with options
    return executeImmediately(
      maybeFn as (ctx: TraceContext) => TReturn | Promise<TReturn>,
      fnOrNameOrOptions as TracingOptions<unknown[], unknown>,
    ) as WrappedFunction<TArgs, TReturn> | TReturn | Promise<TReturn>;
  }

  return wrapFactoryWithTracing(
    maybeFn as (...args: TArgs) => TReturn,
    fnOrNameOrOptions as TracingOptions<TArgs, TReturn>,
  );
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
 * const trace = withTracing({ serviceName: 'user' })
 *
 * export const createUser = trace(ctx => async (data) => { })
 * export const updateUser = trace(ctx => async (id, data) => { })
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
  TArgs extends unknown[] = unknown[],
  TReturn = unknown,
>(
  options: TracingOptions<TArgs, TReturn> = {},
): (
  fnFactory: (
    ctx: TraceContext,
  ) => (...args: TArgs) => TReturn | Promise<TReturn>,
) => (...args: TArgs) => TReturn | Promise<TReturn> {
  return (
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
export function instrument<T extends Record<string, InstrumentableFunction>>(
  options: InstrumentOptions<T>,
): T {
  const { functions, ...tracingOptions } = options;
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
    ) as T[typeof typedKey];
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
}

/**
 * Execute a function within a named span
 *
 * Useful for adding tracing to specific code blocks without wrapping
 * the entire function. Supports both synchronous and asynchronous functions.
 *
 * @example
 * ```typescript
 * // Async function
 * async function processOrder(order: Order) {
 *   await span({
 *     name: 'payment.charge',
 *     attributes: { amount: order.total }
 *   }, async (span) => {
 *     await chargeCustomer(order);
 *   })
 * }
 *
 * // Sync function
 * function calculateTotal(items: Item[]) {
 *   return span({
 *     name: 'calculateTotal',
 *     attributes: { itemCount: items.length }
 *   }, (span) => {
 *     return items.reduce((sum, item) => sum + item.price, 0);
 *   })
 * }
 * ```
 */
// Overload for sync functions (more specific - should come first)
export function span<T = unknown>(
  options: SpanOptions,
  fn: (span: Span) => T,
): T;
// Overload for async functions
export function span<T = unknown>(
  options: SpanOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T>;
// Implementation
export function span<T = unknown>(
  options: SpanOptions,
  fn: (span: Span) => T | Promise<T>,
): T | Promise<T> {
  const config = getConfig();
  const tracer = config.tracer;
  const { name, attributes } = options;

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

  const result = tracer.startActiveSpan(name, executeSpan);

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
 *       await trace(ctx => async () => {
 *         await processWebhookPayload(payload)
 *       })()
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
 * import { trace, withBaggage } from 'autotel';
 *
 * export const createOrder = trace((ctx) => async (order: Order) => {
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
 * export const processOrder = trace((ctx) => async (order: Order) => {
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

  // Run the function within the new context
  return context.with(newContext, fn);
}
