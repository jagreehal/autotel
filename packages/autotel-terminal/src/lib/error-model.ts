import type { TerminalSpanEvent } from '../span-stream';
import type { TraceSummary } from './trace-model';

export interface ErrorSummary {
  traceId: string;
  rootName: string;
  serviceName: string;
  route?: string;
  statusCode?: number;
  errorCount: number;
  lastEndTime: number;
}

function getServiceNameFromSpans(spans: TerminalSpanEvent[]): string {
  for (const span of spans) {
    const svc = span.attributes?.['service.name'];
    if (typeof svc === 'string' && svc.trim()) return svc;
  }
  return 'unknown';
}

function getRouteFromSpans(spans: TerminalSpanEvent[]): string | undefined {
  for (const span of spans) {
    const route = span.attributes?.['http.route'];
    if (typeof route === 'string' && route.trim()) return route;
  }
  return undefined;
}

function getStatusCodeFromSpans(
  spans: TerminalSpanEvent[],
): number | undefined {
  for (const span of spans) {
    const code = span.attributes?.['http.status_code'];
    if (typeof code === 'number') return code;
    if (typeof code === 'string') {
      const n = Number(code);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

export function buildErrorSummaries(
  traceSummaries: TraceSummary[],
): ErrorSummary[] {
  const out: ErrorSummary[] = [];

  for (const t of traceSummaries) {
    const errorSpans = t.spans.filter((s) => s.status === 'ERROR');
    if (errorSpans.length === 0) continue;

    out.push({
      traceId: t.traceId,
      rootName: t.rootName,
      serviceName: getServiceNameFromSpans(t.spans),
      route: getRouteFromSpans(t.spans),
      statusCode: getStatusCodeFromSpans(t.spans),
      errorCount: errorSpans.length,
      lastEndTime: t.lastEndTime,
    });
  }

  out.sort((a, b) => b.lastEndTime - a.lastEndTime);
  return out;
}
