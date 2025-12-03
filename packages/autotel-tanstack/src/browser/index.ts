/**
 * Browser entry point for autotel-tanstack
 *
 * This module provides no-op stubs for all exports to prevent
 * @opentelemetry/api and autotel from being bundled in client code.
 */

// Export types from types.ts (single source of truth)
export type {
  Attributes,
  TanStackInstrumentationConfig,
  TracingMiddlewareConfig,
  TraceServerFnConfig,
  TraceLoaderConfig,
  WrapStartHandlerConfig,
} from './types';
export { DEFAULT_CONFIG, SPAN_ATTRIBUTES } from './types';

// Export functions from each module (excluding their duplicate type exports)
export { traceLoader, traceBeforeLoad, createTracedRoute } from './loaders';
export { traceServerFn, createTracedServerFnFactory } from './server-functions';
export {
  createTracingMiddleware,
  tracingMiddleware,
  functionTracingMiddleware,
  type MiddlewareHandler,
} from './middleware';
export {
  extractContextFromRequest,
  injectContextToHeaders,
  createTracedHeaders,
  runInContext,
  getActiveContext,
  getTraceParent,
  getTraceState,
  getCurrentTraceId,
  getCurrentSpanId,
  type HeadersInitType,
} from './context';
export { wrapStartHandler, type StartHandler } from './handlers';
export {
  getMetrics,
  recordTiming,
  recordError,
  resetMetrics,
  metricsCollector,
  createMetricsHandler,
  type MetricsData,
} from './metrics';
export {
  reportError,
  getRecentErrors,
  clearErrors,
  createErrorReportingHandler,
  withErrorReporting,
  type ErrorEntry,
} from './error-reporting';
export { debugHeadersMiddleware } from './debug-headers';
export {
  createTestCollector,
  assertSpanCreated,
  assertSpanHasAttribute,
  type TestSpan,
  type TestCollector,
} from './testing';
