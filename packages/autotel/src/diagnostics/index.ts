/**
 * `autotel/diagnostics` — bridges between Node's `diagnostics_channel` and
 * autotel spans/events.
 *
 * - {@link subscribeChannel} / {@link subscribeTracingChannel}: the edge-safe
 *   primitive for subscribing to any named or tracing channel.
 * - {@link captureConsole}: turn `console.*` calls into correlated wide events,
 *   patch-free.
 * - {@link instrumentHttp}: emit HTTP server/client spans with W3C propagation
 *   from Node's HTTP channels (opt-in, no `import-in-the-middle`).
 *
 * Every entry point is opt-in and degrades to a no-op on runtimes without the
 * underlying channel support.
 */

export {
  subscribeChannel,
  subscribeTracingChannel,
  diagnosticsChannelAvailable,
} from './channel.js';
export type {
  ChannelMessageHandler,
  TracingChannelHandlers,
} from './channel.js';
export { captureConsole } from './console.js';
export type { CaptureConsoleOptions, ConsoleLevel } from './console.js';
export { instrumentHttp } from './http.js';
export type { InstrumentHttpOptions } from './http.js';
