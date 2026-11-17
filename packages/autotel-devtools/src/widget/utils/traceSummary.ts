import type { SpanData, TraceData } from '../types';
import { computeSelfTime } from './spanAnalysis';

export interface TraceSummary {
  /** Services in the order they first appear, with how many spans each emitted. */
  services: Array<{ name: string; spans: number }>;
  errors: SpanData[];
  /**
   * Where the failure started: the first error span with no failing child.
   * Parents marked failed only because a child failed carry no new message.
   */
  errorOrigin: SpanData | undefined;
  /** The spans that spent the most time themselves, not waiting on children. */
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
      .filter((s) => s.selfTime > 0)
      .sort((a, b) => b.selfTime - a.selfTime)
      .slice(0, slowest),
  };
}
