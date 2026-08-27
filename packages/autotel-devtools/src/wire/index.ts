/**
 * The trace wire codec, as a public surface.
 *
 * **The rule: the server answers in full and streams compact.** Every HTTP
 * response carries a complete trace, so anything you can `curl` needs nothing
 * from this module. The WebSocket stream is the one place a field is left off,
 * because it is continuous, high-volume, and normally read by a widget shipped
 * from the same binary.
 *
 * That leaves one case worth exporting for: writing your own `/ws` client.
 * `decodeTraces` turns what arrives into ordinary `TraceData`, so a custom
 * client is one call away from the shape every other surface already hands
 * back, rather than reverse-engineering which fields can be absent.
 *
 * ```ts
 * import { decodeTraces } from 'autotel-devtools/wire';
 *
 * ws.addEventListener('message', (event) => {
 *   const data = JSON.parse(event.data);
 *   const traces = decodeTraces(data.traces ?? []);
 * });
 * ```
 */

export { encodeTrace, decodeTrace, encodeTraces, decodeTraces } from './wire';
export type { WireSpan, WireTrace } from './wire';
