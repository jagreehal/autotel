import type { SpanRecord, TraceRecord } from '../types';

export interface RootCauseResult {
  bottleneck: SpanRecord;
  reason: string;
  percentOfTrace: number;
  path: string[]; // e.g. ["gateway/GET /api", "db/query"]
  /** The bottleneck's own time, not spent waiting on child spans. */
  selfTimeMs: number;
  /** Where the trace's time actually went, largest self time first. */
  topSelfTime: Array<{
    service: string;
    operation: string;
    spanId: string;
    selfTimeMs: number;
  }>;
}

/**
 * Each span's self time: its duration minus the union of its children's
 * intervals, clipped to its own. A handler that awaits a slow query has a
 * long duration and almost no self time; the query is where the time went.
 */
export function selfTimes(spans: readonly SpanRecord[]): Map<string, number> {
  const children = buildChildMap([...spans]);
  const result = new Map<string, number>();
  for (const span of spans) {
    const start = span.startTimeUnixMs;
    const end = start + span.durationMs;
    const intervals = (children.get(span.spanId) ?? [])
      .map((child): [number, number] => [
        Math.max(start, child.startTimeUnixMs),
        Math.min(end, child.startTimeUnixMs + child.durationMs),
      ])
      .filter(([from, to]) => to > from)
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let cursor = start;
    for (const [from, to] of intervals) {
      if (to <= cursor) continue;
      covered += to - Math.max(from, cursor);
      cursor = to;
    }
    result.set(span.spanId, Math.max(0, span.durationMs - covered));
  }
  return result;
}

function findRootSpan(spans: SpanRecord[]): SpanRecord {
  const rootByParent = spans.find((s) => s.parentSpanId === null);
  if (rootByParent) return rootByParent;
  return spans[0];
}

function buildChildMap(spans: SpanRecord[]): Map<string, SpanRecord[]> {
  const map = new Map<string, SpanRecord[]>();
  for (const span of spans) {
    if (span.parentSpanId !== null) {
      const children = map.get(span.parentSpanId) ?? [];
      children.push(span);
      map.set(span.parentSpanId, children);
    }
  }
  return map;
}

function buildParentMap(spans: SpanRecord[]): Map<string, SpanRecord> {
  const map = new Map<string, SpanRecord>();
  const byId = new Map<string, SpanRecord>(spans.map((s) => [s.spanId, s]));
  for (const span of spans) {
    if (span.parentSpanId !== null) {
      const parent = byId.get(span.parentSpanId);
      if (parent) map.set(span.spanId, parent);
    }
  }
  return map;
}

function buildPathToSpan(
  target: SpanRecord,
  parentMap: Map<string, SpanRecord>,
): string[] {
  const segments: string[] = [];
  let current: SpanRecord | undefined = target;
  while (current) {
    segments.unshift(`${current.serviceName}/${current.operationName}`);
    current = parentMap.get(current.spanId);
  }
  return segments;
}

export function findRootCause(trace: TraceRecord): RootCauseResult {
  const { spans } = trace;

  const rootSpan = findRootSpan(spans);
  const childMap = buildChildMap(spans);
  const parentMap = buildParentMap(spans);

  const errorSpans = spans.filter((s) => s.hasError);
  const self = selfTimes(spans);

  let bottleneck: SpanRecord;
  let reason: string;

  if (errorSpans.length > 0) {
    // Prefer error spans with no error children (origin of the error).
    // Among those, prefer deeper spans (leaf errors), break ties by duration desc.
    const originErrors = errorSpans.filter((s) => {
      const children = childMap.get(s.spanId) ?? [];
      return !children.some((c) => c.hasError);
    });

    const candidates = originErrors.length > 0 ? originErrors : errorSpans;

    // Sort: longest duration first to break ties
    candidates.sort((a, b) => b.durationMs - a.durationMs);

    // Among candidates, prefer the deepest (furthest from root).
    // Compute depth for each candidate.
    function depth(span: SpanRecord): number {
      let d = 0;
      let current: SpanRecord | undefined = span;
      while (current) {
        current = parentMap.get(current.spanId);
        if (current) d++;
      }
      return d;
    }

    candidates.sort((a, b) => {
      const depthDiff = depth(b) - depth(a);
      if (depthDiff !== 0) return depthDiff;
      return b.durationMs - a.durationMs;
    });

    bottleneck = candidates[0];

    const errorMessage =
      bottleneck.tags['error.message'] ??
      bottleneck.tags['exception.message'] ??
      null;

    reason = errorMessage
      ? `Span "${bottleneck.operationName}" in service "${bottleneck.serviceName}" encountered an error: ${errorMessage}`
      : `Span "${bottleneck.operationName}" in service "${bottleneck.serviceName}" reported an error`;
  } else {
    // No errors: the span with the most self time, since a parent's total
    // duration includes its children.
    bottleneck = [...spans].sort(
      (a, b) => (self.get(b.spanId) ?? 0) - (self.get(a.spanId) ?? 0),
    )[0];
    reason = `Span "${bottleneck.operationName}" in service "${bottleneck.serviceName}" spent the most time itself: ${round(self.get(bottleneck.spanId) ?? 0)}ms of its ${round(bottleneck.durationMs)}ms, not waiting on child spans`;
  }

  // Use the trace's wall-clock window (max end - min start) rather than
  // rootSpan.durationMs alone. When the producer doesn't link spans into a
  // single tree (e.g. a buggy backend that drops parent refs, or a workflow
  // that emits multiple roots), rootSpan.durationMs can be much smaller than
  // the bottleneck, which makes the percentage exceed 100% and looks broken.
  const traceStart = Math.min(...spans.map((s) => s.startTimeUnixMs));
  const traceEnd = Math.max(
    ...spans.map((s) => s.startTimeUnixMs + s.durationMs),
  );
  const traceWindowMs = Math.max(traceEnd - traceStart, rootSpan.durationMs);

  const rawPercent =
    traceWindowMs > 0 ? (bottleneck.durationMs / traceWindowMs) * 100 : 0;
  // Clamp to [0, 100] — if it ever exceeds 100 we still return 100 rather than
  // a confusing 2348%, but in practice the wider denominator above prevents it.
  const percentOfTrace = Math.min(100, Math.max(0, rawPercent));

  const path = buildPathToSpan(bottleneck, parentMap);

  const topSelfTime = [...spans]
    .sort((a, b) => (self.get(b.spanId) ?? 0) - (self.get(a.spanId) ?? 0))
    .slice(0, 5)
    .map((span) => ({
      service: span.serviceName,
      operation: span.operationName,
      spanId: span.spanId,
      selfTimeMs: round(self.get(span.spanId) ?? 0),
    }));

  return {
    bottleneck,
    reason,
    percentOfTrace,
    path,
    selfTimeMs: round(self.get(bottleneck.spanId) ?? 0),
    topSelfTime,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
