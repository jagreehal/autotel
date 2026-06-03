/**
 * Zero-config auto-instrumentation for TanStack Start.
 *
 * Importing this module configures OpenTelemetry tracing from environment
 * variables — it is simply `instrument()` with no options. For subscribers,
 * structured logs, canonical log lines, or an explicit endpoint, call
 * `instrument(options)` from `autotel-tanstack` directly (see ./instrument).
 *
 * Environment Variables (resolved by autotel core):
 * - OTEL_SERVICE_NAME: Service name (default: 'tanstack-start')
 * - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP collector URL
 * - OTEL_EXPORTER_OTLP_HEADERS: Auth headers (key=value,key=value)
 * - AUTOTEL_DEBUG: 'true' | 'pretty' to log spans to the server console
 *
 * @example
 * ```typescript
 * // app/start.ts
 * import 'autotel-tanstack/auto';
 * import { createStart } from '@tanstack/react-start';
 * export const startInstance = createStart(() => ({}));
 * ```
 *
 * @module
 */

import { instrument } from './instrument';

instrument();

// Surface what happened, in development only.
if (process.env.NODE_ENV === 'development' || process.env.AUTOTEL_DEBUG) {
  console.log('[autotel-tanstack] Auto-initialized', {
    service: process.env.OTEL_SERVICE_NAME || 'tanstack-start',
    endpoint:
      process.env.E2E === '1'
        ? '(E2E: in-memory)'
        : process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '(not configured)',
  });
}

// Re-export the configurable form + middleware/helpers for convenience.
export { instrument } from './instrument';
export { tracingMiddleware, functionTracingMiddleware } from './middleware';
export { traceServerFn } from './server-functions';
export { traceLoader, traceBeforeLoad } from './loaders';

/** Check if auto-instrumentation is active. */
export function isAutoInstrumentationActive(): boolean {
  return true;
}

/** The configured service name. */
export function getServiceName(): string {
  return process.env.OTEL_SERVICE_NAME || 'tanstack-start';
}

/** The configured OTLP endpoint, if any. */
export function getEndpoint(): string | undefined {
  return process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
}
