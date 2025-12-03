/**
 * Browser stub for metrics module
 *
 * Metrics collection only happens on the server.
 * In browser, these are no-op functions.
 */

/**
 * Metrics data structure (stub)
 */
export interface MetricsData {
  requestCount: number;
  errorCount: number;
  avgLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  requestsPerSecond: number;
  endpoints: Record<
    string,
    {
      count: number;
      errors: number;
      avgLatency: number;
    }
  >;
}

/**
 * Browser stub: Returns empty metrics
 */
export function getMetrics(): MetricsData {
  return {
    requestCount: 0,
    errorCount: 0,
    avgLatency: 0,
    p50Latency: 0,
    p95Latency: 0,
    p99Latency: 0,
    requestsPerSecond: 0,
    endpoints: {},
  };
}

/**
 * Browser stub: No-op
 */
export function recordTiming(name: string, durationMs: number): void {
  void name;
  void durationMs;
  // No-op in browser
}

/**
 * Browser stub: No-op
 */
export function recordError(name: string): void {
  void name;
  // No-op in browser
}

/**
 * Browser stub: No-op
 */
export function resetMetrics(): void {
  // No-op in browser
}

/**
 * Browser stub: No-op metrics collector
 */
export const metricsCollector = {
  recordTiming: recordTiming,
  recordError: recordError,
  getMetrics: getMetrics,
  reset: resetMetrics,
};

/**
 * Browser stub: Returns JSON Response with empty metrics
 */
export function createMetricsHandler(): () => Response {
  return () => {
    return Response.json(getMetrics());
  };
}
