/**
 * autotel-tanstack
 *
 * OpenTelemetry instrumentation for TanStack Start applications.
 * Provides automatic tracing for server functions, middleware, and route loaders.
 *
 * @example
 * ```typescript
 * // Quick start with middleware
 * import { createStart } from '@tanstack/react-start';
 * import { tracingMiddleware } from 'autotel-tanstack';
 *
 * export const startInstance = createStart(() => ({
 *   requestMiddleware: [tracingMiddleware()],
 * }));
 * ```
 *
 * @example
 * ```typescript
 * // Zero-config auto-init
 * import 'autotel-tanstack/auto';
 * ```
 *
 * @packageDocumentation
 */

// Types
export type {
  TanStackInstrumentationConfig,
  TracingMiddlewareConfig,
  TraceServerFnConfig,
  TraceLoaderConfig,
  WrapStartHandlerConfig,
} from './types';
export { DEFAULT_CONFIG, SPAN_ATTRIBUTES } from './types';

// Middleware
export {
  createTracingMiddleware,
  tracingMiddleware,
  functionTracingMiddleware,
  createTracingServerHandler,
  type MiddlewareHandler,
} from './middleware';

// Server Functions
export { traceServerFn, createTracedServerFnFactory } from './server-functions';

// Loaders
export { traceLoader, traceBeforeLoad, createTracedRoute } from './loaders';

// Handlers
export { wrapStartHandler, createTracedHandler } from './handlers';

// Context
export {
  extractContextFromRequest,
  injectContextToHeaders,
  createTracedHeaders,
  runInContext,
  getActiveContext,
} from './context';

// Debug Headers
export {
  debugHeadersMiddleware,
  type DebugHeadersConfig,
} from './debug-headers';

// Metrics
export {
  metricsCollector,
  createMetricsHandler,
  recordTiming,
  type TimingStats,
} from './metrics';

// Error Reporting
export {
  errorStore,
  reportError,
  createErrorReportingHandler,
  withErrorReporting,
  type ErrorReport,
} from './error-reporting';

// Re-export autotel core utilities for convenience
// Note: These should only be used on the server side
// They use Node.js APIs (AsyncLocalStorage) that don't exist in the browser
export { trace, span, init, shutdown, flush } from 'autotel';

// Export environment utilities
export { isBrowser, isNode, isServerSide } from './env';
