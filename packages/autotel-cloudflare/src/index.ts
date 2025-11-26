/**
 * autotel-cloudflare
 *
 * The #1 OpenTelemetry package for Cloudflare Workers
 *
 * Features:
 * - Native Cloudflare OTel integration (works with wrangler.toml destinations)
 * - Complete bindings coverage (KV, R2, D1, DO, AI, Vectorize, etc.)
 * - Multiple API styles (instrument, wrapModule, functional)
 * - Advanced sampling strategies
 * - Events integration
 * - Zero vendor lock-in (OTLP compatible)
 *
 * @example Quick Start
 * ```typescript
 * import { wrapModule, trace } from 'autotel-cloudflare'
 *
 * const processOrder = trace(async (orderId: string) => {
 *   const order = await env.ORDERS_KV.get(orderId)
 *   return order
 * })
 *
 * export default wrapModule(
 *   {
 *     service: { name: 'my-worker' },
 *     instrumentBindings: true,
 *     sampling: 'adaptive'
 *   },
 *   {
 *     async fetch(req, env, ctx) {
 *       return Response.json(await processOrder('123'))
 *     }
 *   }
 * )
 * ```
 */

// Re-export EVERYTHING from autotel-edge (vendor-agnostic foundation)
export * from 'autotel-edge';

// Cloudflare-specific wrappers
export { instrument, wrapModule, wrapDurableObject } from './wrappers';

// Cloudflare-specific handlers
export { instrumentDO, instrumentWorkflow } from './handlers';

// Cloudflare-specific bindings
export {
  instrumentKV,
  instrumentR2,
  instrumentD1,
  instrumentServiceBinding,
  instrumentBindings,
} from './bindings';

// Global instrumentations
export { instrumentGlobalFetch, instrumentGlobalCache } from './global';
