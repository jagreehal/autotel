import type { SpanRecord, Tags, TagValue, TraceRecord } from '../types';

export interface CompactSpan extends SpanRecord {
  tags: Record<string, TagValue>;
}

export interface CompactTrace {
  traceId: string;
  /** Attributes every span in this trace carried identically. */
  resource: Record<string, TagValue>;
  /** Spans in the trace, even when only the roots are returned. */
  spanCount: number;
  spans: CompactSpan[];
}

export interface CompactTraceResult {
  items: CompactTrace[];
  totalCount: number;
}

/**
 * Attributes that every span carries with the same value: service, host and
 * process identity. They are a property of the trace, not of any one span, and
 * repeating them per span is what makes a 200-span trace unreadable.
 */
function hoistResource(spans: SpanRecord[]): Tags {
  const [first, ...rest] = spans;
  if (first === undefined) return {};

  const shared: Record<string, TagValue> = {};
  for (const [key, value] of Object.entries(first.tags)) {
    if (rest.every((span) => span.tags[key] === value)) {
      shared[key] = value;
    }
  }
  return shared;
}

function withoutResource(
  span: SpanRecord,
  resource: Record<string, TagValue>,
): CompactSpan {
  const tags: Record<string, TagValue> = {};
  for (const [key, value] of Object.entries(span.tags)) {
    if (!(key in resource)) tags[key] = value;
  }
  return { ...span, tags };
}

/**
 * Shape a trace search result for an LLM consumer.
 *
 * A 202-span trace serialised every resource attribute 202 times, which is what
 * pushed one four-trace search past 990,000 characters. Hoisting the shared
 * attributes and letting the caller drop child spans keeps the same search
 * usable on the traces most worth searching.
 */
export interface CompactSpanResult {
  resource: Record<string, TagValue>;
  items: CompactSpan[];
  totalCount: number;
}

/**
 * The same hoist for a flat span search. Spans here can come from different
 * traces, so only what every returned span agrees on moves up.
 */
export function compactSpans(result: {
  items: SpanRecord[];
  totalCount: number;
}): CompactSpanResult {
  const resource = hoistResource(result.items);
  return {
    resource,
    totalCount: result.totalCount,
    items: result.items.map((span) => withoutResource(span, resource)),
  };
}

/**
 * Hoist one trace's shared attributes. Every tool that hands back a whole trace
 * or a span from one repeats the same service, host and process identity on
 * each span; it belongs to the trace, and once is enough.
 */
export function compactTrace(
  trace: TraceRecord,
  options?: { includeSpans: boolean },
): CompactTrace {
  const resource = hoistResource(trace.spans);
  const kept =
    (options?.includeSpans ?? true)
      ? trace.spans
      : trace.spans.filter((span) => span.parentSpanId === null);

  return {
    traceId: trace.traceId,
    resource,
    spanCount: trace.spans.length,
    spans: kept.map((span) => withoutResource(span, resource)),
  };
}

export function compactTraceResult(
  result: { items: TraceRecord[]; totalCount: number },
  // Roots only unless asked otherwise: a search that happens to cross an N+1
  // returns hundreds of spans per trace, and the caller scanning results has
  // no way to know that before making the call.
  options?: { includeSpans: boolean },
): CompactTraceResult {
  const includeSpans = options?.includeSpans ?? false;
  return {
    totalCount: result.totalCount,
    items: result.items.map((trace) => compactTrace(trace, { includeSpans })),
  };
}
