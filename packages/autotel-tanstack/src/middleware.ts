import { context, SpanStatusCode, type Attributes } from '@opentelemetry/api';
import { trace, type TraceContext } from 'autotel';
import { extractContextFromRequest } from './context';
import { isServerSide } from './env';
import {
  type TracingMiddlewareConfig,
  DEFAULT_CONFIG,
  SPAN_ATTRIBUTES,
} from './types';

/**
 * Check if a path should be excluded from tracing
 */
function shouldExcludePath(
  pathname: string,
  excludePaths: (string | RegExp)[],
): boolean {
  for (const pattern of excludePaths) {
    if (typeof pattern === 'string') {
      // Simple glob matching
      if (pattern.includes('*')) {
        const regex = new RegExp(
          '^' + pattern.replaceAll('*', '.*').replaceAll('?', '.') + '$',
        );
        if (regex.test(pathname)) return true;
      } else {
        if (pathname === pattern || pathname.startsWith(pattern)) return true;
      }
    } else {
      if (pattern.test(pathname)) return true;
    }
  }
  return false;
}

/**
 * Build span attributes for HTTP requests
 */
function buildRequestAttributes(
  request: Request,
  config: Required<
    Omit<TracingMiddlewareConfig, 'customAttributes' | 'service' | 'type'>
  >,
): Attributes {
  const url = new URL(request.url);
  const attrs: Attributes = {
    [SPAN_ATTRIBUTES.HTTP_REQUEST_METHOD]: request.method,
    [SPAN_ATTRIBUTES.URL_PATH]: url.pathname,
    [SPAN_ATTRIBUTES.TANSTACK_TYPE]: 'request',
  };

  if (url.search) {
    attrs[SPAN_ATTRIBUTES.URL_QUERY] = url.search;
  }

  // Capture configured headers
  if (config.captureHeaders) {
    for (const header of config.captureHeaders) {
      const value = request.headers.get(header);
      if (value) {
        attrs[`http.request.header.${header.toLowerCase()}`] = value;
      }
    }
  }

  return attrs;
}

/**
 * Build span attributes for server functions
 */
function buildServerFnAttributes(
  functionName: string,
  method: string,
  args: unknown,
  config: Required<
    Omit<TracingMiddlewareConfig, 'customAttributes' | 'service' | 'type'>
  >,
): Attributes {
  const attrs: Attributes = {
    [SPAN_ATTRIBUTES.RPC_SYSTEM]: 'tanstack-start',
    [SPAN_ATTRIBUTES.RPC_METHOD]: functionName,
    [SPAN_ATTRIBUTES.TANSTACK_TYPE]: 'serverFn',
    [SPAN_ATTRIBUTES.TANSTACK_SERVER_FN_NAME]: functionName,
    [SPAN_ATTRIBUTES.TANSTACK_SERVER_FN_METHOD]: method,
  };

  if (config.captureArgs && args !== undefined) {
    try {
      attrs[SPAN_ATTRIBUTES.TANSTACK_SERVER_FN_ARGS] = JSON.stringify(args);
    } catch {
      attrs[SPAN_ATTRIBUTES.TANSTACK_SERVER_FN_ARGS] = '[non-serializable]';
    }
  }

  return attrs;
}

/**
 * Generic middleware handler type (compatible with TanStack's middleware pattern)
 *
 * This type represents the shape of TanStack middleware handlers.
 * We use a generic type to avoid direct dependency on TanStack packages.
 */
export interface MiddlewareHandler<TContext = unknown> {
  (opts: {
    next: (ctx?: Partial<TContext>) => Promise<TContext>;
    context: TContext;
    request?: Request;
    pathname?: string;
    data?: unknown;
    method?: string;
    filename?: string;
    functionId?: string;
    signal?: AbortSignal;
  }): Promise<TContext>;
}

/**
 * Create a TanStack-compatible tracing middleware
 *
 * This creates middleware that automatically traces all requests/server functions
 * with OpenTelemetry spans. Use with TanStack Start's middleware system.
 *
 * @param config - Configuration options
 * @returns Middleware handler compatible with TanStack Start
 *
 * @example
 * ```typescript
 * // Global request middleware in app/start.ts
 * import { createStart } from '@tanstack/react-start';
 * import { createTracingMiddleware } from 'autotel-tanstack/middleware';
 *
 * export const startInstance = createStart(() => ({
 *   requestMiddleware: [
 *     createTracingMiddleware({
 *       captureHeaders: ['x-request-id', 'user-agent'],
 *       excludePaths: ['/health', '/metrics'],
 *     }),
 *   ],
 * }));
 * ```
 *
 * @example
 * ```typescript
 * // Server function middleware
 * import { createServerFn } from '@tanstack/react-start';
 * import { createTracingMiddleware } from 'autotel-tanstack/middleware';
 *
 * export const getUser = createServerFn({ method: 'GET' })
 *   .middleware([createTracingMiddleware({ type: 'function' })])
 *   .handler(async ({ data: id }) => {
 *     return await db.users.findUnique({ where: { id } });
 *   });
 * ```
 */
export function createTracingMiddleware<TContext = unknown>(
  config?: TracingMiddlewareConfig,
): MiddlewareHandler<TContext> {
  const mergedConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    type: config?.type ?? 'request',
  };

  return async function tracingMiddleware(opts) {
    // If we're in the browser, return a no-op middleware
    // This prevents autotel (which uses Node.js APIs) from being bundled/executed in the browser
    if (!isServerSide()) {
      return opts.next();
    }
    const { next, request, pathname, data, functionId } = opts;

    // For function middleware
    if (mergedConfig.type === 'function') {
      const fnName = functionId || 'unknown';
      const method = (opts as { method?: string }).method || 'POST';

      return trace(`tanstack.serverFn.${fnName}`, async (ctx: TraceContext) => {
        const attrs = buildServerFnAttributes(
          fnName,
          method,
          data,
          mergedConfig,
        );
        ctx.setAttributes(attrs as Record<string, string | number | boolean>);

        // Add custom attributes if provided
        if (config?.customAttributes) {
          const customAttrs = config.customAttributes({
            type: 'serverFn',
            name: fnName,
            args: data,
          });
          ctx.setAttributes(
            customAttrs as Record<string, string | number | boolean>,
          );
        }

        try {
          const result = await next();

          // Capture result if configured
          if (mergedConfig.captureResults && result !== undefined) {
            try {
              ctx.setAttribute(
                SPAN_ATTRIBUTES.TANSTACK_SERVER_FN_RESULT,
                JSON.stringify(result),
              );
            } catch {
              ctx.setAttribute(
                SPAN_ATTRIBUTES.TANSTACK_SERVER_FN_RESULT,
                '[non-serializable]',
              );
            }
          }

          ctx.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          if (mergedConfig.captureErrors) {
            ctx.recordException(error as Error);
            ctx.setStatus({
              code: SpanStatusCode.ERROR,
              message: (error as Error).message,
            });

            // Report error to error store
            try {
              const { reportError } = await import('./error-reporting');
              reportError(error as Error, {
                type: 'serverFn',
                name: fnName,
                method,
              });
            } catch {
              // Error reporting not available, skip
            }
          }
          throw error;
        }
      }) as Promise<TContext>;
    }

    // For request middleware
    if (!request) {
      // No request available, just pass through
      return next();
    }

    const url = new URL(request.url);

    // Check if path should be excluded
    if (shouldExcludePath(url.pathname, mergedConfig.excludePaths)) {
      return next();
    }

    // Extract parent context from request headers
    const parentContext = extractContextFromRequest(request);

    // Run within parent context for distributed tracing
    return context.with(parentContext, async () => {
      const spanName = `${request.method} ${pathname || url.pathname}`;

      return trace(spanName, async (ctx: TraceContext) => {
        const attrs = buildRequestAttributes(request, mergedConfig);
        ctx.setAttributes(attrs as Record<string, string | number | boolean>);

        // Add custom attributes if provided
        if (config?.customAttributes) {
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
          const result = await next();

          const duration = Date.now() - startTime;
          ctx.setAttribute(
            SPAN_ATTRIBUTES.TANSTACK_REQUEST_DURATION_MS,
            duration,
          );

          // Record timing in metrics collector
          try {
            const { metricsCollector } = await import('./metrics');
            metricsCollector.recordTiming(spanName, duration);
          } catch {
            // Metrics not available, skip
          }

          // Try to get response status from result if it's a Response
          if (result && typeof result === 'object' && 'status' in result) {
            ctx.setAttribute(
              SPAN_ATTRIBUTES.HTTP_RESPONSE_STATUS_CODE,
              (result as { status: number }).status,
            );
          }

          ctx.setStatus({ code: SpanStatusCode.OK });
          return result;
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

            // Report error to error store
            try {
              const { reportError } = await import('./error-reporting');
              reportError(error as Error, {
                type: 'request',
                method: request.method,
                pathname: url.pathname,
              });
            } catch {
              // Error reporting not available, skip
            }
          }
          throw error;
        }
      }) as Promise<TContext>;
    });
  };
}

/**
 * Pre-configured tracing middleware with sensible defaults
 *
 * Convenience export for quick setup. Uses adaptive sampling,
 * captures x-request-id header, and excludes common health check paths.
 *
 * @param config - Optional configuration overrides
 * @returns Middleware handler
 *
 * @example
 * ```typescript
 * import { createStart } from '@tanstack/react-start';
 * import { tracingMiddleware } from 'autotel-tanstack/middleware';
 *
 * export const startInstance = createStart(() => ({
 *   requestMiddleware: [tracingMiddleware()],
 * }));
 * ```
 */
export function tracingMiddleware<TContext = unknown>(
  config?: TracingMiddlewareConfig,
): MiddlewareHandler<TContext> {
  return createTracingMiddleware({
    sampling: 'adaptive',
    captureHeaders: ['x-request-id', 'user-agent'],
    excludePaths: ['/health', '/healthz', '/ready', '/metrics', '/_ping'],
    ...config,
  });
}

/**
 * Create function-specific tracing middleware
 *
 * Convenience wrapper for server function middleware.
 *
 * @param config - Optional configuration
 * @returns Middleware handler for server functions
 *
 * @example
 * ```typescript
 * import { createServerFn } from '@tanstack/react-start';
 * import { functionTracingMiddleware } from 'autotel-tanstack/middleware';
 *
 * export const getUser = createServerFn({ method: 'GET' })
 *   .middleware([functionTracingMiddleware()])
 *   .handler(async ({ data: id }) => {
 *     return await db.users.findUnique({ where: { id } });
 *   });
 * ```
 */
export function functionTracingMiddleware<TContext = unknown>(
  config?: Omit<TracingMiddlewareConfig, 'type'>,
): MiddlewareHandler<TContext> {
  return createTracingMiddleware({
    ...config,
    type: 'function',
  });
}

/**
 * Create a tracing handler for use with TanStack's native createMiddleware()
 *
 * This provides the raw tracing logic that you can pass to createMiddleware().server().
 * Use this when you want full control over the middleware builder pattern.
 *
 * The handler accepts TanStack's middleware signature `{ next, context, request }`
 * and internally adapts it to our more flexible MiddlewareHandler interface.
 *
 * @param config - Configuration options
 * @returns Server handler function compatible with createMiddleware().server()
 *
 * @example
 * ```typescript
 * import { createStart, createMiddleware } from '@tanstack/react-start';
 * import { createTracingServerHandler } from 'autotel-tanstack/middleware';
 *
 * // TanStack-native middleware creation
 * const requestTracingMiddleware = createMiddleware().server(
 *   createTracingServerHandler({ captureHeaders: ['x-request-id'] })
 * );
 *
 * export const start = createStart(() => ({
 *   requestMiddleware: [requestTracingMiddleware],
 * }));
 * ```
 *
 * @example
 * ```typescript
 * // For server functions - use createMiddleware({ type: 'function' })
 * import { createStart, createMiddleware } from '@tanstack/react-start';
 * import { createTracingServerHandler } from 'autotel-tanstack/middleware';
 *
 * const functionTracingMiddleware = createMiddleware({ type: 'function' }).server(
 *   createTracingServerHandler({ type: 'function', captureArgs: true })
 * );
 *
 * export const start = createStart(() => ({
 *   functionMiddleware: [functionTracingMiddleware],
 * }));
 * ```
 */
export function createTracingServerHandler<TContext = unknown>(
  config?: TracingMiddlewareConfig,
): (opts: any) => any {
  const handler = createTracingMiddleware<TContext>(config);

  // Adapt TanStack's signature to our handler
  return async (opts: any) => {
    return handler(opts);
  };
}
