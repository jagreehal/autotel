import type { TerminalSpanEvent } from '../span-stream';

export interface ServiceStats {
  serviceName: string;
  total: number;
  errors: number;
  avgMs: number;
  p95Ms: number;
}

export interface HotSpan {
  name: string;
  avgMs: number;
  p95Ms: number;
  count: number;
}

export interface RouteStats {
  route: string;
  total: number;
  errors: number;
  avgMs: number;
  p95Ms: number;
}

export function computeServiceStats(
  spans: TerminalSpanEvent[],
): ServiceStats[] {
  const byService = new Map<
    string,
    { durations: number[]; total: number; errors: number }
  >();

  for (const span of spans) {
    const attrs = span.attributes ?? {};
    const serviceName = (attrs['service.name'] as string | undefined) ?? 'unknown';
    const entry = byService.get(serviceName) ?? {
      durations: [],
      total: 0,
      errors: 0,
    };
    entry.total += 1;
    entry.durations.push(span.durationMs);
    if (span.status === 'ERROR') entry.errors += 1;
    byService.set(serviceName, entry);
  }

  const stats: ServiceStats[] = [];
  for (const [serviceName, { durations, total, errors }] of byService) {
    if (total === 0) continue;
    const avgMs = durations.reduce((a, d) => a + d, 0) / durations.length;
    const sorted = durations.toSorted((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p95Ms = sorted[p95Index] ?? sorted.at(-1) ?? 0;
    stats.push({ serviceName, total, errors, avgMs, p95Ms });
  }

  stats.sort((a, b) => b.total - a.total);
  return stats;
}

export function computeRouteStats(
  spans: TerminalSpanEvent[],
): RouteStats[] {
  const byRoute = new Map<
    string,
    { durations: number[]; total: number; errors: number }
  >();

  for (const span of spans) {
    const attrs = span.attributes ?? {};
    const route = (attrs['http.route'] as string | undefined) ?? null;
    if (!route) continue;

    const entry = byRoute.get(route) ?? {
      durations: [],
      total: 0,
      errors: 0,
    };
    entry.total += 1;
    entry.durations.push(span.durationMs);
    if (span.status === 'ERROR') entry.errors += 1;
    byRoute.set(route, entry);
  }

  const stats: RouteStats[] = [];
  for (const [route, { durations, total, errors }] of byRoute) {
    if (total === 0) continue;
    const avgMs = durations.reduce((a, d) => a + d, 0) / durations.length;
    const sorted = durations.toSorted((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p95Ms = sorted[p95Index] ?? sorted.at(-1) ?? 0;
    stats.push({ route, total, errors, avgMs, p95Ms });
  }

  stats.sort((a, b) => b.total - a.total);
  return stats;
}

export function findHotSpanNames(
  spans: TerminalSpanEvent[],
  topN: number,
): HotSpan[] {
  const byName = new Map<string, number[]>();
  for (const span of spans) {
    const list = byName.get(span.name) ?? [];
    list.push(span.durationMs);
    byName.set(span.name, list);
  }

  const hot: HotSpan[] = [];
  for (const [name, durations] of byName) {
    if (durations.length === 0) continue;
    const avgMs = durations.reduce((a, d) => a + d, 0) / durations.length;
    const sorted = durations.toSorted((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p95Ms = sorted[p95Index] ?? sorted.at(-1) ?? 0;
    hot.push({ name, avgMs, p95Ms, count: durations.length });
  }

  hot.sort((a, b) => b.p95Ms - a.p95Ms);
  return hot.slice(0, topN);
}

