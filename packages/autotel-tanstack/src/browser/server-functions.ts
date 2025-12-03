/**
 * Browser stub for server-functions module
 *
 * In browser environments, these functions are no-ops that just return
 * the original functions without any tracing overhead.
 */

import type { TraceServerFnConfig } from './types';

/**
 * Browser stub: Returns the server function unchanged
 */
export function traceServerFn<
  T extends (...args: unknown[]) => Promise<unknown>,
>(serverFn: T, config?: TraceServerFnConfig): T {
  void config;
  return serverFn;
}

/**
 * Browser stub: Returns the createServerFn unchanged
 */
export function createTracedServerFnFactory<
  TCreateServerFn extends (...args: unknown[]) => unknown,
>(
  createServerFnOriginal: TCreateServerFn,
  defaultConfig?: Omit<TraceServerFnConfig, 'name'>,
): TCreateServerFn {
  void defaultConfig;
  return createServerFnOriginal;
}
