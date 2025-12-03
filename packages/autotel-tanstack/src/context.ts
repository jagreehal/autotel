import {
  context,
  propagation,
  type Context,
  ROOT_CONTEXT,
} from '@opentelemetry/api';

/**
 * Type representing values that can be used to initialize Headers
 * This is equivalent to the DOM's HeadersInit type but works in Node.js
 */
export type HeadersInitType =
  | Headers
  | Record<string, string>
  | [string, string][];

/**
 * Extract OpenTelemetry context from HTTP request headers
 *
 * This function extracts W3C Trace Context (traceparent, tracestate)
 * and Baggage from request headers to enable distributed tracing.
 *
 * @param request - The incoming HTTP request
 * @returns OpenTelemetry context with extracted trace information
 *
 * @example
 * ```typescript
 * const parentContext = extractContextFromRequest(request);
 * context.with(parentContext, async () => {
 *   // Spans created here will be children of the extracted context
 *   await trace('my-operation', async (ctx) => { ... });
 * });
 * ```
 */
export function extractContextFromRequest(request: Request): Context {
  const carrier: Record<string, string> = {};

  // Extract W3C Trace Context headers
  const traceparent = request.headers.get('traceparent');
  const tracestate = request.headers.get('tracestate');
  const baggage = request.headers.get('baggage');

  if (traceparent) carrier.traceparent = traceparent;
  if (tracestate) carrier.tracestate = tracestate;
  if (baggage) carrier.baggage = baggage;

  // Return ROOT_CONTEXT if no trace headers present
  if (Object.keys(carrier).length === 0) {
    return ROOT_CONTEXT;
  }

  return propagation.extract(context.active(), carrier);
}

/**
 * Inject OpenTelemetry context into HTTP headers
 *
 * This function injects W3C Trace Context (traceparent, tracestate)
 * and Baggage into headers for outgoing requests.
 *
 * @param headers - Headers object to inject context into
 * @param ctx - Optional context to inject (defaults to active context)
 * @returns The headers object with injected trace context
 *
 * @example
 * ```typescript
 * const headers = new Headers();
 * injectContextToHeaders(headers);
 *
 * // Now use headers in outgoing fetch
 * await fetch('https://api.example.com', { headers });
 * ```
 */
export function injectContextToHeaders(
  headers: Headers,
  ctx?: Context,
): Headers {
  const carrier: Record<string, string> = {};
  propagation.inject(ctx ?? context.active(), carrier);

  for (const [key, value] of Object.entries(carrier)) {
    headers.set(key, value);
  }

  return headers;
}

/**
 * Create a new Headers object with injected trace context
 *
 * Convenience function that creates a new Headers object
 * with the current trace context already injected.
 *
 * @param existingHeaders - Optional existing headers to include
 * @param ctx - Optional context to inject (defaults to active context)
 * @returns New Headers object with trace context
 *
 * @example
 * ```typescript
 * const headers = createTracedHeaders({ 'Content-Type': 'application/json' });
 * await fetch('https://api.example.com', {
 *   method: 'POST',
 *   headers,
 *   body: JSON.stringify(data),
 * });
 * ```
 */
export function createTracedHeaders(
  existingHeaders?: HeadersInitType,
  ctx?: Context,
): Headers {
  const headers = new Headers(existingHeaders);
  return injectContextToHeaders(headers, ctx);
}

/**
 * Run a function within a specific OpenTelemetry context
 *
 * This is a convenience wrapper around context.with() that
 * provides better TypeScript inference.
 *
 * @param parentContext - The context to run within
 * @param fn - The function to execute
 * @returns The result of the function
 *
 * @example
 * ```typescript
 * const parentContext = extractContextFromRequest(request);
 * const result = await runInContext(parentContext, async () => {
 *   return await processRequest();
 * });
 * ```
 */
export function runInContext<T>(parentContext: Context, fn: () => T): T {
  return context.with(parentContext, fn);
}

/**
 * Get the current active context
 *
 * @returns The current active OpenTelemetry context
 */
export function getActiveContext(): Context {
  return context.active();
}
