/**
 * workers-honeycomb-logger style wrapper API
 *
 * @example
 * ```typescript
 * import { wrapModule } from 'autotel-cloudflare'
 *
 * const handler = {
 *   async fetch(req, env, ctx) {
 *     return new Response('Hello')
 *   }
 * }
 *
 * export default wrapModule(
 *   { service: { name: 'my-worker' } },
 *   handler
 * )
 * ```
 */

import { instrument } from './instrument';
import type { ConfigurationOption } from 'autotel-edge';

/**
 * Wrap a Cloudflare Workers module-style handler
 * Alternative API style inspired by workers-honeycomb-logger
 *
 * @param config Configuration (can be static object or function)
 * @param handler The worker handler to wrap
 * @returns Instrumented handler
 */
export function wrapModule<E, Q = any, C = any>(
  config: ConfigurationOption,
  handler: ExportedHandler<E, Q, C>,
): ExportedHandler<E, Q, C> {
  return instrument(handler, config);
}
