/**
 * Zero-config auto-instrumentation for TanStack Start
 *
 * Import this module to automatically instrument TanStack Start applications
 * with OpenTelemetry tracing. Configuration is read from environment variables.
 *
 * Environment Variables:
 * - OTEL_SERVICE_NAME: Service name (default: 'tanstack-start')
 * - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP collector URL
 * - OTEL_EXPORTER_OTLP_HEADERS: Authentication headers (key=value,key=value)
 * - AUTOTEL_DEBUG: Set to 'true' or 'pretty' to log spans to the server console
 *
 * @example
 * ```typescript
 * // app/start.ts
 * import 'autotel-tanstack/auto';
 * import { createStart } from '@tanstack/react-start';
 *
 * // Tracing is automatically configured!
 * export const startInstance = createStart(() => ({}));
 * ```
 *
 * @module
 */

import { init } from 'autotel';

// Parse service name
const service = process.env.OTEL_SERVICE_NAME || 'tanstack-start';

// Parse endpoint
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

// Parse headers
let headers: Record<string, string> | undefined;
if (process.env.OTEL_EXPORTER_OTLP_HEADERS) {
  headers = {};
  const pairs = process.env.OTEL_EXPORTER_OTLP_HEADERS.split(',');
  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    if (key && value) {
      headers[key.trim()] = value.trim();
    }
  }
}

// Debug: span output to server console. AUTOTEL_DEBUG=pretty | true, or default
// to pretty in dev when no OTLP endpoint is set so you see spans immediately.
function resolveDebug(): boolean | 'pretty' {
  const env = process.env.AUTOTEL_DEBUG;
  if (env === 'pretty') return 'pretty';
  if (env === 'true' || env === '1') return true;
  if (env === 'false' || env === '0') return false;
  if (!endpoint && process.env.NODE_ENV === 'development') return 'pretty';
  return false;
}

// Initialize autotel
init({
  service,
  endpoint,
  headers,
  debug: resolveDebug(),
});

// Log initialization (only in development)
if (process.env.NODE_ENV === 'development' || process.env.AUTOTEL_DEBUG) {
  console.log('[autotel-tanstack] Auto-initialized with:', {
    service,
    endpoint: endpoint || '(not configured)',
    hasHeaders: !!headers,
  });
}

// Re-export middleware for convenience
export { tracingMiddleware, functionTracingMiddleware } from './middleware';
export { traceServerFn } from './server-functions';
export { traceLoader, traceBeforeLoad } from './loaders';

/**
 * Check if auto-instrumentation is active
 */
export function isAutoInstrumentationActive(): boolean {
  return true;
}

/**
 * Get the configured service name
 */
export function getServiceName(): string {
  return service;
}

/**
 * Get the configured endpoint
 */
export function getEndpoint(): string | undefined {
  return endpoint;
}
