/**
 * Browser stub for handlers module
 *
 * Handler wrapping only applies on the server side.
 * In browser, we just return the handler unchanged.
 */

import type { WrapStartHandlerConfig } from './types';

/**
 * Handler type
 */
export type StartHandler<T = unknown> = (request: Request) => Promise<T>;

/**
 * Browser stub: Returns the handler unchanged
 */
export function wrapStartHandler<T>(
  config?: WrapStartHandlerConfig,
): (handler: StartHandler<T>) => StartHandler<T> {
  void config;
  return (handler) => handler;
}
