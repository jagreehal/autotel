/**
 * Trace wire codec: what the server sends and the widget rehydrates.
 *
 * Plain TypeScript shared by both halves, like `src/query`. No `node:` imports
 * and no DOM, so the widget can bundle it.
 *
 * **Only `endTime` is dropped, and that is a measured choice.** The read
 * surface is gzipped (see `sendJson`), which already removes what a
 * scope-and-resource dedupe would remove: measured against a 4,891-span trace,
 * deduping scopes is 6% *worse* once deflate runs, dropping the repeated trace
 * id buys 2%, and a start-time offset buys nothing. `endTime` is the one field
 * that still wins, at 32%, because it is a distinct high-entropy number per
 * span that deflate cannot fold away.
 *
 * A start-time offset was also rejected on correctness, not only size: spans
 * merge into a trace across batches here, so a payload carrying offsets
 * against one baseline could be merged into a view built on another.
 */

import type { SpanData, TraceData } from '../server/types';

/** A span as sent: `endTime` present only when `duration` cannot reproduce it. */
export type WireSpan = Omit<SpanData, 'endTime'> & { endTime?: number };

/** A trace as sent. `rootSpan` stays whole; deduping it measured at 0%. */
export type WireTrace = Omit<TraceData, 'endTime' | 'spans' | 'rootSpan'> & {
  endTime?: number;
  spans: WireSpan[];
  rootSpan: WireSpan;
};

/**
 * Drop an end time the start and duration already imply.
 *
 * Ingest always sets `duration` to `endTime - startTime`, so in practice this
 * drops every one. It is written as a condition rather than an assumption
 * because an embedder calling `ingestTraces` directly is bound by no such
 * invariant, and a silently wrong `endTime` draws a waterfall bar of the wrong
 * width rather than failing.
 */
function encodeTimes<
  T extends { startTime: number; endTime: number; duration: number },
>(value: T): Omit<T, 'endTime'> & { endTime?: number } {
  const { endTime, ...rest } = value;
  return endTime === value.startTime + value.duration
    ? rest
    : { ...rest, endTime };
}

function decodeTimes<
  T extends { startTime?: number; duration?: number; endTime?: number },
>(value: T): Omit<T, 'endTime'> & { endTime: number } {
  return {
    ...value,
    endTime: value.endTime ?? (value.startTime ?? 0) + (value.duration ?? 0),
  };
}

export function encodeTrace(trace: TraceData): WireTrace {
  return {
    ...encodeTimes(trace),
    rootSpan: encodeTimes(trace.rootSpan),
    spans: trace.spans.map(encodeTimes),
  };
}

/**
 * Rebuild a trace from the wire.
 *
 * Defensive about `spans` and `rootSpan` because this is a trust boundary: it
 * parses whatever answered on the port, and a decode that throws would blank
 * the list rather than showing one odd trace. The encoder above always writes
 * both.
 */
export function decodeTrace(wire: WireTrace): TraceData {
  const spans = Array.isArray(wire.spans) ? wire.spans.map(decodeTimes) : [];
  return {
    ...decodeTimes(wire),
    rootSpan: wire.rootSpan ? decodeTimes(wire.rootSpan) : spans[0],
    spans,
  } as TraceData;
}

export const encodeTraces = (traces: TraceData[]): WireTrace[] =>
  traces.map(encodeTrace);

export const decodeTraces = (wire: WireTrace[]): TraceData[] =>
  wire.map(decodeTrace);
