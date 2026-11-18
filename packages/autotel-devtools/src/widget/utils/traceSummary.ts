import type { SpanData, TraceData } from '../types';
import { computeSelfTime } from './spanAnalysis';
import { appAttributes, keyAttributes } from './keyAttributes';

/** A span that spent less than this share of the trace itself is noise in "where the time went". */
const MIN_SELF_TIME_SHARE = 0.01;

export interface TraceSummary {
  /** Services in the order they first appear, with how many spans each emitted. */
  services: Array<{ name: string; spans: number }>;
  errors: SpanData[];
  /**
   * Where the failure started: the first error span with no failing child.
   * Parents marked failed only because a child failed carry no new message.
   */
  errorOrigin: SpanData | undefined;
  /**
   * The spans that spent the most time themselves, not waiting on children,
   * listed in the order they started so they read like the waterfall. Spans
   * under 1% of the trace are left out: a parent's few microseconds around
   * its children is noise next to the step that took seconds.
   */
  slowest: Array<{ span: SpanData; selfTime: number }>;
}

/** What a trace-list hover card says about a trace, in one pass. */
export function summarizeTrace(trace: TraceData, slowest = 3): TraceSummary {
  const children = new Map<string, SpanData[]>();
  const services = new Map<string, number>();
  for (const span of trace.spans) {
    if (span.parentSpanId) {
      const siblings = children.get(span.parentSpanId) ?? [];
      siblings.push(span);
      children.set(span.parentSpanId, siblings);
    }
    const service = String(span.attributes['service.name'] ?? trace.service);
    services.set(service, (services.get(service) ?? 0) + 1);
  }
  const errors = trace.spans.filter((s) => s.status.code === 'ERROR');
  return {
    services: [...services].map(([name, spans]) => ({ name, spans })),
    errors,
    errorOrigin: errors.find(
      (span) =>
        !children.get(span.spanId)?.some((c) => c.status.code === 'ERROR'),
    ),
    slowest: trace.spans
      .map((span) => ({
        span,
        selfTime: computeSelfTime(span, children.get(span.spanId) ?? []),
      }))
      .filter(
        (s) =>
          s.selfTime > 0 && s.selfTime >= trace.duration * MIN_SELF_TIME_SHARE,
      )
      .sort((a, b) => b.selfTime - a.selfTime)
      .slice(0, slowest)
      .sort((a, b) => a.span.startTime - b.span.startTime),
  };
}

/** Which sections the trace-list hover card shows. The card and the list both read this. */
export interface TraceCardSections {
  services: boolean;
  failure: boolean;
  timing: boolean;
  attributes: boolean;
}

export function traceCardSections(
  trace: TraceData,
  summary: TraceSummary = summarizeTrace(trace),
): TraceCardSections {
  const attributes = trace.rootSpan.attributes ?? {};
  return {
    services: summary.services.length > 1,
    failure: summary.errorOrigin !== undefined,
    timing: summary.slowest.length > 0 && trace.spans.length > 1,
    attributes:
      appAttributes(attributes).length > 0 ||
      keyAttributes(attributes).length > 0,
  };
}

/**
 * Whether the hover card has anything to say beyond the name the row already
 * shows. A healthy one-span trace with no notable attributes has nothing, and
 * an empty card is worse than none.
 */
export function hasTraceCardDetails(trace: TraceData): boolean {
  return Object.values(traceCardSections(trace)).some(Boolean);
}
