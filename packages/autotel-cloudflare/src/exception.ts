/**
 * Recording a caught value on a span.
 *
 * A worker can throw anything - a string from a fetch handler, a DOMException
 * from a Workers API, an Error from application code. OpenTelemetry's
 * `recordException` accepts an Error or a description of one, so normalizing
 * here means a non-Error throw is recorded as what it was rather than being
 * asserted into an Error it never was.
 */

/** What `Span.recordException` accepts. */
export type RecordableException = Error | string;

/** The caught value, in a form a span can record. */
export function toException(cause: unknown): RecordableException {
  return cause instanceof Error ? cause : String(cause);
}
