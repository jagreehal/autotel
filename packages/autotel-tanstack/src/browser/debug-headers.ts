/**
 * Browser stub for debug-headers module
 *
 * Debug headers are server-side only.
 * In browser, this returns pass-through middleware.
 */

import type { MiddlewareHandler } from './middleware';

/**
 * Browser stub: Returns pass-through middleware
 */
export function debugHeadersMiddleware<
  TContext = unknown,
>(): MiddlewareHandler<TContext> {
  return async function noopMiddleware(opts) {
    return opts.next();
  };
}
