import { isServerSide } from './env';
import type { MiddlewareHandler } from './middleware';

/**
 * Configuration for debug headers middleware
 */
export interface DebugHeadersConfig {
  /**
   * Whether to enable debug headers
   * @default process.env.NODE_ENV === 'development'
   */
  enabled?: boolean;

  /**
   * Custom headers to add
   */
  customHeaders?: Record<string, string | (() => string)>;
}

/**
 * Create middleware that adds debug headers to responses in development
 *
 * Adds helpful debug information to response headers:
 * - X-Debug-Timestamp: Request timestamp
 * - X-Debug-Node-Version: Node.js version
 * - X-Debug-Uptime: Process uptime in seconds
 * - X-Debug-Trace-Id: Current trace ID (if available)
 *
 * @param config - Configuration options
 * @returns Middleware handler
 *
 * @example
 * ```typescript
 * import { createStart } from '@tanstack/react-start';
 * import { debugHeadersMiddleware } from 'autotel-tanstack/debug-headers';
 *
 * export const startInstance = createStart(() => ({
 *   requestMiddleware: [debugHeadersMiddleware()],
 * }));
 * ```
 */
export function debugHeadersMiddleware(
  config: DebugHeadersConfig = {},
): MiddlewareHandler {
  // If we're in the browser, return a no-op middleware
  if (!isServerSide()) {
    return async function debugHeadersHandler(opts) {
      return opts.next();
    };
  }

  const enabled =
    config.enabled ??
    (typeof process !== 'undefined' && process.env.NODE_ENV === 'development');

  return async function debugHeadersHandler(opts) {
    const { next, request } = opts;

    if (!enabled || !request) {
      return next();
    }

    const result = await next();

    // Check if result is a Response
    if (!(result instanceof Response)) {
      return result;
    }

    const response = result;

    // Clone response to add headers (responses are immutable)
    const newHeaders = new Headers(response.headers);

    // Add standard debug headers
    newHeaders.set('X-Debug-Timestamp', new Date().toISOString());
    newHeaders.set('X-Debug-Node-Version', process.version);
    newHeaders.set('X-Debug-Uptime', Math.floor(process.uptime()).toString());

    // Add trace ID if available
    try {
      const { trace } = await import('@opentelemetry/api');
      const activeSpan = trace.getActiveSpan();
      if (activeSpan) {
        const spanContext = activeSpan.spanContext();
        if (spanContext.traceId) {
          newHeaders.set('X-Debug-Trace-Id', spanContext.traceId);
        }
      }
    } catch {
      // OpenTelemetry not available, skip trace ID
    }

    // Add custom headers
    if (config.customHeaders) {
      for (const [key, value] of Object.entries(config.customHeaders)) {
        const headerValue = typeof value === 'function' ? value() : value;
        newHeaders.set(`X-Debug-${key}`, headerValue);
      }
    }

    // Return new response with debug headers
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  };
}
