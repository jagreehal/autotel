import { SpanStatusCode } from '@opentelemetry/api';
import { trace, type TraceContext } from 'autotel';
import { isServerSide } from './env';
import { type TraceLoaderConfig, SPAN_ATTRIBUTES } from './types';

// Re-export types from @tanstack/react-router for consumers who need them
export type { LoaderFnContext } from '@tanstack/react-router';

/**
 * Internal type for extracting route info from TanStack context.
 * This is a minimal interface used only for instrumentation - the actual
 * TanStack types flow through the generic parameter.
 */
interface TanStackContextInternal {
  route?: { id?: string };
  params?: Record<string, string>;
}

/**
 * Wrap a TanStack route loader with OpenTelemetry tracing
 *
 * This function wraps a loader function to automatically create spans
 * for each invocation. It captures route ID, params (optionally),
 * and errors.
 *
 * The generic type TLoaderFn preserves the full TanStack Router type inference,
 * including typed params, context, and return types.
 *
 * @param loaderFn - The loader function to wrap
 * @param config - Configuration options
 * @returns Wrapped loader function with tracing (preserves original types)
 *
 * @example
 * ```typescript
 * import { createFileRoute } from '@tanstack/react-router';
 * import { traceLoader } from 'autotel-tanstack/loaders';
 *
 * export const Route = createFileRoute('/users/$userId')({
 *   // Types are fully preserved - params.userId is typed as string
 *   loader: traceLoader(async ({ params }) => {
 *     return await db.users.findUnique({ where: { id: params.userId } });
 *   }),
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Sync loaders are also supported
 * export const Route = createFileRoute('/static')({
 *   loader: traceLoader(({ context }) => ({
 *     message: `Welcome, ${context.userId}!`,
 *   })),
 * });
 * ```
 */
export function traceLoader<TLoaderFn extends (ctx: any) => any>(
  loaderFn: TLoaderFn,
  config: TraceLoaderConfig = {},
): TLoaderFn {
  const captureParams = config.captureParams ?? true;
  const captureResult = config.captureResult ?? false;

  const wrapped = (context: TanStackContextInternal) => {
    // If we're in the browser, just call the loader without tracing
    // This prevents autotel (which uses Node.js APIs) from being executed in the browser
    if (!isServerSide()) {
      return loaderFn(context);
    }

    const routeId = context?.route?.id || 'unknown';
    const spanName = config.name || `tanstack.loader.${routeId}`;

    // Handle both sync and async loaders
    const result = loaderFn(context);
    const isPromise = result instanceof Promise;

    if (!isPromise) {
      // Sync loader - wrap in trace synchronously
      return trace(spanName, (ctx: TraceContext) => {
        ctx.setAttributes({
          [SPAN_ATTRIBUTES.TANSTACK_TYPE]: 'loader',
          [SPAN_ATTRIBUTES.TANSTACK_LOADER_ROUTE_ID]: routeId,
          [SPAN_ATTRIBUTES.TANSTACK_LOADER_TYPE]: 'loader',
        });

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

        if (captureResult && result !== undefined) {
          try {
            ctx.setAttribute('tanstack.loader.result', JSON.stringify(result));
          } catch {
            ctx.setAttribute('tanstack.loader.result', '[non-serializable]');
          }
        }

        ctx.setStatus({ code: SpanStatusCode.OK });
        return result;
      });
    }

    // Async loader
    return trace(spanName, async (ctx: TraceContext) => {
      ctx.setAttributes({
        [SPAN_ATTRIBUTES.TANSTACK_TYPE]: 'loader',
        [SPAN_ATTRIBUTES.TANSTACK_LOADER_ROUTE_ID]: routeId,
        [SPAN_ATTRIBUTES.TANSTACK_LOADER_TYPE]: 'loader',
      });

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
        const asyncResult = await result;

        if (captureResult && asyncResult !== undefined) {
          try {
            ctx.setAttribute(
              'tanstack.loader.result',
              JSON.stringify(asyncResult),
            );
          } catch {
            ctx.setAttribute('tanstack.loader.result', '[non-serializable]');
          }
        }

        ctx.setStatus({ code: SpanStatusCode.OK });
        return asyncResult;
      } catch (error) {
        ctx.recordException(error as Error);
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: (error as Error).message,
        });
        throw error;
      }
    });
  };

  return wrapped as TLoaderFn;
}

/**
 * Wrap a TanStack route beforeLoad function with OpenTelemetry tracing
 *
 * This function wraps a beforeLoad function to automatically create spans.
 * beforeLoad runs before the route component renders and is typically
 * used for auth checks, redirects, or data prefetching.
 *
 * The generic type TBeforeLoadFn preserves the full TanStack Router type inference,
 * including typed params, context, search, and return types.
 *
 * @param beforeLoadFn - The beforeLoad function to wrap
 * @param config - Configuration options
 * @returns Wrapped beforeLoad function with tracing (preserves original types)
 *
 * @example
 * ```typescript
 * import { createFileRoute, redirect } from '@tanstack/react-router';
 * import { traceBeforeLoad } from 'autotel-tanstack/loaders';
 *
 * export const Route = createFileRoute('/dashboard')({
 *   // Types are fully preserved - context, params, search are all typed
 *   beforeLoad: traceBeforeLoad(async ({ context, params }) => {
 *     if (!context.auth.isAuthenticated) {
 *       throw redirect({ to: '/login' });
 *     }
 *     return { userId: params.userId }; // Return type flows to loader context
 *   }),
 *   loader: ({ context }) => {
 *     // context.userId is typed from beforeLoad return
 *     return { user: context.userId };
 *   },
 * });
 * ```
 */
export function traceBeforeLoad<TBeforeLoadFn extends (opts: any) => any>(
  beforeLoadFn: TBeforeLoadFn,
  config: TraceLoaderConfig = {},
): TBeforeLoadFn {
  const captureParams = config.captureParams ?? true;

  const wrapped = (input: TanStackContextInternal) => {
    // Skip tracing in browser
    if (!isServerSide()) {
      return beforeLoadFn(input);
    }

    const routeId = input?.route?.id || 'unknown';
    const spanName = config.name || `tanstack.beforeLoad.${routeId}`;

    // Handle both sync and async beforeLoad
    const result = beforeLoadFn(input);
    const isPromise = result instanceof Promise;

    if (!isPromise) {
      // Sync beforeLoad
      return trace(spanName, (ctx: TraceContext) => {
        ctx.setAttributes({
          [SPAN_ATTRIBUTES.TANSTACK_TYPE]: 'beforeLoad',
          [SPAN_ATTRIBUTES.TANSTACK_LOADER_ROUTE_ID]: routeId,
          [SPAN_ATTRIBUTES.TANSTACK_LOADER_TYPE]: 'beforeLoad',
        });

        if (captureParams && input?.params) {
          try {
            ctx.setAttribute(
              SPAN_ATTRIBUTES.TANSTACK_LOADER_PARAMS,
              JSON.stringify(input.params),
            );
          } catch {
            ctx.setAttribute(
              SPAN_ATTRIBUTES.TANSTACK_LOADER_PARAMS,
              '[non-serializable]',
            );
          }
        }

        ctx.setStatus({ code: SpanStatusCode.OK });
        return result;
      });
    }

    // Async beforeLoad
    return trace(spanName, async (ctx: TraceContext) => {
      ctx.setAttributes({
        [SPAN_ATTRIBUTES.TANSTACK_TYPE]: 'beforeLoad',
        [SPAN_ATTRIBUTES.TANSTACK_LOADER_ROUTE_ID]: routeId,
        [SPAN_ATTRIBUTES.TANSTACK_LOADER_TYPE]: 'beforeLoad',
      });

      if (captureParams && input?.params) {
        try {
          ctx.setAttribute(
            SPAN_ATTRIBUTES.TANSTACK_LOADER_PARAMS,
            JSON.stringify(input.params),
          );
        } catch {
          ctx.setAttribute(
            SPAN_ATTRIBUTES.TANSTACK_LOADER_PARAMS,
            '[non-serializable]',
          );
        }
      }

      try {
        const asyncResult = await result;
        ctx.setStatus({ code: SpanStatusCode.OK });
        return asyncResult;
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
    });
  };

  return wrapped as TBeforeLoadFn;
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
    loader<TLoaderFn extends (ctx: any) => any>(
      loaderFn: TLoaderFn,
    ): TLoaderFn {
      return traceLoader(loaderFn, {
        ...config,
        name: `tanstack.loader.${routeId}`,
      });
    },

    /**
     * Wrap a beforeLoad function with tracing
     */
    beforeLoad<TBeforeLoadFn extends (opts: any) => any>(
      beforeLoadFn: TBeforeLoadFn,
    ): TBeforeLoadFn {
      return traceBeforeLoad(beforeLoadFn, {
        ...config,
        name: `tanstack.beforeLoad.${routeId}`,
      });
    },
  };
}
