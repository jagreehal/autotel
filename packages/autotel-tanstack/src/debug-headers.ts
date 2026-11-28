import { trace } from '@opentelemetry/api';
import { isServerSide } from './env';
import { responseOf } from './http-status';

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
 * import { createMiddleware, createStart } from '@tanstack/react-start';
 * import { debugHeadersMiddleware } from 'autotel-tanstack/debug-headers';
 *
 * const debugHeaders = createMiddleware().server(debugHeadersMiddleware());
 *
 * export const startInstance = createStart(() => ({
 *   // After the tracing middleware, so X-Debug-Trace-Id is the request's trace.
 *   requestMiddleware: [requestTracing, debugHeaders],
 * }));
 * ```
 */
export function debugHeadersMiddleware(
  config: DebugHeadersConfig = {},
  // oxlint-disable-next-line typescript/no-explicit-any -- Adapter for TanStack's createMiddleware().server(), whose opts/return types vary by version; kept loose so it is assignable there, as createTracingServerHandler is.
): (opts: any) => any {
  // If we're in the browser, return a no-op middleware
  if (!isServerSide()) {
    return async function debugHeadersHandler(opts) {
      return opts.next();
    };
  }

  const enabled =
    config.enabled ?? globalThis.process?.env.NODE_ENV === 'development';

  return async function debugHeadersHandler(opts) {
    const { next, request } = opts;

    if (!enabled || !request) {
      return next();
    }

    const result = await next();

    // SAFETY: request middleware next() resolves to TanStack's
    // RequestServerResult, or a Response a later middleware returned.
    const response = responseOf(result as { response?: unknown });
    if (!response) {
      return result;
    }

    // Clone response to add headers (responses are immutable)
    const newHeaders = new Headers(response.headers);

    // Add standard debug headers
    newHeaders.set('X-Debug-Timestamp', new Date().toISOString());
    newHeaders.set('X-Debug-Node-Version', process.version);
    newHeaders.set('X-Debug-Uptime', Math.floor(process.uptime()).toString());

    const traceId = trace.getActiveSpan()?.spanContext().traceId;
    if (traceId) {
      newHeaders.set('X-Debug-Trace-Id', traceId);
    }

    // Add custom headers
    if (config.customHeaders) {
      for (const [key, value] of Object.entries(config.customHeaders)) {
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Discriminates the typed public union `string | (() => string)` in DebugHeadersConfig.customHeaders; there is nothing to parse, and instanceof Function is banned by unicorn as realm-unsafe.
        const headerValue = typeof value === 'function' ? value() : value;
        newHeaders.set(`X-Debug-${key}`, headerValue);
      }
    }

    const withHeaders = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
    // Hand back the shape next() gave us, with the new response in it.
    // SAFETY: both branches rebuild the value next() resolved to.
    return (
      result instanceof Response
        ? withHeaders
        : { ...(result as object), response: withHeaders }
    ) as typeof result;
  };
}
