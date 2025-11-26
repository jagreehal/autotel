/**
 * Bindings instrumentation for Cloudflare Workers
 * Auto-instrument KV, R2, D1, Service Bindings, and more
 */

export {
  instrumentKV,
  instrumentR2,
  instrumentD1,
  instrumentServiceBinding,
  instrumentBindings,
} from './bindings';
