/**
 * Where browser events go.
 *
 * OpenTelemetry events are **log records**, not spans. A zero-duration span
 * named `browser.web_vital` is invisible to every log and event dashboard, and
 * turns up in trace search as noise — so the names this package emits reach the
 * log pipeline instead, and the repository's "emit events through the Logs API
 * model" direction holds here as it does everywhere else.
 *
 * The sink is injected rather than imported because the modules that emit
 * events (`session`, `web-vitals`, `frustration`, …) are also read *by* the
 * exporter, and importing it back would make the cycle real. `init()` and
 * `initFull()` install it; without one, emitting is a no-op, which is the right
 * behaviour for an app that configured no endpoint.
 */

/** Attribute values an OTLP log record can carry. */
export type EventAttributes = Record<string, string | number | boolean>;

export type EventSink = (name: string, attributes: EventAttributes) => void;

let sink: EventSink | undefined;

/** Install (or clear) the destination for browser events. */
export function setEventSink(fn: EventSink | undefined): void {
  sink = fn;
}

/**
 * Emit one event. Never throws: an event describes something the application
 * did, and must not become the reason that thing fails.
 */
export function emitEvent(name: string, attributes: EventAttributes): void {
  if (!sink) return;
  try {
    sink(name, attributes);
  } catch {
    // A failed export is not the caller's problem.
  }
}

/** @internal Reset for testing */
export function resetEventSinkForTesting(): void {
  sink = undefined;
}
