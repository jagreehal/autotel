/**
 * autotel-cloudflare/native
 *
 * Cloudflare native tracing helpers. Most users never need this entry point —
 * the handler wrappers (`instrument`, `wrapModule`, `defineWorkerFetch`,
 * `wrapDurableObject`) auto-detect and wire up native tracing for you. Import
 * from here only when you want to detect native tracing yourself.
 */
export {
  isNativeTracingAvailable,
  getNativeTracerFromCtx,
} from './native/native-tracing';
