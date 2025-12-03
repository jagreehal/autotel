/**
 * Browser stub for context module
 *
 * In browser environments, context propagation is not needed.
 * These functions return empty/default values.
 */

/**
 * Type representing values that can be used to initialize Headers
 */
export type HeadersInitType =
  | Headers
  | Record<string, string>
  | [string, string][];

/**
 * Browser stub: Returns root context (no parent)
 */
export function extractContextFromRequest(_request: Request): unknown {
  void _request;
  // Return an empty context-like object
  return {};
}

/**
 * Browser stub: Returns headers unchanged
 */
export function injectContextToHeaders(
  headers: Headers,
  ctx?: unknown,
): Headers {
  void ctx;
  return headers;
}

/**
 * Browser stub: Create headers with optional initial values
 */
export function createTracedHeaders(
  existingHeaders?: HeadersInitType,
  ctx?: unknown,
): Headers {
  void ctx;
  return new Headers(existingHeaders);
}

/**
 * Browser stub: Run function and return result
 */
export function runInContext<T>(parentContext: unknown, fn: () => T): T {
  void parentContext;
  return fn();
}

/**
 * Browser stub: Returns empty context object
 */
export function getActiveContext(): unknown {
  return {};
}

/**
 * Browser stub: Returns empty string
 */
export function getTraceParent(): string {
  return '';
}

/**
 * Browser stub: Returns empty string
 */
export function getTraceState(): string {
  return '';
}

/**
 * Browser stub: Returns undefined
 */
export function getCurrentTraceId(): string | undefined {
  return undefined;
}

/**
 * Browser stub: Returns undefined
 */
export function getCurrentSpanId(): string | undefined {
  return undefined;
}
