import { context, SpanStatusCode } from '@opentelemetry/api';
import { trace, init, type TraceContext } from 'autotel';
import { extractContextFromRequest } from './context';
import {
  type WrapStartHandlerConfig,
  DEFAULT_CONFIG,
  SPAN_ATTRIBUTES,
} from './types';

/**
 * Request handler type (compatible with TanStack Start handlers)
 */
type RequestHandler = (
  request: Request,
  opts?: { context?: Record<string, unknown> },
) => Promise<Response> | Response;

/**
 * Wrap a TanStack Start handler with OpenTelemetry tracing
 *
 * This function wraps the entire request handler to automatically create
 * spans for all incoming requests. It initializes OpenTelemetry and
 * provides comprehensive request tracing.
 *
 * @param config - Configuration options including OTLP endpoint and headers
 * @returns Function that wraps a request handler
 *
 * @example
 * ```typescript
 * // server.ts
 * import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server';
 * import { wrapStartHandler } from 'autotel-tanstack/handlers';
 *
 * export default wrapStartHandler({
 *   service: 'my-app',
 *   endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
 *   headers: { 'x-honeycomb-team': process.env.HONEYCOMB_API_KEY },
 * })(createStartHandler(defaultStreamHandler));
 * ```
 *
 * @example
 * ```typescript
 * // With env var configuration (recommended for production)
 * // Set OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS
 * export default wrapStartHandler()(createStartHandler(defaultStreamHandler));
 * ```
 */
export function wrapStartHandler(
  config: WrapStartHandlerConfig = {},
): (handler: RequestHandler) => RequestHandler {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  // Initialize autotel with provided configuration
  const service =
    config.service || process.env.OTEL_SERVICE_NAME || 'tanstack-start';
  const endpoint = config.endpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  // Parse headers from env if not provided
  let headers = config.headers;
  if (!headers && process.env.OTEL_EXPORTER_OTLP_HEADERS) {
    headers = {};
    const pairs = process.env.OTEL_EXPORTER_OTLP_HEADERS.split(',');
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (key && value) {
        headers[key.trim()] = value.trim();
      }
    }
  }

  // Initialize OpenTelemetry
  init({
    service,
    endpoint,
    headers,
  });

  return function wrapHandler(handler: RequestHandler): RequestHandler {
    return async function tracedHandler(
      request: Request,
      opts?: { context?: Record<string, unknown> },
    ): Promise<Response> {
      const url = new URL(request.url);

      // Check if path should be excluded
      const shouldExclude = mergedConfig.excludePaths.some((pattern) => {
        if (typeof pattern === 'string') {
          if (pattern.includes('*')) {
            const regex = new RegExp(
              '^' + pattern.replaceAll('*', '.*').replaceAll('?', '.') + '$',
            );
            return regex.test(url.pathname);
          }
          return url.pathname === pattern || url.pathname.startsWith(pattern);
        }
        return pattern.test(url.pathname);
      });

      if (shouldExclude) {
        return handler(request, opts);
      }

      // Extract parent context from request headers
      const parentContext = extractContextFromRequest(request);

      // Run within parent context
      return context.with(parentContext, async () => {
        const spanName = `${request.method} ${url.pathname}`;

        return trace(spanName, async (ctx: TraceContext) => {
          // Set HTTP semantic attributes
          ctx.setAttributes({
            [SPAN_ATTRIBUTES.HTTP_REQUEST_METHOD]: request.method,
            [SPAN_ATTRIBUTES.URL_PATH]: url.pathname,
            [SPAN_ATTRIBUTES.URL_FULL]: request.url,
            [SPAN_ATTRIBUTES.TANSTACK_TYPE]: 'request',
          });

          if (url.search) {
            ctx.setAttribute(SPAN_ATTRIBUTES.URL_QUERY, url.search);
          }

          // Capture configured headers
          if (mergedConfig.captureHeaders) {
            for (const header of mergedConfig.captureHeaders) {
              const value = request.headers.get(header);
              if (value) {
                ctx.setAttribute(
                  `http.request.header.${header.toLowerCase()}`,
                  value,
                );
              }
            }
          }

          // Add custom attributes
          if (config.customAttributes) {
            const customAttrs = config.customAttributes({
              type: 'request',
              name: spanName,
              request,
            });
            ctx.setAttributes(
              customAttrs as Record<string, string | number | boolean>,
            );
          }

          const startTime = Date.now();

          try {
            const response = await handler(request, opts);
            const duration = Date.now() - startTime;

            ctx.setAttribute(
              SPAN_ATTRIBUTES.TANSTACK_REQUEST_DURATION_MS,
              duration,
            );
            ctx.setAttribute(
              SPAN_ATTRIBUTES.HTTP_RESPONSE_STATUS_CODE,
              response.status,
            );

            // Set status based on HTTP status code
            if (response.status >= 400) {
              ctx.setStatus({
                code: SpanStatusCode.ERROR,
                message: `HTTP ${response.status}`,
              });
            } else {
              ctx.setStatus({ code: SpanStatusCode.OK });
            }

            return response;
          } catch (error) {
            const duration = Date.now() - startTime;
            ctx.setAttribute(
              SPAN_ATTRIBUTES.TANSTACK_REQUEST_DURATION_MS,
              duration,
            );

            if (mergedConfig.captureErrors) {
              ctx.recordException(error as Error);
              ctx.setStatus({
                code: SpanStatusCode.ERROR,
                message: (error as Error).message,
              });
            }

            throw error;
          }
        });
      });
    };
  };
}

/**
 * Create a traced handler without auto-initialization
 *
 * Use this when you want to initialize autotel separately
 * (e.g., with more advanced configuration).
 *
 * @param config - Configuration options (excluding endpoint/headers)
 * @returns Function that wraps a request handler
 *
 * @example
 * ```typescript
 * import { init } from 'autotel';
 * import { createTracedHandler } from 'autotel-tanstack/handlers';
 *
 * // Initialize autotel with custom configuration
 * init({
 *   service: 'my-app',
 *   endpoint: 'https://api.honeycomb.io',
 *   instrumentations: [/* custom instrumentations *\/],
 * });
 *
 * // Wrap handler without re-initializing
 * export default createTracedHandler({
 *   captureHeaders: ['x-request-id'],
 * })(createStartHandler(defaultStreamHandler));
 * ```
 */
export function createTracedHandler(
  config: Omit<WrapStartHandlerConfig, 'endpoint' | 'headers' | 'service'> = {},
): (handler: RequestHandler) => RequestHandler {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  return function wrapHandler(handler: RequestHandler): RequestHandler {
    return async function tracedHandler(
      request: Request,
      opts?: { context?: Record<string, unknown> },
    ): Promise<Response> {
      const url = new URL(request.url);

      // Check if path should be excluded
      const shouldExclude = mergedConfig.excludePaths.some((pattern) => {
        if (typeof pattern === 'string') {
          if (pattern.includes('*')) {
            const regex = new RegExp(
              '^' + pattern.replaceAll('*', '.*').replaceAll('?', '.') + '$',
            );
            return regex.test(url.pathname);
          }
          return url.pathname === pattern || url.pathname.startsWith(pattern);
        }
        return pattern.test(url.pathname);
      });

      if (shouldExclude) {
        return handler(request, opts);
      }

      const parentContext = extractContextFromRequest(request);

      return context.with(parentContext, async () => {
        const spanName = `${request.method} ${url.pathname}`;

        return trace(spanName, async (ctx: TraceContext) => {
          ctx.setAttributes({
            [SPAN_ATTRIBUTES.HTTP_REQUEST_METHOD]: request.method,
            [SPAN_ATTRIBUTES.URL_PATH]: url.pathname,
            [SPAN_ATTRIBUTES.TANSTACK_TYPE]: 'request',
          });

          if (url.search) {
            ctx.setAttribute(SPAN_ATTRIBUTES.URL_QUERY, url.search);
          }

          if (mergedConfig.captureHeaders) {
            for (const header of mergedConfig.captureHeaders) {
              const value = request.headers.get(header);
              if (value) {
                ctx.setAttribute(
                  `http.request.header.${header.toLowerCase()}`,
                  value,
                );
              }
            }
          }

          if (config.customAttributes) {
            const customAttrs = config.customAttributes({
              type: 'request',
              name: spanName,
              request,
            });
            ctx.setAttributes(
              customAttrs as Record<string, string | number | boolean>,
            );
          }

          const startTime = Date.now();

          try {
            const response = await handler(request, opts);
            const duration = Date.now() - startTime;

            ctx.setAttribute(
              SPAN_ATTRIBUTES.TANSTACK_REQUEST_DURATION_MS,
              duration,
            );
            ctx.setAttribute(
              SPAN_ATTRIBUTES.HTTP_RESPONSE_STATUS_CODE,
              response.status,
            );

            if (response.status >= 400) {
              ctx.setStatus({
                code: SpanStatusCode.ERROR,
                message: `HTTP ${response.status}`,
              });
            } else {
              ctx.setStatus({ code: SpanStatusCode.OK });
            }

            return response;
          } catch (error) {
            const duration = Date.now() - startTime;
            ctx.setAttribute(
              SPAN_ATTRIBUTES.TANSTACK_REQUEST_DURATION_MS,
              duration,
            );

            if (mergedConfig.captureErrors) {
              ctx.recordException(error as Error);
              ctx.setStatus({
                code: SpanStatusCode.ERROR,
                message: (error as Error).message,
              });
            }

            throw error;
          }
        });
      });
    };
  };
}
