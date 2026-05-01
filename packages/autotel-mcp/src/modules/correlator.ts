import type { SpanRecord, TraceRecord } from '../types';

export interface RootCauseResult {
  bottleneck: SpanRecord;
  reason: string;
  percentOfTrace: number;
  path: string[]; // e.g. ["gateway/GET /api", "db/query"]
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
    // No errors — pick slowest span by duration, preferring non-root spans
    // (root duration includes all children, so children represent the real bottleneck)
    const nonRootSpans = spans.filter((s) => s.spanId !== rootSpan.spanId);
    const candidates = nonRootSpans.length > 0 ? nonRootSpans : spans;
    const sorted = [...candidates].sort((a, b) => b.durationMs - a.durationMs);
    bottleneck = sorted[0];
    reason = `Span "${bottleneck.operationName}" in service "${bottleneck.serviceName}" is the slowest span at ${bottleneck.durationMs}ms`;
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

  return { bottleneck, reason, percentOfTrace, path };
}
