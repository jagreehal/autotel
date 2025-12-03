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
import type { Sampler } from '@opentelemetry/sdk-trace-base';
import type { TraceContext } from './core/trace-context';
import { createTraceContext, setSpanName } from './core/trace-context';

// Re-export for convenience
export type { TraceContext } from './core/trace-context';

type AnyFn = (...args: any[]) => any;

const TRACE_FACTORY_SYMBOL = Symbol.for('autotel.edge.functional.factory');
const FACTORY_NAME_HINTS = new Set(['ctx', '_ctx', 'context', 'tracecontext', 'tracectx']);

const SINGLE_LINE_COMMENT_REGEX = /\/\/.*$/gm;
const MULTI_LINE_COMMENT_REGEX = /\/\*[\s\S]*?\*\//gm;
const PARAM_TOKEN_SANITIZE_REGEX = new RegExp(String.raw`[{}\[\]\s]`, 'g');

interface TraceFactoryMarked {
  [TRACE_FACTORY_SYMBOL]?: true;
}

function markAsTraceFactory(fn: AnyFn): void {
  try {
    Object.defineProperty(fn, TRACE_FACTORY_SYMBOL, {
      value: true,
      configurable: true,
    });
  } catch {
    (fn as TraceFactoryMarked)[TRACE_FACTORY_SYMBOL] = true;
  }
}

function hasFactoryMark(fn: AnyFn): boolean {
  return Boolean((fn as TraceFactoryMarked)[TRACE_FACTORY_SYMBOL]);
}

function sanitizeParameterToken(token: string): string {
  const [firstToken] = token.split('=');
  return (firstToken ?? '').replaceAll(PARAM_TOKEN_SANITIZE_REGEX, '').trim();
}

function getFirstParameterToken(fn: AnyFn): string | null {
  let source = Function.prototype.toString.call(fn);
  source = source
    .replaceAll(MULTI_LINE_COMMENT_REGEX, '')
    .replaceAll(SINGLE_LINE_COMMENT_REGEX, '')
    .trim();

  const arrowMatch = source.match(/^(?:async\s*)?(?:\(([^)]*)\)|([^=()]+))\s*=>/);
  if (arrowMatch) {
    const params = (arrowMatch[1] ?? arrowMatch[2] ?? '').split(',');
    const first = params[0]?.trim();
    if (first) {
      return sanitizeParameterToken(first);
    }
    return null;
  }

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

function looksLikeTraceFactory(fn: AnyFn): boolean {
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
    normalized.startsWith('trace')
  ) {
    return true;
  }

  return false;
}

/**
 * Check if a function that takes ctx returns another function (factory pattern)
 * vs returning a value directly (immediate execution pattern)
 */
function isFactoryReturningFunction(
  fnWithCtx: (ctx: TraceContext) => unknown,
): boolean {
  try {
    const result = fnWithCtx(createDummyCtx());
    return typeof result === 'function';
  } catch {
    // If the function throws when called with dummy ctx, assume it's immediate execution
    // since factory functions typically just return a function and don't execute logic
    return false;
  }
}

function isTraceFactoryFunction<TArgs extends any[], TReturn>(
  fn:
    | ((...args: TArgs) => TReturn | Promise<TReturn>)
    | ((ctx: TraceContext) => (...args: TArgs) => TReturn | Promise<TReturn>),
): fn is (ctx: TraceContext) => (...args: TArgs) => TReturn | Promise<TReturn> {
  if (typeof fn !== 'function') {
    return false;
  }

  if (hasFactoryMark(fn as AnyFn)) {
    return true;
  }

  if (looksLikeTraceFactory(fn as AnyFn)) {
    markAsTraceFactory(fn as AnyFn);
    return true;
  }

  return false;
}

function ensureTraceFactory<TArgs extends any[], TReturn>(
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

type ExtractFunctionSignature<T> = T extends (ctx: TraceContext) => infer F
  ? F extends (...args: infer Args) => infer Return
    ? (...args: Args) => Return
    : never
  : never;

type WrappedFunction<TArgs extends any[], TReturn> = (...args: TArgs) => TReturn | Promise<TReturn>;

/**
 * trace function options
 */
export interface traceOptions<TArgs extends any[] = any[], TReturn = any> {
  name?: string;
  serviceName?: string;
  sampler?: Sampler;
  attributesFromArgs?: (args: TArgs) => Record<string, unknown>;
  attributesFromResult?: (result: TReturn) => Record<string, unknown>;
  attributes?: Record<string, unknown>;
}

const MAX_ERROR_MESSAGE_LENGTH = 500;

function createDummyCtx(): TraceContext {
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

function isAsyncFunction(fn: unknown): boolean {
  return typeof fn === 'function' && fn.constructor?.name === 'AsyncFunction';
}

const INSTRUMENTED_SYMBOL = Symbol.for('autotel.edge.functional.instrumented');

function wrapWithTracingAsync<TArgs extends any[], TReturn>(
  fnFactory: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
  options: traceOptions<TArgs, TReturn>,
  variableName?: string,
): (...args: TArgs) => Promise<TReturn> {
  const tempFn = fnFactory(createDummyCtx());
  const spanName = getSpanName(options, tempFn, variableName);

  const wrappedFunction = async function wrappedFunction(this: unknown, ...args: TArgs): Promise<TReturn> {
    const tracer = otelTrace.getTracer('autotel-edge');
    const spanOptions: Record<string, unknown> = options.sampler ? { sampler: options.sampler } : {};

    return tracer.startActiveSpan(spanName, spanOptions, async (span) => {
      setSpanName(span, spanName);

      try {
        const actualFn = fnFactory(createTraceContext(span));

        if (options.attributes) {
          span.setAttributes(options.attributes as Record<string, AttributeValue>);
        }

        if (options.attributesFromArgs) {
          const argsAttrs = options.attributesFromArgs(args);
          span.setAttributes(argsAttrs as Record<string, AttributeValue>);
        }

        const result = await actualFn(...args);

        if (options.attributesFromResult) {
          const resultAttrs = options.attributesFromResult(result);
          span.setAttributes(resultAttrs as Record<string, AttributeValue>);
        }

        span.setAttribute('code.function', spanName);
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return result;
      } catch (error) {
        const message = truncateErrorMessage(
          error instanceof Error ? error.message : String(error ?? 'Unknown error'),
        );
        span.setAttribute('code.function', spanName);
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.end();
        throw error;
      }
    });
  };

  Object.defineProperty(wrappedFunction, 'name', {
    value: tempFn.name || 'trace',
    configurable: true,
  });

  (wrappedFunction as any)[INSTRUMENTED_SYMBOL] = true;

  return wrappedFunction;
}

function wrapWithTracingSync<TArgs extends any[], TReturn>(
  fnFactory: (ctx: TraceContext) => (...args: TArgs) => TReturn,
  options: traceOptions<TArgs, TReturn>,
  variableName?: string,
): (...args: TArgs) => TReturn {
  const tempFn = fnFactory(createDummyCtx());
  const spanName = getSpanName(options, tempFn, variableName);

  const wrappedFunction = function wrappedFunction(this: unknown, ...args: TArgs): TReturn {
    const tracer = otelTrace.getTracer('autotel-edge');
    const spanOptions: Record<string, unknown> = options.sampler ? { sampler: options.sampler } : {};

    return tracer.startActiveSpan(spanName, spanOptions, (span) => {
      setSpanName(span, spanName);

      try {
        const actualFn = fnFactory(createTraceContext(span));

        if (options.attributes) {
          span.setAttributes(options.attributes as Record<string, AttributeValue>);
        }

        if (options.attributesFromArgs) {
          const argsAttrs = options.attributesFromArgs(args);
          span.setAttributes(argsAttrs as Record<string, AttributeValue>);
        }

        const result = actualFn(...args);

        if (options.attributesFromResult) {
          const resultAttrs = options.attributesFromResult(result as TReturn);
          span.setAttributes(resultAttrs as Record<string, AttributeValue>);
        }

        span.setAttribute('code.function', spanName);
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return result;
      } catch (error) {
        const message = truncateErrorMessage(
          error instanceof Error ? error.message : String(error ?? 'Unknown error'),
        );
        span.setAttribute('code.function', spanName);
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.end();
        throw error;
      }
    });
  };

  Object.defineProperty(wrappedFunction, 'name', {
    value: tempFn.name || 'trace',
    configurable: true,
  });

  (wrappedFunction as any)[INSTRUMENTED_SYMBOL] = true;

  return wrappedFunction;
}

function wrapFactoryWithTracing<TArgs extends any[], TReturn>(
  fnOrFactory:
    | ((...args: TArgs) => TReturn | Promise<TReturn>)
    | ((ctx: TraceContext) => (...args: TArgs) => TReturn | Promise<TReturn>),
  options: traceOptions<TArgs, TReturn>,
  variableName?: string,
): WrappedFunction<TArgs, TReturn> {
  const factory = ensureTraceFactory(fnOrFactory);
  const sampleFn = factory(createDummyCtx());
  const useAsyncWrapper = isAsyncFunction(sampleFn);

  if (useAsyncWrapper) {
    return wrapWithTracingAsync(
      factory as (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
      options,
      variableName,
    ) as WrappedFunction<TArgs, TReturn>;
  }

  return wrapWithTracingSync(
    factory as (ctx: TraceContext) => (...args: TArgs) => TReturn,
    options,
    variableName,
  ) as WrappedFunction<TArgs, TReturn>;
}

/**
 * Execute a function immediately within a trace span
 * Used for the immediate execution pattern: trace((ctx) => result)
 */
function executeImmediately<TReturn = any>(
  fn: (ctx: TraceContext) => TReturn | Promise<TReturn>,
  options: traceOptions<any[], any>,
): TReturn | Promise<TReturn> {
  const tracer = otelTrace.getTracer('@autotel/edge');
  const spanName = options.name || 'anonymous';

  return tracer.startActiveSpan(spanName, (span) => {
    try {
      setSpanName(span, spanName);
      const ctxValue = createTraceContext(span);

      const onSuccess = (result: TReturn) => {
        span.setStatus({ code: SpanStatusCode.OK });
        if (options.attributes) {
          for (const [key, value] of Object.entries(options.attributes)) {
            span.setAttribute(key, value as AttributeValue);
          }
        }
        span.end();
        return result;
      };

      const onError = (error: unknown): never => {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        const truncatedMessage = truncateErrorMessage(errorMessage);

        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: truncatedMessage,
        });

        span.setAttribute('error', true);
        span.setAttribute('exception.type',
          error instanceof Error ? error.constructor.name : 'Error');
        span.setAttribute('exception.message', truncatedMessage);

        span.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );

        span.end();
        throw error;
      };

      const result = fn(ctxValue);

      // Check if result is a Promise
      if (result instanceof Promise) {
        return result.then(onSuccess, onError);
      }

      return onSuccess(result);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const truncatedMessage = truncateErrorMessage(errorMessage);

      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: truncatedMessage,
      });

      span.setAttribute('error', true);
      span.setAttribute('exception.message', truncatedMessage);

      span.recordException(
        error instanceof Error ? error : new Error(String(error)),
      );

      span.end();
      throw error;
    }
  });
}

// Sync overloads - Factory pattern with explicit return type helps TypeScript infer
// Overload 1a: Plain sync function with no args (auto-inferred name)
export function trace<TReturn = any>(
  fn: () => TReturn,
): () => TReturn;
// Overload 1b: Plain sync function (auto-inferred name)
export function trace<TArgs extends any[], TReturn = any>(
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;

// Overload 1c: Factory sync function with no args returning explicit type (auto-inferred name)
export function trace<TReturn = any>(
  fnFactory: (ctx: TraceContext) => () => TReturn,
): () => TReturn;
// Overload 1d: Immediate execution - sync function with context (NEW PATTERN)
export function trace<TReturn = any>(
  fn: (ctx: TraceContext) => TReturn,
): TReturn;
// Overload 1e: Factory sync function - use conditional type to extract signature (MUST come before generic)
// This overload is more specific and helps TypeScript infer types from factory functions
export function trace<TFactory extends (ctx: TraceContext) => (...args: any[]) => any>(
  fnFactory: TFactory,
): ExtractFunctionSignature<TFactory>;
// Overload 1f: Generic factory sync function (fallback)
export function trace<TArgs extends any[], TReturn = any>(
  fnFactory: (ctx: TraceContext) => (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;

// Overload 2a: Name + plain sync function
export function trace<TArgs extends any[] = any[], TReturn = any>(
  name: string,
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;

// Overload 2b: Name + immediate execution sync with context
export function trace<TReturn = any>(
  name: string,
  fn: (ctx: TraceContext) => TReturn,
): TReturn;

// Overload 2c: Name + factory sync function
export function trace<TArgs extends any[] = any[], TReturn = any>(
  name: string,
  fnFactory: (ctx: TraceContext) => (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;

// Overload 3a: Options + plain sync function
export function trace<TArgs extends any[] = any[], TReturn = any>(
  options: traceOptions<TArgs, TReturn>,
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;

// Overload 3b: Options + immediate execution sync with context
export function trace<TReturn = any>(
  options: traceOptions<[], TReturn>,
  fn: (ctx: TraceContext) => TReturn,
): TReturn;

// Overload 3c: Options + factory sync function
export function trace<TArgs extends any[] = any[], TReturn = any>(
  options: traceOptions<TArgs, TReturn>,
  fnFactory: (ctx: TraceContext) => (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;

// Async overloads
// Overload 4a: Plain async function with no args (auto-inferred name)
export function trace<TReturn = any>(
  fn: () => Promise<TReturn>,
): () => Promise<TReturn>;
// Overload 4b: Plain async function (auto-inferred name)
export function trace<TArgs extends any[] = any[], TReturn = any>(
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn>;

// Overload 4c: Immediate execution - async function with context (NEW PATTERN)
export function trace<TReturn = any>(
  fn: (ctx: TraceContext) => Promise<TReturn>,
): Promise<TReturn>;
// Overload 4d: Factory async function with no args (auto-inferred name)
export function trace<TReturn = any>(
  fnFactory: (ctx: TraceContext) => () => Promise<TReturn>,
): () => Promise<TReturn>;
// Overload 4e: Factory async function (auto-inferred name)
export function trace<TArgs extends any[] = any[], TReturn = any>(
  fnFactory: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn>;

// Overload 5a: Name + plain async function
export function trace<TArgs extends any[] = any[], TReturn = any>(
  name: string,
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn>;

// Overload 5b: Name + immediate execution async with context
export function trace<TReturn = any>(
  name: string,
  fn: (ctx: TraceContext) => Promise<TReturn>,
): Promise<TReturn>;

// Overload 5c: Name + factory async function
export function trace<TArgs extends any[] = any[], TReturn = any>(
  name: string,
  fnFactory: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn>;

// Overload 6a: Options + plain async function
export function trace<TArgs extends any[] = any[], TReturn = any>(
  options: traceOptions<TArgs, TReturn>,
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn>;

// Overload 6b: Options + immediate execution async with context
export function trace<TReturn = any>(
  options: traceOptions<[], TReturn>,
  fn: (ctx: TraceContext) => Promise<TReturn>,
): Promise<TReturn>;

// Overload 6c: Options + factory async function
export function trace<TArgs extends any[] = any[], TReturn = any>(
  options: traceOptions<TArgs, TReturn>,
  fnFactory: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn>;

// Implementation
export function trace<TArgs extends any[] = any[], TReturn = any>(
  fnOrNameOrOptions:
    | ((...args: TArgs) => TReturn)
    | ((...args: TArgs) => Promise<TReturn>)
    | ((ctx: TraceContext) => (...args: TArgs) => TReturn)
    | ((ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>)
    | ((ctx: TraceContext) => TReturn)
    | ((ctx: TraceContext) => Promise<TReturn>)
    | string
    | traceOptions<TArgs, TReturn>,
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
      looksLikeTraceFactory(fnOrNameOrOptions as AnyFn) &&
      !isFactoryReturningFunction(fnOrNameOrOptions as (ctx: TraceContext) => unknown)
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
      {} as traceOptions<TArgs, TReturn>,
    );
  }

  // Handle: trace(name, fn) or trace(options, fn) - two arguments
  if (typeof fnOrNameOrOptions === 'string') {
    if (!maybeFn) {
      throw new Error('trace(name, fn): fn is required');
    }
    // Check if it's immediate execution pattern
    if (
      looksLikeTraceFactory(maybeFn as AnyFn) &&
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
      { name: fnOrNameOrOptions } as traceOptions<TArgs, TReturn>,
    );
  }

  // Handle: trace(options, fn)
  if (!maybeFn) {
    throw new Error('trace(options, fn): fn is required');
  }

  // Check if it's immediate execution pattern
  if (
    looksLikeTraceFactory(maybeFn as AnyFn) &&
    !isFactoryReturningFunction(maybeFn as (ctx: TraceContext) => unknown)
  ) {
    // Immediate execution pattern with options
    return executeImmediately(
      maybeFn as (ctx: TraceContext) => TReturn | Promise<TReturn>,
      fnOrNameOrOptions as traceOptions<any[], any>,
    ) as WrappedFunction<TArgs, TReturn> | TReturn | Promise<TReturn>;
  }

  return wrapFactoryWithTracing(
    maybeFn as (...args: TArgs) => TReturn,
    fnOrNameOrOptions as traceOptions<TArgs, TReturn>,
  );
}

export function withTracing<TArgs extends any[] = any[], TReturn = any>(
  options: Omit<traceOptions<TArgs, TReturn>, 'name'>,
) {
  return (
    fnOrFactory:
      | ((...args: TArgs) => TReturn | Promise<TReturn>)
      | ((ctx: TraceContext) => (...args: TArgs) => TReturn | Promise<TReturn>)
  ): WrappedFunction<TArgs, TReturn> => wrapFactoryWithTracing(fnOrFactory, options as traceOptions<TArgs, TReturn>);
}

function shouldSkip(key: string, fn: Function, skip?: (string | RegExp | ((key: string, fn: Function) => boolean))[]): boolean {
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

export interface InstrumentOptions extends traceOptions {
  functions: Record<string, any>;
  overrides?: Record<string, Partial<traceOptions>>;
  skip?: (string | RegExp | ((key: string, fn: Function) => boolean))[];
}

export function instrument<T extends Record<string, any>>(
  options: InstrumentOptions,
): T {
  const { functions, ...tracingOptions } = options;
  const instrumented: Record<string, any> = {};

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

    const boundFn = fn.bind(functions);
    const fnFactory = (_ctx: TraceContext) => boundFn as AnyFn;

    instrumented[key] = wrapFactoryWithTracing(fnFactory, fnOptions, key);
  }

  return instrumented as T;
}

export interface SpanOptions {
  name: string;
  attributes?: Record<string, string | number | boolean>;
}

export function span<T = unknown>(options: SpanOptions, fn: (span: Span) => T): T;
export function span<T = unknown>(
  options: SpanOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T>;
export function span<T = unknown>(
  options: SpanOptions,
  fn: (span: Span) => T | Promise<T>,
): T | Promise<T> {
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
              error instanceof Error ? error.message : String(error ?? 'Unknown error'),
            );
            span.setAttribute('code.function', options.name);
            span.setStatus({ code: SpanStatusCode.ERROR, message });
            span.recordException(error instanceof Error ? error : new Error(String(error)));
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
        error instanceof Error ? error.message : String(error ?? 'Unknown error'),
      );
      span.setAttribute('code.function', options.name);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.end();
      throw error;
    }
  };

  const result = tracer.startActiveSpan(options.name, execute);

  if (result instanceof Promise) {
    return result;
  }

  return result as T;
}

