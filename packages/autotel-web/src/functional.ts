/**
 * Minimal functional API for browser tracing
 *
 * These are DX wrappers that DON'T create real browser spans.
 * The real spans and timing happen on the backend via Autotel.
 *
 * The browser's job is just to propagate trace context via headers.
 */

import { createTraceparent, parseTraceparent } from './traceparent';

/**
 * Minimal trace context (browser-side)
 *
 * This is a lightweight version that just holds IDs.
 * NO actual span object - the real span lives on the backend.
 */
export interface TraceContext {
  /** Current trace ID (may be extracted from request) */
  readonly traceId: string;
  /** Current span ID (generated for this browser "span") */
  readonly spanId: string;
  /** Correlation ID (same as trace ID) */
  readonly correlationId: string;
}

// Store current trace context (if any)
let currentContext: TraceContext | undefined;

/**
 * Wrap a function with trace() for better DX
 *
 * **Important:** This does NOT create real spans in the browser.
 * It's purely for API consistency. The real tracing happens on the backend.
 *
 * The traceparent header is automatically injected by init() on fetch/XHR calls.
 *
 * @example Basic usage
 * ```typescript
 * const fetchUser = trace(async (id: string) => {
 *   const response = await fetch(`/api/users/${id}`)
 *   return response.json()
 * })
 * ```
 *
 * @example With context (for accessing trace IDs)
 * ```typescript
 * const fetchUser = trace(ctx => async (id: string) => {
 *   console.log('Trace ID:', ctx.traceId)
 *   const response = await fetch(`/api/users/${id}`)
 *   return response.json()
 * })
 * ```
 */
export function trace<T extends (...args: any[]) => any>(
  fn: T | ((ctx: TraceContext) => T)
): T {
  // Check if function expects a context parameter (factory pattern)
  const expectsContext = isFactoryPattern(fn);

  if (expectsContext) {
    // Factory pattern: trace(ctx => async (data) => ...)
    return ((...args: any[]) => {
      // Generate a new trace context for this call
      const ctx = createContext();

      // Call factory to get the actual function
      const actualFn = (fn as (ctx: TraceContext) => T)(ctx);

      // Execute the function
      return actualFn(...args);
    }) as T;
  }

  // Direct pattern: trace(async (data) => ...)
  // Just return the function as-is since headers are auto-injected
  return fn as T;
}

/**
 * Check if a function expects a context parameter (factory pattern)
 */
function isFactoryPattern(fn: unknown): boolean {
  if (typeof fn !== 'function') return false;

  const fnStr = fn.toString();

  // Look for common parameter names that indicate context
  const contextHints = ['ctx', 'context', 'traceContext'];

  return contextHints.some((hint) => {
    // Match parameter name at start of function
    const regex = new RegExp(`^\\s*(?:async\\s+)?(?:function\\s*)?\\(?\\s*${hint}\\s*[,)]`);
    return regex.test(fnStr);
  });
}

/**
 * Create a minimal trace context
 * Generates new IDs for this "span" (browser-side only)
 */
function createContext(): TraceContext {
  // Parse the current traceparent if we have one
  // (This would come from SSR or previous span)
  const traceparent = createTraceparent();
  const parsed = parseTraceparent(traceparent);

  if (!parsed) {
    // Fallback if parsing fails
    return {
      traceId: '',
      spanId: '',
      correlationId: '',
    };
  }

  const ctx: TraceContext = {
    traceId: parsed.traceId,
    spanId: parsed.spanId,
    correlationId: parsed.traceId,
  };

  currentContext = ctx;
  return ctx;
}

/**
 * Get the current trace context (if any)
 *
 * @returns Current trace context or undefined
 *
 * @example
 * ```typescript
 * const ctx = getActiveContext()
 * if (ctx) {
 *   console.log('Trace ID:', ctx.traceId)
 * }
 * ```
 */
export function getActiveContext(): TraceContext | undefined {
  return currentContext;
}

/**
 * Manual helper to create a traceparent header
 *
 * Useful if you need to manually set headers or disable auto-instrumentation.
 *
 * @returns W3C traceparent header value
 *
 * @example
 * ```typescript
 * import { init, getTraceparent } from 'autotel-web'
 *
 * // Disable auto-instrumentation
 * init({ service: 'my-app', instrumentFetch: false })
 *
 * // Manually inject headers
 * fetch('/api/data', {
 *   headers: {
 *     'traceparent': getTraceparent()
 *   }
 * })
 * ```
 */
export function getTraceparent(): string {
  return createTraceparent();
}

/**
 * Extract trace context from a traceparent header
 *
 * Useful for SSR scenarios where you want to continue a trace from the server.
 *
 * @param traceparent - W3C traceparent header value
 * @returns Parsed trace context or undefined if invalid
 *
 * @example
 * ```typescript
 * // In an SSR handler
 * const traceparent = request.headers.get('traceparent')
 * if (traceparent) {
 *   const ctx = extractContext(traceparent)
 *   console.log('Continuing trace:', ctx?.traceId)
 * }
 * ```
 */
export function extractContext(traceparent: string): TraceContext | undefined {
  const parsed = parseTraceparent(traceparent);
  if (!parsed) return undefined;

  return {
    traceId: parsed.traceId,
    spanId: parsed.spanId,
    correlationId: parsed.traceId,
  };
}
