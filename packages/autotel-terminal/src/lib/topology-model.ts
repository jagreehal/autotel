import type { TerminalSpanEvent } from '../span-stream';

export interface ServiceNode {
  serviceName: string;
  spanCount: number;
  errorCount: number;
  avgDurationMs: number;
  p95DurationMs: number;
}

export interface ServiceEdge {
  fromService: string;
  toService: string;
  spanCount: number;
  errorCount: number;
}

export interface ServiceGraph {
  services: ServiceNode[];
  edges: ServiceEdge[];
}

function getServiceName(span: TerminalSpanEvent): string {
  const attrs = span.attributes ?? {};
  const serviceName =
    (attrs['service.name'] as string | undefined) ??
    (attrs['resource.service.name'] as string | undefined);
  return serviceName || 'unknown';
}

function getPeerService(span: TerminalSpanEvent): string | null {
  const attrs = span.attributes ?? {};
  const peerService =
    (attrs['peer.service'] as string | undefined) ??
    (attrs['db.system'] as string | undefined) ??
    (attrs['messaging.system'] as string | undefined) ??
    (attrs['http.host'] as string | undefined);
  return peerService ?? null;
}

export function buildServiceGraph(spans: TerminalSpanEvent[]): ServiceGraph {
  const byService = new Map<
    string,
    { durations: number[]; spanCount: number; errorCount: number }
  >();

  for (const span of spans) {
    const svc = getServiceName(span);
    const entry = byService.get(svc) ?? {
      durations: [],
      spanCount: 0,
      errorCount: 0,
    };
    entry.spanCount += 1;
    entry.durations.push(span.durationMs);
    if (span.status === 'ERROR') entry.errorCount += 1;
    byService.set(svc, entry);
  }

  const services: ServiceNode[] = [];
  for (const [serviceName, { durations, spanCount, errorCount }] of byService) {
    if (spanCount === 0) continue;
    const avgDurationMs =
      durations.reduce((acc, d) => acc + d, 0) / durations.length;
    const sorted = durations.toSorted((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p95DurationMs = sorted[p95Index] ?? sorted.at(-1) ?? 0;
    services.push({
      serviceName,
      spanCount,
      errorCount,
      avgDurationMs,
      p95DurationMs,
    });
  }

  const byEdge = new Map<
    string,
    { spanCount: number; errorCount: number }
  >();

  for (const span of spans) {
    const to = getPeerService(span);
    if (!to) continue;
    const from = getServiceName(span);
    const key = `${from}→${to}`;
    const entry = byEdge.get(key) ?? { spanCount: 0, errorCount: 0 };
    entry.spanCount += 1;
    if (span.status === 'ERROR') entry.errorCount += 1;
    byEdge.set(key, entry);
  }

  const edges: ServiceEdge[] = [];
  for (const [key, { spanCount, errorCount }] of byEdge) {
    const [fromService, toService] = key.split('→');
    edges.push({ fromService, toService, spanCount, errorCount });
  }

  services.sort((a, b) => b.spanCount - a.spanCount);
  edges.sort((a, b) => b.spanCount - a.spanCount);

  return { services, edges };
}

