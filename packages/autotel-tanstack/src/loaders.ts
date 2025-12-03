import { SpanStatusCode } from '@opentelemetry/api';
import { trace, type TraceContext } from 'autotel';
import { isServerSide } from './env';
import { type TraceLoaderConfig, SPAN_ATTRIBUTES } from './types';

/**
 * Loader context type (compatible with TanStack router loader context)
 */
interface LoaderContext {
  params?: Record<string, string>;
  route?: {
    id?: string;
  };
  [key: string]: unknown;
}

/**
 * Wrap a TanStack route loader with OpenTelemetry tracing
 *
 * This function wraps a loader function to automatically create spans
 * for each invocation. It captures route ID, params (optionally),
 * and errors.
 *
 * @param loaderFn - The loader function to wrap
 * @param config - Configuration options
 * @returns Wrapped loader function with tracing
 *
 * @example
 * ```typescript
 * import { createFileRoute } from '@tanstack/react-router';
 * import { traceLoader } from 'autotel-tanstack/loaders';
 *
 * export const Route = createFileRoute('/users/$userId')({
 *   loader: traceLoader(async ({ params }) => {
 *     return await db.users.findUnique({ where: { id: params.userId } });
 *   }),
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With custom name and param capture
 * export const Route = createFileRoute('/products/$category/$productId')({
 *   loader: traceLoader(
 *     async ({ params }) => {
 *       return await db.products.findUnique({
 *         where: { id: params.productId, category: params.category },
 *       });
 *     },
 *     {
 *       name: 'loadProduct',
 *       captureParams: true,
 *       captureResult: false,
 *     }
 *   ),
 * });
 * ```
 */
export function traceLoader<
  T extends (context: LoaderContext) => Promise<unknown>,
>(loaderFn: T, config: TraceLoaderConfig = {}): T {
  const captureParams = config.captureParams ?? true;
  const captureResult = config.captureResult ?? false;

  return (async (context: LoaderContext) => {
    // If we're in the browser, just call the loader without tracing
    // This prevents autotel (which uses Node.js APIs) from being executed in the browser
    if (!isServerSide()) {
      return loaderFn(context);
    }

    const routeId = context?.route?.id || 'unknown';
    const spanName = config.name || `tanstack.loader.${routeId}`;

    return trace(spanName, async (ctx: TraceContext) => {
      ctx.setAttributes({
        [SPAN_ATTRIBUTES.TANSTACK_TYPE]: 'loader',
        [SPAN_ATTRIBUTES.TANSTACK_LOADER_ROUTE_ID]: routeId,
        [SPAN_ATTRIBUTES.TANSTACK_LOADER_TYPE]: 'loader',
      });

      // Capture params if configured
      if (captureParams && context?.params) {
        try {
          ctx.setAttribute(
            SPAN_ATTRIBUTES.TANSTACK_LOADER_PARAMS,
            JSON.stringify(context.params),
          );
        } catch {
          ctx.setAttribute(
            SPAN_ATTRIBUTES.TANSTACK_LOADER_PARAMS,
            '[non-serializable]',
          );
        }
      }

      try {
        const result = await loaderFn(context);

        // Capture result if configured
        if (captureResult && result !== undefined) {
          try {
            ctx.setAttribute('tanstack.loader.result', JSON.stringify(result));
          } catch {
            ctx.setAttribute('tanstack.loader.result', '[non-serializable]');
          }
        }

        ctx.setStatus({ code: SpanStatusCode.OK });
        return result as ReturnType<T>;
      } catch (error) {
        ctx.recordException(error as Error);
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: (error as Error).message,
        });
        throw error;
      }
    });
  }) as T;
}

/**
 * Wrap a TanStack route beforeLoad function with OpenTelemetry tracing
 *
 * This function wraps a beforeLoad function to automatically create spans.
 * beforeLoad runs before the route component renders and is typically
 * used for auth checks, redirects, or data prefetching.
 *
 * @param beforeLoadFn - The beforeLoad function to wrap
 * @param config - Configuration options
 * @returns Wrapped beforeLoad function with tracing
 *
 * @example
 * ```typescript
 * import { createFileRoute } from '@tanstack/react-router';
 * import { traceBeforeLoad } from 'autotel-tanstack/loaders';
 *
 * export const Route = createFileRoute('/dashboard')({
 *   beforeLoad: traceBeforeLoad(async ({ context }) => {
 *     if (!context.auth.isAuthenticated) {
 *       throw redirect({ to: '/login' });
 *     }
 *   }),
 *   loader: async () => {
 *     return await fetchDashboardData();
 *   },
 * });
 * ```
 */
export function traceBeforeLoad<
  T extends (context: LoaderContext) => Promise<unknown>,
>(beforeLoadFn: T, config: TraceLoaderConfig = {}): T {
  const captureParams = config.captureParams ?? true;

  return (async (context: LoaderContext): Promise<Awaited<ReturnType<T>>> => {
    const routeId = context?.route?.id || 'unknown';
    const spanName = config.name || `tanstack.beforeLoad.${routeId}`;

    return trace(
      spanName,
      async (ctx: TraceContext): Promise<Awaited<ReturnType<T>>> => {
        ctx.setAttributes({
          [SPAN_ATTRIBUTES.TANSTACK_TYPE]: 'beforeLoad',
          [SPAN_ATTRIBUTES.TANSTACK_LOADER_ROUTE_ID]: routeId,
          [SPAN_ATTRIBUTES.TANSTACK_LOADER_TYPE]: 'beforeLoad',
        });

        // Capture params if configured
        if (captureParams && context?.params) {
          try {
            ctx.setAttribute(
              SPAN_ATTRIBUTES.TANSTACK_LOADER_PARAMS,
              JSON.stringify(context.params),
            );
          } catch {
            ctx.setAttribute(
              SPAN_ATTRIBUTES.TANSTACK_LOADER_PARAMS,
              '[non-serializable]',
            );
          }
        }

        try {
          const result = (await beforeLoadFn(context)) as Awaited<
            ReturnType<T>
          >;
          ctx.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          // Check if this is a redirect or notFound (expected control flow)
          const errorName = (error as Error).name;
          if (errorName === 'RedirectError' || errorName === 'NotFoundError') {
            // Mark as OK since these are expected control flow
            ctx.setAttribute('tanstack.beforeLoad.redirect', true);
            ctx.setStatus({ code: SpanStatusCode.OK });
          } else {
            ctx.recordException(error as Error);
            ctx.setStatus({
              code: SpanStatusCode.ERROR,
              message: (error as Error).message,
            });
          }
          throw error;
        }
      },
    );
  }) as T;
}

/**
 * Create a traced route configuration helper
 *
 * This higher-order function helps create route configurations
 * with automatic tracing for both loader and beforeLoad.
 *
 * @param routeId - The route identifier
 * @param config - Tracing configuration
 * @returns Object with traced loader and beforeLoad wrappers
 *
 * @example
 * ```typescript
 * import { createFileRoute } from '@tanstack/react-router';
 * import { createTracedRoute } from 'autotel-tanstack/loaders';
 *
 * const traced = createTracedRoute('/users/$userId');
 *
 * export const Route = createFileRoute('/users/$userId')({
 *   beforeLoad: traced.beforeLoad(async ({ context }) => {
 *     // Auth check
 *   }),
 *   loader: traced.loader(async ({ params }) => {
 *     return await getUser(params.userId);
 *   }),
 * });
 * ```
 */
export function createTracedRoute(
  routeId: string,
  config: Omit<TraceLoaderConfig, 'name'> = {},
) {
  return {
    /**
     * Wrap a loader function with tracing
     */
    loader<T extends (context: LoaderContext) => Promise<unknown>>(
      loaderFn: T,
    ): T {
      return traceLoader(loaderFn, {
        ...config,
        name: `tanstack.loader.${routeId}`,
      });
    },

    /**
     * Wrap a beforeLoad function with tracing
     */
    beforeLoad<T extends (context: LoaderContext) => Promise<unknown>>(
      beforeLoadFn: T,
    ): T {
      return traceBeforeLoad(beforeLoadFn, {
        ...config,
        name: `tanstack.beforeLoad.${routeId}`,
      });
    },
  };
}
