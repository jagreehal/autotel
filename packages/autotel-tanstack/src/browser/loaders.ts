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
 * Browser stub: Returns the loader function unchanged
 */
export function traceLoader<
  T extends (context: LoaderContext) => Promise<unknown>,
>(loaderFn: T, config?: TraceLoaderConfig): T {
  void config;
  return loaderFn;
}

/**
 * Browser stub: Returns the beforeLoad function unchanged
 */
export function traceBeforeLoad<
  T extends (context: LoaderContext) => Promise<unknown>,
>(beforeLoadFn: T, config?: TraceLoaderConfig): T {
  void config;
  return beforeLoadFn;
}

/**
 * Browser stub: Returns object with pass-through wrappers
 */
export function createTracedRoute(
  routeId: string,
  config?: Omit<TraceLoaderConfig, 'name'>,
) {
  void routeId;
  void config;
  return {
    loader<T extends (context: LoaderContext) => Promise<unknown>>(
      loaderFn: T,
    ): T {
      return loaderFn;
    },
    beforeLoad<T extends (context: LoaderContext) => Promise<unknown>>(
      beforeLoadFn: T,
    ): T {
      return beforeLoadFn;
    },
  };
}
