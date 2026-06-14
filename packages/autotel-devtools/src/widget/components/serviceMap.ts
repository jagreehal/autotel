/**
 * Service-map data layer — pure, framework-agnostic graph construction +
 * Sugiyama layered layout. Extracted from ServiceMapView.svelte so the
 * component stays focused on rendering (and under the 1k-line bar) and this
 * logic is independently unit-testable.
 */
import type { TraceData, SpanData } from '../types';
import { inferResourceName } from '../utils/resources';

/**
 * Service node in the map
 */
export interface ServiceNode {
  id: string;
  name: string;
  requestCount: number;
  errorCount: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  spanKinds: Set<SpanData['kind']>;
  nodeType: 'service' | 'database' | 'messaging' | 'external';
}

/**
 * Connection between services
 */
export interface ServiceConnection {
  id: string;
  source: string;
  target: string;
  requestCount: number;
  errorCount: number;
  avgLatency: number;
  p50Latency: number;
  p99Latency: number;
  latencies: number[];
}

// Sugiyama layout constants
export const NODE_W = 140;
export const NODE_H = 52;
const LAYER_GAP_X = 200;
const NODE_GAP_Y = 70;
const MARGIN = 20;
/**
 * Extract service name from span
 */
function getServiceFromSpan(span: SpanData, traceService: string): string {
  return inferResourceName(span, traceService);
}

/**
 * Detect node type from span attributes
 */
function detectNodeType(span: SpanData): ServiceNode['nodeType'] {
  const attrs = span.attributes || {};
  if (attrs['db.system'] || attrs['db.name'] || attrs['db.statement'])
    return 'database';
  if (
    attrs['messaging.system'] ||
    attrs['messaging.destination'] ||
    attrs['messaging.url']
  )
    return 'messaging';
  if (attrs['rpc.system'] || attrs['rpc.service'] || attrs['peer.service'])
    return 'external';
  return 'service';
}

/**
 * Calculate a percentile from a sorted array
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Build service map from traces
 */
export function buildServiceMap(traces: TraceData[]): {
  nodes: ServiceNode[];
  connections: ServiceConnection[];
} {
  const nodeMap = new Map<string, ServiceNode>();
  const connectionMap = new Map<string, ServiceConnection>();

  for (const trace of traces) {
    const spanMap = new Map<string, SpanData>();
    for (const span of trace.spans) spanMap.set(span.spanId, span);

    for (const span of trace.spans) {
      const serviceName = getServiceFromSpan(span, trace.service);

      // Update or create service node
      let node = nodeMap.get(serviceName);
      if (!node) {
        node = {
          id: serviceName,
          name: serviceName,
          requestCount: 0,
          errorCount: 0,
          avgLatency: 0,
          minLatency: Infinity,
          maxLatency: 0,
          spanKinds: new Set(),
          nodeType: 'service',
        };
        nodeMap.set(serviceName, node);
      }

      node.requestCount++;
      if (span.status.code === 'ERROR') {
        node.errorCount++;
      }
      node.avgLatency =
        (node.avgLatency * (node.requestCount - 1) + span.duration) /
        node.requestCount;
      node.minLatency = Math.min(node.minLatency, span.duration);
      node.maxLatency = Math.max(node.maxLatency, span.duration);
      node.spanKinds.add(span.kind);

      // Upgrade node type if span suggests a more specific type
      const spanType = detectNodeType(span);
      const localServiceName = String(
        span.attributes?.['service.name'] || trace.service || serviceName,
      );
      if (spanType !== 'service' && serviceName !== localServiceName) {
        node.nodeType = spanType;
      }

      // Find connections (CLIENT -> SERVER patterns)
      if (span.kind === 'CLIENT') {
        const childServerSpan = trace.spans.find(
          (candidate) =>
            candidate.parentSpanId === span.spanId && candidate.kind === 'SERVER',
        );
        // The caller is the span's own resource service (service.name /
        // trace.service) — NOT inferResourceName, which would pick up the
        // peer attributes and collapse source into target.
        const callerService = String(
          span.attributes?.['service.name'] || trace.service || serviceName,
        );
        // Look for the target service from attributes
        const targetService =
          (childServerSpan
            ? getServiceFromSpan(childServerSpan, trace.service)
            : undefined) ||
          span.attributes?.['peer.service'] ||
          span.attributes?.['http.host'] ||
          span.attributes?.['db.system'] ||
          span.attributes?.['net.peer.name'] ||
          span.attributes?.['rpc.service'] ||
          span.attributes?.['messaging.system'] ||
          'external';

        // Ensure the caller node exists (it may have no spans of its own).
        if (!nodeMap.has(callerService)) {
          nodeMap.set(callerService, {
            id: callerService,
            name: callerService,
            requestCount: 0,
            errorCount: 0,
            avgLatency: 0,
            minLatency: Infinity,
            maxLatency: 0,
            spanKinds: new Set(),
            nodeType: 'service',
          });
        }

        if (callerService !== targetService) {
          const connId = `${callerService}->${targetService}`;
          let conn = connectionMap.get(connId);
          if (!conn) {
            conn = {
              id: connId,
              source: callerService,
              target: targetService,
              requestCount: 0,
              errorCount: 0,
              avgLatency: 0,
              p50Latency: 0,
              p99Latency: 0,
              latencies: [],
            };
            connectionMap.set(connId, conn);

            // Ensure target node exists with detected type
            if (!nodeMap.has(targetService)) {
              nodeMap.set(targetService, {
                id: targetService,
                name: targetService,
                requestCount: 0,
                errorCount: 0,
                avgLatency: 0,
                minLatency: Infinity,
                maxLatency: 0,
                spanKinds: new Set(),
                nodeType: detectNodeType(span),
              });
            } else {
              // Upgrade target node type
              const target = nodeMap.get(targetService)!;
              const t = detectNodeType(span);
              if (t !== 'service') target.nodeType = t;
            }
          }

          conn.requestCount++;
          if (span.status.code === 'ERROR') {
            conn.errorCount++;
          }
          conn.avgLatency =
            (conn.avgLatency * (conn.requestCount - 1) + span.duration) /
            conn.requestCount;
          conn.latencies.push(span.duration);
          const sortedLatencies = [...conn.latencies].sort((a, b) => a - b);
          conn.p50Latency = percentile(sortedLatencies, 50);
          conn.p99Latency = percentile(sortedLatencies, 99);
        }
      }

      // SERVER spans that indicate incoming requests — use early continues
      // to avoid deep nesting.
      if (span.kind !== 'SERVER' || !span.parentSpanId) continue;
      const parentSpan = spanMap.get(span.parentSpanId);
      if (!parentSpan || parentSpan.kind !== 'CLIENT') continue;
      const sourceService = getServiceFromSpan(parentSpan, trace.service);
      if (sourceService === serviceName) continue;
      const connId = `${sourceService}->${serviceName}`;
      if (connectionMap.has(connId)) continue;

      connectionMap.set(connId, {
        id: connId,
        source: sourceService,
        target: serviceName,
        requestCount: 1,
        errorCount: span.status.code === 'ERROR' ? 1 : 0,
        avgLatency: span.duration,
        p50Latency: span.duration,
        p99Latency: span.duration,
        latencies: [span.duration],
      });
    }
  }

  // Convert to arrays and fix min latency
  const nodes = [...nodeMap.values()].map((node) => ({
    ...node,
    minLatency: node.minLatency === Infinity ? 0 : node.minLatency,
  }));

  const connections = [...connectionMap.values()];

  return { nodes, connections };
}

/**
 * Sugiyama-style layered layout for service graph.
 * Layers: BFS from root nodes, barycenter ordering, coordinate assignment.
 */
export function calculateSugiyamaLayout(
  nodes: ServiceNode[],
  connections: ServiceConnection[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return positions;

  if (nodes.length === 1) {
    positions.set(nodes[0].id, { x: NODE_W + 40, y: NODE_H + 40 });
    return positions;
  }

  const names = nodes.map((n) => n.id);
  const outEdges = new Map<string, string[]>();
  const inEdges = new Map<string, string[]>();
  for (const n of names) {
    outEdges.set(n, []);
    inEdges.set(n, []);
  }
  for (const c of connections) {
    if (outEdges.has(c.source)) outEdges.get(c.source)!.push(c.target);
    if (inEdges.has(c.target)) inEdges.get(c.target)!.push(c.source);
  }

  // Layer assignment via BFS from roots
  const layer = new Map<string, number>();
  const roots = names.filter((n) => (inEdges.get(n)?.length ?? 0) === 0);
  const starts = roots.length > 0 ? roots : names;
  const queue = [...starts];
  for (const r of starts) layer.set(r, 0);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curLayer = layer.get(cur) ?? 0;
    for (const next of outEdges.get(cur) ?? []) {
      const existing = layer.get(next) ?? -1;
      if (existing <= curLayer) {
        layer.set(next, curLayer + 1);
        queue.push(next);
      }
    }
  }
  for (const n of names) {
    if (!layer.has(n)) layer.set(n, 0);
  }

  const maxLayer = Math.max(...Array.from(layer.values()));
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const n of names) layers[layer.get(n)!].push(n);

  // Barycenter ordering (2 passes)
  for (let pass = 0; pass < 2; pass++) {
    for (let l = 1; l <= maxLayer; l++) {
      const prev = layers[l - 1];
      const posMap = new Map<string, number>();
      prev.forEach((n, i) => posMap.set(n, i));
      layers[l].sort((a, b) => {
        const aSources = inEdges.get(a) ?? [];
        const bSources = inEdges.get(b) ?? [];
        const aAvg =
          aSources.length > 0
            ? aSources.reduce((s, p) => s + (posMap.get(p) ?? 0), 0) /
              aSources.length
            : 999;
        const bAvg =
          bSources.length > 0
            ? bSources.reduce((s, p) => s + (posMap.get(p) ?? 0), 0) /
              bSources.length
            : 999;
        return aAvg - bAvg;
      });
    }
  }

  // Coordinate assignment
  const maxNodesInLayer = Math.max(...layers.map((l) => l.length));
  const totalHeight = Math.max(
    maxNodesInLayer * (NODE_H + NODE_GAP_Y) - NODE_GAP_Y,
    NODE_H,
  );

  for (let l = 0; l <= maxLayer; l++) {
    const nodesInLayer = layers[l];
    const layerHeight =
      nodesInLayer.length * (NODE_H + NODE_GAP_Y) - NODE_GAP_Y;
    const startY = (totalHeight - layerHeight) / 2;
    const cx = l * LAYER_GAP_X + NODE_W / 2 + MARGIN;
    nodesInLayer.forEach((n, i) => {
      positions.set(n, {
        x: cx - NODE_W / 2,
        y: startY + i * (NODE_H + NODE_GAP_Y) + MARGIN,
      });
    });
  }

  return positions;
}
