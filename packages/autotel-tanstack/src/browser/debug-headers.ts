/**
 * Browser stub for debug-headers module
 *
 * Debug headers are server-side only.
 * In browser, this returns pass-through middleware.
 */

import type { DebugHeadersConfig } from '../debug-headers';

/**
 * Browser stub: Returns pass-through middleware
 */
// oxlint-disable-next-line typescript/no-explicit-any -- Same TanStack createMiddleware().server() adapter shape as the server build.
type ServerMiddleware = (opts: any) => any;

export function debugHeadersMiddleware(
  _config?: DebugHeadersConfig,
): ServerMiddleware {
  // oxlint-disable-next-line typescript/no-explicit-any -- Same adapter boundary.
  return async function noopMiddleware(opts: any) {
    return opts.next();
  };
}
