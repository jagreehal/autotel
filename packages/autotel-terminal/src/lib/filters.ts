import type { TerminalSpanEvent } from '../span-stream';

export interface AvailableFilters {
  serviceNames: string[];
  routes: string[];
  statusCodes: number[];
}

export interface SpanFilterState {
  serviceName?: string;
  route?: string;
  statusGroup?: 'all' | '2xx' | '4xx' | '5xx';
  errorsOnly?: boolean;
  searchQuery?: string;
  traceId?: string;
}

function getServiceName(span: TerminalSpanEvent): string | undefined {
  const attrs = span.attributes ?? {};
  return (attrs['service.name'] as string | undefined) ?? undefined;
}

function getRoute(span: TerminalSpanEvent): string | undefined {
  const attrs = span.attributes ?? {};
  return (attrs['http.route'] as string | undefined) ?? undefined;
}

function getStatusCode(span: TerminalSpanEvent): number | undefined {
  const attrs = span.attributes ?? {};
  const code = attrs['http.status_code'];
  if (typeof code === 'number') return code;
  if (typeof code === 'string') {
    const n = Number(code);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function deriveAvailableFilters(
  spans: TerminalSpanEvent[],
): AvailableFilters {
  const serviceSet = new Set<string>();
  const routeSet = new Set<string>();
  const statusSet = new Set<number>();

  for (const span of spans) {
    const svc = getServiceName(span);
    if (svc) serviceSet.add(svc);
    const route = getRoute(span);
    if (route) routeSet.add(route);
    const status = getStatusCode(span);
    if (typeof status === 'number') statusSet.add(status);
  }

  return {
    serviceNames: [...serviceSet].toSorted(),
    routes: [...routeSet].toSorted(),
    statusCodes: [...statusSet].toSorted((a, b) => a - b),
  };
}

export function applySpanFilters(
  spans: TerminalSpanEvent[],
  state: SpanFilterState,
): TerminalSpanEvent[] {
  const { serviceName, route, statusGroup, errorsOnly, searchQuery, traceId } =
    state;
  const q = searchQuery?.trim().toLowerCase() ?? '';

  return spans.filter((span) => {
    const attrs = span.attributes ?? {};

    if (traceId && span.traceId !== traceId) return false;

    if (errorsOnly && span.status !== 'ERROR') return false;

    if (serviceName) {
      const svc = getServiceName(span);
      if (svc !== serviceName) return false;
    }

    if (route) {
      const r = getRoute(span);
      if (r !== route) return false;
    }

    if (statusGroup && statusGroup !== 'all') {
      const code = getStatusCode(span);
      if (!code) return false;
      if (statusGroup === '2xx' && (code < 200 || code >= 300)) return false;
      if (statusGroup === '4xx' && (code < 400 || code >= 500)) return false;
      if (statusGroup === '5xx' && (code < 500 || code >= 600)) return false;
    }

    if (q) {
      const nameMatch = span.name.toLowerCase().includes(q);
      const attrMatch = Object.entries(attrs).some(([k, v]) =>
        `${k}:${String(v)}`.toLowerCase().includes(q),
      );
      if (!nameMatch && !attrMatch) return false;
    }

    return true;
  });
}
