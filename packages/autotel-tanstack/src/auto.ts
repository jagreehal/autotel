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
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';

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

// E2E mode: use InMemorySpanExporter so tests can capture and assert on spans.
// When E2E=1, skip the normal OTLP path and use in-memory storage instead.
// Note: combined E2E + OTLP (two processors) is handled at integration level
// because constructing an OTLP processor requires deps not available here.
if (process.env.E2E === '1') {
  const e2eExporter = new InMemorySpanExporter();
  const e2eProcessor = new SimpleSpanProcessor(e2eExporter);
  (globalThis as Record<string, unknown>).__testSpanExporter = e2eExporter;

  init({
    service,
    spanProcessors: [e2eProcessor],
  });
} else {
  // Initialize autotel (production path — unchanged)
  init({
    service,
    endpoint,
    headers,
    debug: resolveDebug(),
  });
}

// Log initialization (only in development)
if (process.env.NODE_ENV === 'development' || process.env.AUTOTEL_DEBUG) {
  console.log('[autotel-tanstack] Auto-initialized with:', {
    service,
    endpoint:
      process.env.E2E === '1'
        ? '(E2E: in-memory)'
        : endpoint || '(not configured)',
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
