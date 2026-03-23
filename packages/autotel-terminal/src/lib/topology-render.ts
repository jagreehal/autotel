import type { ServiceGraph, ServiceEdge } from './topology-model';
import { formatDurationMs } from './format';

/**
 * Render a service graph as ASCII lines for terminal display.
 *
 * Layout: root services at top, downstream services below with edges.
 * Recursively traverses the full dependency tree.
 * Each service shows: name, span count, error rate, p95 latency.
 * Each edge shows: call count and error count.
 */
export function renderTopologyAscii(graph: ServiceGraph): string[] {
  if (graph.services.length === 0) {
    return ['  No services detected yet.'];
  }

  // Find root services (not a target of any edge)
  const targetServices = new Set(graph.edges.map((e) => e.toService));
  const roots = graph.services.filter(
    (s) => !targetServices.has(s.serviceName),
  );
  // If no clear roots (cycle), use all services sorted by span count
  const rootList = roots.length > 0 ? roots : [...graph.services];

  const lines: string[] = [];

  for (const root of rootList) {
    renderNode(graph, root.serviceName, '', true, lines, new Set());
  }

  return lines;
}

function renderNode(
  graph: ServiceGraph,
  serviceName: string,
  prefix: string,
  isRoot: boolean,
  lines: string[],
  ancestors: Set<string>,
): void {
  const svc = graph.services.find((s) => s.serviceName === serviceName);
  const label = svc ? formatServiceLine(svc) : `[${serviceName}]`;

  if (isRoot) {
    lines.push(label);
  }

  // Don't recurse into ancestors on the current path (cycle protection)
  if (ancestors.has(serviceName)) return;
  const pathAncestors = new Set(ancestors);
  pathAncestors.add(serviceName);

  const outgoing = graph.edges.filter((e) => e.fromService === serviceName);

  for (let i = 0; i < outgoing.length; i++) {
    const edge = outgoing[i];
    const isLast = i === outgoing.length - 1;
    const connector = isLast ? '└' : '├';
    const childPrefix = isLast ? '    ' : '│   ';
    const downstream = graph.services.find(
      (s) => s.serviceName === edge.toService,
    );
    const edgeLabel = formatEdgeLabel(edge);
    const downstreamLabel = downstream
      ? formatServiceLine(downstream)
      : `[${edge.toService}]`;

    lines.push(`${prefix}    ${connector}──${edgeLabel}──→ ${downstreamLabel}`);

    // Recurse into downstream service
    renderNode(
      graph,
      edge.toService,
      prefix + '    ' + childPrefix,
      false,
      lines,
      pathAncestors,
    );
  }
}

function formatServiceLine(svc: {
  serviceName: string;
  spanCount: number;
  errorCount: number;
  p95DurationMs: number;
}): string {
  const errPart = svc.errorCount > 0 ? ` · ${svc.errorCount} err` : '';
  return `[${svc.serviceName}] ${svc.spanCount} spans${errPart} · p95 ${formatDurationMs(svc.p95DurationMs)}`;
}

function formatEdgeLabel(edge: ServiceEdge): string {
  const errPart = edge.errorCount > 0 ? `, ${edge.errorCount} err` : '';
  return `(${edge.spanCount}${errPart})`;
}
