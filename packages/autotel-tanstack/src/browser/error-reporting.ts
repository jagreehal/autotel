/**
 * Browser stub for error-reporting module
 *
 * Error reporting/collection only happens on the server.
 * In browser, these are no-op functions.
 */

/**
 * Error entry structure (stub)
 */
export interface ErrorEntry {
  timestamp: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}

/**
 * Browser stub: No-op
 */
export function reportError(
  error: Error,
  context?: Record<string, unknown>,
): void {
  void error;
  void context;
  // No-op in browser
}

/**
 * Browser stub: Returns empty array
 */
export function getRecentErrors(limit?: number): ErrorEntry[] {
  void limit;
  return [];
}

/**
 * Browser stub: No-op
 */
export function clearErrors(): void {
  // No-op in browser
}

/**
 * Browser stub: Returns JSON Response with empty errors
 */
export function createErrorReportingHandler(): () => Response {
  return () => {
    return Response.json({ errors: [], count: 0 });
  };
}

/**
 * Browser stub: Returns function unchanged
 */
export function withErrorReporting<T extends (...args: unknown[]) => unknown>(
  fn: T,
  context?: Record<string, unknown>,
): T {
  void context;
  return fn;
}
