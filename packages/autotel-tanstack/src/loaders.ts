import { trace } from 'autotel';
import { isServerSide } from './env';
import { isControlFlowSignal, isRealError } from './control-flow';
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
 * One span per loader / beforeLoad call. The route's function runs inside the
 * span, so spans it starts nest under it. trace.run waits for a returned
 * promise, records real errors, and marks redirect()/notFound() OK through
 * isRealError: they are control flow, not failures.
 */
function traceRouteLifecycle<TContext extends TanStackContextInternal, TResult>(
  kind: 'loader' | 'beforeLoad',
  context: TContext,
  fn: (context: TContext) => TResult,
  config: TraceLoaderConfig,
): TResult {
  // In the browser, run untraced: autotel uses Node.js APIs.
  if (!isServerSide()) {
    return fn(context);
  }

  const routeId = context.route?.id || 'unknown';
  return trace.run(
    {
      name: config.name || `tanstack.${kind}.${routeId}`,
      isError: isRealError,
    },
    (ctx) => {
      ctx.setAttributes({
        [SPAN_ATTRIBUTES.TANSTACK_TYPE]: kind,
        [SPAN_ATTRIBUTES.TANSTACK_LOADER_ROUTE_ID]: routeId,
        [SPAN_ATTRIBUTES.TANSTACK_LOADER_TYPE]: kind,
      });
      if ((config.captureParams ?? true) && context.params) {
        ctx.setAttribute(
          SPAN_ATTRIBUTES.TANSTACK_LOADER_PARAMS,
          toJson(context.params),
        );
      }

      const onValue = (value: Awaited<TResult>) => {
        if (kind === 'loader' && config.captureResult && value !== undefined) {
          ctx.setAttribute('tanstack.loader.result', toJson(value));
        }
      };
      const onThrown = (cause: unknown) => {
        if (kind === 'beforeLoad' && isControlFlowSignal(cause)) {
          ctx.setAttribute('tanstack.beforeLoad.redirect', true);
        }
      };

      let result: TResult;
      try {
        result = fn(context);
      } catch (error) {
        onThrown(error);
        throw error;
      }
      // Observe the outcome on a side branch and hand back the caller's own
      // promise; trace.run awaits that one and ends the span after these run.
      if (result instanceof Promise) {
        result.then(onValue, onThrown);
      } else {
        // SAFETY: a result that is not a promise is its own awaited value.
        onValue(result as Awaited<TResult>);
      }
      return result;
    },
  );
}

function toJson<TValue>(value: TValue): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[non-serializable]';
  }
}

/**
 * Trace a TanStack route loader with OpenTelemetry
 *
 * Creates a span per invocation with the route id, params (optionally) and
 * errors. Call it from inside the route's own loader and pass its context
 * through, so TanStack Router keeps typing params and context.
 *
 * @param context - The loader context TanStack passed in
 * @param loaderFn - The loader logic to trace
 * @param config - Configuration options
 * @returns Whatever loaderFn returns
 *
 * @example
 * ```typescript
 * import { createFileRoute } from '@tanstack/react-router';
 * import { traceLoader } from 'autotel-tanstack/loaders';
 *
 * export const Route = createFileRoute('/users/$userId')({
 *   loader: (ctx) =>
 *     traceLoader(ctx, async ({ params }) => {
 *       return await db.users.findUnique({ where: { id: params.userId } });
 *     }),
 * });
 * ```
 */
export function traceLoader<TContext extends TanStackContextInternal, TResult>(
  context: TContext,
  loaderFn: (context: TContext) => TResult,
  config: TraceLoaderConfig = {},
): TResult {
  return traceRouteLifecycle('loader', context, loaderFn, config);
}

/**
 * Trace a TanStack route beforeLoad with OpenTelemetry
 *
 * beforeLoad runs before the route component renders and is typically used
 * for auth checks, redirects, or data prefetching. Call this from inside the
 * route's own beforeLoad and pass its context through. TanStack Router types
 * the context from the function you write, and the return value flows to the
 * loader's context.
 *
 * @param context - The beforeLoad context TanStack passed in
 * @param beforeLoadFn - The beforeLoad logic to trace
 * @param config - Configuration options
 * @returns Whatever beforeLoadFn returns
 *
 * @example
 * ```typescript
 * import { createFileRoute, redirect } from '@tanstack/react-router';
 * import { traceBeforeLoad } from 'autotel-tanstack/loaders';
 *
 * export const Route = createFileRoute('/dashboard')({
 *   beforeLoad: (ctx) =>
 *     traceBeforeLoad(ctx, async ({ context, params }) => {
 *       if (!context.auth.isAuthenticated) {
 *         throw redirect({ to: '/login' });
 *       }
 *       return { userId: params.userId }; // flows to the loader's context
 *     }),
 *   loader: ({ context }) => ({ user: context.userId }),
 * });
 * ```
 */
export function traceBeforeLoad<
  TContext extends TanStackContextInternal,
  TResult,
>(
  context: TContext,
  beforeLoadFn: (context: TContext) => TResult,
  config: TraceLoaderConfig = {},
): TResult {
  return traceRouteLifecycle('beforeLoad', context, beforeLoadFn, config);
}

/**
 * Create a traced route configuration helper
 *
 * This higher-order function helps create route configurations
 * with automatic tracing for both loader and beforeLoad.
 *
 * @param routeId - The route identifier
 * @param config - Tracing configuration
 * @returns Object with loader and beforeLoad tracers named after the route
 *
 * @example
 * ```typescript
 * import { createFileRoute } from '@tanstack/react-router';
 * import { createTracedRoute } from 'autotel-tanstack/loaders';
 *
 * const traced = createTracedRoute('/users/$userId');
 *
 * export const Route = createFileRoute('/users/$userId')({
 *   beforeLoad: (ctx) =>
 *     traced.beforeLoad(ctx, async ({ context }) => {
 *       // Auth check
 *     }),
 *   loader: (ctx) =>
 *     traced.loader(ctx, async ({ params }) => {
 *       return await getUser(params.userId);
 *     }),
 * });
 * ```
 */
export function createTracedRoute(
  routeId: string,
  config: Omit<TraceLoaderConfig, 'name'> = {},
) {
  return {
    /**
     * Trace a loader under this route's span name
     */
    loader<TContext extends TanStackContextInternal, TResult>(
      context: TContext,
      loaderFn: (context: TContext) => TResult,
    ): TResult {
      return traceLoader(context, loaderFn, {
        ...config,
        name: `tanstack.loader.${routeId}`,
      });
    },

    /**
     * Trace a beforeLoad under this route's span name
     */
    beforeLoad<TContext extends TanStackContextInternal, TResult>(
      context: TContext,
      beforeLoadFn: (context: TContext) => TResult,
    ): TResult {
      return traceBeforeLoad(context, beforeLoadFn, {
        ...config,
        name: `tanstack.beforeLoad.${routeId}`,
      });
    },
  };
}
