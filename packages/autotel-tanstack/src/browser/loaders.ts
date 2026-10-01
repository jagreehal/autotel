/**
 * Browser stub for loaders module
 *
 * In browser environments, these functions are no-ops that just call the
 * original functions without any tracing overhead.
 */

import type { TraceLoaderConfig } from './types';

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
 * Browser stub: Runs the loader logic untraced
 */
export function traceLoader<TContext extends LoaderContext, TResult>(
  context: TContext,
  loaderFn: (context: TContext) => TResult,
  config?: TraceLoaderConfig,
): TResult {
  void config;
  return loaderFn(context);
}

/**
 * Browser stub: Runs the beforeLoad logic untraced
 */
export function traceBeforeLoad<TContext extends LoaderContext, TResult>(
  context: TContext,
  beforeLoadFn: (context: TContext) => TResult,
  config?: TraceLoaderConfig,
): TResult {
  void config;
  return beforeLoadFn(context);
}

/**
 * Browser stub: Returns object with untraced runners
 */
export function createTracedRoute(
  routeId: string,
  config?: Omit<TraceLoaderConfig, 'name'>,
) {
  void routeId;
  void config;
  return {
    loader<TContext extends LoaderContext, TResult>(
      context: TContext,
      loaderFn: (context: TContext) => TResult,
    ): TResult {
      return loaderFn(context);
    },
    beforeLoad<TContext extends LoaderContext, TResult>(
      context: TContext,
      beforeLoadFn: (context: TContext) => TResult,
    ): TResult {
      return beforeLoadFn(context);
    },
  };
}
