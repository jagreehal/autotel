/**
 * Browser stub for middleware module
 *
 * In browser environments, these functions return pass-through middleware
 * that just calls next() without any tracing overhead.
 */

import type { TracingMiddlewareConfig } from './types';

/**
 * Generic middleware handler type
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
 * Browser stub: Returns pass-through middleware
 */
export function createTracingMiddleware<TContext = unknown>(
  config?: TracingMiddlewareConfig,
): MiddlewareHandler<TContext> {
  void config;
  return async function noopMiddleware(opts) {
    return opts.next();
  };
}

/**
 * Browser stub: Returns pass-through middleware
 */
export function tracingMiddleware<TContext = unknown>(
  config?: TracingMiddlewareConfig,
): MiddlewareHandler<TContext> {
  void config;
  return async function noopMiddleware(opts) {
    return opts.next();
  };
}

/**
 * Browser stub: Returns pass-through middleware
 */
export function functionTracingMiddleware<TContext = unknown>(
  config?: Omit<TracingMiddlewareConfig, 'type'>,
): MiddlewareHandler<TContext> {
  void config;
  return async function noopMiddleware(opts) {
    return opts.next();
  };
}

/**
 * Browser stub: Returns pass-through handler for createMiddleware().server()
 */
export function createTracingServerHandler<TContext = unknown>(
  config?: TracingMiddlewareConfig,
): (opts: {
  next: (ctx?: Partial<TContext>) => Promise<TContext>;
  context: TContext;
  request?: Request;
}) => Promise<TContext> {
  void config;
  return async function noopHandler(opts) {
    return opts.next();
  };
}
