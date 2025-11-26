/**
 * Durable Object wrapper
 *
 * @example
 * ```typescript
 * import { wrapDurableObject } from 'autotel-cloudflare'
 *
 * class Counter implements DurableObject {
 *   async fetch(request: Request) {
 *     return new Response('count')
 *   }
 * }
 *
 * export default wrapDurableObject({ service: { name: 'counter-do' } }, Counter)
 * ```
 */

import { instrumentDO } from '../handlers/durable-objects';
import type { ConfigurationOption } from 'autotel-edge';

/**
 * Wrap a Durable Object class with instrumentation
 * Alternative API style inspired by workers-honeycomb-logger
 *
 * @param config Configuration (can be static object or function)
 * @param doClass The Durable Object class to wrap
 * @returns Instrumented Durable Object class
 */
export function wrapDurableObject<T extends DurableObject>(
  config: ConfigurationOption,
  doClass: new (state: DurableObjectState, env: any) => T,
): new (state: DurableObjectState, env: any) => T {
  return instrumentDO(doClass, config);
}
