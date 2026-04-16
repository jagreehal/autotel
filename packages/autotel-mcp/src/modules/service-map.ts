import type { TraceRecord } from '../types.js';

export interface ServiceMapEdge {
  source: string;
  target: string;
  calls: number;
  errors: number;
  avgDurationMs: number;
  p95DurationMs: number;
}

export interface ServiceMapNode {
  service: string;
  traces: number;
  spans: number;
  errors: number;
  inboundCalls: number;
  outboundCalls: number;
  avgDurationMs: number;
  errorRate: number;
}

export interface ServiceMap {
  nodes: ServiceMapNode[];
  edges: ServiceMapEdge[];
}

export function buildServiceMap(
  traces: TraceRecord[],
  limit?: number,
): ServiceMap {
  const nodeStats = new Map<
    string,
    {
      traces: number;
      spans: number;
      errors: number;
      inboundCalls: number;
      outboundCalls: number;
      totalDurationMs: number;
    }
  >();
  const edgeStats = new Map<
    string,
    {
      calls: number;
      errors: number;
      totalDurationMs: number;
      durations: number[];
    }
  >();

  for (const trace of traces) {
    const traceServices = new Set<string>();
    const spansById = new Map(trace.spans.map((span) => [span.spanId, span]));

    for (const span of trace.spans) {
      const current = nodeStats.get(span.serviceName) ?? {
        traces: 0,
        spans: 0,
        errors: 0,
        inboundCalls: 0,
        outboundCalls: 0,
        totalDurationMs: 0,
      };
      current.spans += 1;
      current.errors += span.hasError ? 1 : 0;
      current.totalDurationMs += span.durationMs;
      if (!traceServices.has(span.serviceName)) {
        current.traces += 1;
        traceServices.add(span.serviceName);
      }
      nodeStats.set(span.serviceName, current);
    }

    for (const span of trace.spans) {
      if (!span.parentSpanId) continue;
      const parent = spansById.get(span.parentSpanId);
      if (!parent) continue;

      const sourceStats = nodeStats.get(parent.serviceName) ?? {
        traces: 0,
        spans: 0,
        errors: 0,
        inboundCalls: 0,
        outboundCalls: 0,
        totalDurationMs: 0,
      };
      sourceStats.outboundCalls += 1;
      nodeStats.set(parent.serviceName, sourceStats);

      const targetStats = nodeStats.get(span.serviceName) ?? {
        traces: 0,
        spans: 0,
        errors: 0,
        inboundCalls: 0,
        outboundCalls: 0,
        totalDurationMs: 0,
      };
      targetStats.inboundCalls += 1;
      nodeStats.set(span.serviceName, targetStats);

      const key = `${parent.serviceName}=>${span.serviceName}`;
      const current = edgeStats.get(key) ?? {
        calls: 0,
        errors: 0,
        totalDurationMs: 0,
        durations: [] as number[],
      };
      current.calls += 1;
      current.errors += span.hasError ? 1 : 0;
      current.totalDurationMs += span.durationMs;
      current.durations.push(span.durationMs);
      edgeStats.set(key, current);
    }
  }

  const allNodes = Array.from(nodeStats, ([serviceName, value]) => ({
    service: serviceName,
    traces: value.traces,
    spans: value.spans,
    errors: value.errors,
    inboundCalls: value.inboundCalls,
    outboundCalls: value.outboundCalls,
    avgDurationMs: value.spans
      ? Math.round(value.totalDurationMs / value.spans)
      : 0,
    errorRate: value.spans
      ? Number((value.errors / value.spans).toFixed(3))
      : 0,
  })).sort((a, b) => b.outboundCalls - a.outboundCalls || b.traces - a.traces);

  const nodes = limit != null ? allNodes.slice(0, limit) : allNodes;
  const includedServices = new Set(nodes.map((n) => n.service));

  const edges = Array.from(edgeStats, ([key, value]) => {
    const [source = 'unknown', target = 'unknown'] = key.split('=>');
    const durations = [...value.durations].sort((a, b) => a - b);
    return {
      source,
      target,
      calls: value.calls,
      errors: value.errors,
      avgDurationMs: value.calls
        ? Math.round(value.totalDurationMs / value.calls)
        : 0,
      p95DurationMs: percentile(durations, 0.95),
    };
  })
    .filter(
      (e) => includedServices.has(e.source) && includedServices.has(e.target),
    )
    .sort((a, b) => b.calls - a.calls);

  return { nodes, edges };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.ceil(values.length * p) - 1),
  );
  return values[index] ?? 0;
}
