<script lang="ts">
  /**
   * Service Map Visualization
   * Shows services as nodes and their connections as edges
   * Highlights error paths and displays latency information
   */

  import { Server, ArrowRight, Activity } from '@lucide/svelte';
  import { cn } from '../utils/cn';
  import { formatDuration } from '../utils';
  import { activateOnKey } from '../utils/keyboard';
  import { tracesSignal } from '../store.svelte';
  import type { TraceData, SpanData } from '../types';
  import { inferResourceName } from '../utils/resources';
  import { serviceColor } from '../utils/serviceColor';

  /**
   * Service node in the map
   */
  interface ServiceNode {
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
  interface ServiceConnection {
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
  const NODE_W = 140;
  const NODE_H = 52;
  const LAYER_GAP_X = 200;
  const NODE_GAP_Y = 70;
  const MARGIN = 20;
  const SVG_MIN_HEIGHT = 'min-height: 300px;';

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
  function buildServiceMap(traces: TraceData[]): {
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
        if (spanType !== 'service') node.nodeType = spanType;

        // Find connections (CLIENT -> SERVER patterns)
        if (span.kind === 'CLIENT') {
          // The caller is the span's own resource service (service.name /
          // trace.service) — NOT inferResourceName, which would pick up the
          // peer attributes and collapse source into target.
          const callerService = String(
            span.attributes?.['service.name'] || trace.service || serviceName,
          );
          // Look for the target service from attributes
          const targetService =
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
  function calculateSugiyamaLayout(
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

  const traces = $derived(tracesSignal.value);
  let selectedNode = $state<string | null>(null);
  let hoveredNode = $state<string | null>(null);

  const map = $derived.by(() => buildServiceMap(traces));
  const nodes = $derived(map.nodes);
  const connections = $derived(map.connections);

  const positions = $derived.by(() =>
    calculateSugiyamaLayout(nodes, connections),
  );

  // Compute viewBox
  const viewWidth = $derived.by(() => {
    let maxX = 400;
    for (const [, pos] of positions) {
      if (pos.x + NODE_W + 20 > maxX) maxX = pos.x + NODE_W + 20;
    }
    return maxX;
  });

  const viewHeight = $derived.by(() => {
    let maxY = 300;
    for (const [, pos] of positions) {
      if (pos.y + NODE_H + 20 > maxY) maxY = pos.y + NODE_H + 20;
    }
    return maxY;
  });

  const selectedNodeData = $derived(
    selectedNode ? (nodes.find((n) => n.id === selectedNode) ?? null) : null,
  );

  const relatedConnections = $derived(
    selectedNode
      ? connections.filter(
          (c) => c.source === selectedNode || c.target === selectedNode,
        )
      : [],
  );
</script>

{#snippet statRow(label: string, value: string, isError = false)}
  <div class="flex justify-between text-xs">
    <span class="text-fg-subtle">{label}</span>
    <span class={cn('font-medium', isError ? 'text-red-600' : 'text-fg')}>
      {value}
    </span>
  </div>
{/snippet}

{#if traces.length === 0}
  <div
    class="flex flex-col items-center justify-center h-full text-fg-subtle p-8"
  >
    <Activity size={48} class="mb-4 opacity-50" />
    <p class="text-sm text-center">
      No traces available to build service map.
      <br />
      Traces will appear here as they are captured.
    </p>
  </div>
{:else if nodes.length === 0}
  <div
    class="flex flex-col items-center justify-center h-full text-fg-subtle p-8"
  >
    <Server size={48} class="mb-4 opacity-50" />
    <p class="text-sm text-center">
      No services detected in traces.
      <br />
      Service information is extracted from span attributes.
    </p>
  </div>
{:else}
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div
      class="px-4 py-3 border-b border-line flex items-center justify-between"
    >
      <h3 class="text-sm font-semibold flex items-center gap-2 text-fg">
        <Activity size={16} />
        Service Map ({nodes.length} services)
      </h3>
      <div class="text-xs text-fg-subtle">
        {connections.length} connections
      </div>
    </div>

    <!-- Map container -->
    <div class="flex-1 overflow-hidden flex">
      <!-- SVG Map -->
      <div class="flex-1 overflow-auto p-4">
        <svg
          viewBox={`0 0 ${viewWidth} ${viewHeight}`}
          class="w-full h-full"
          style={SVG_MIN_HEIGHT}
        >
          <!-- Arrow markers + soft node shadow -->
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
            </marker>
            <marker
              id="arrowhead-error"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="#ef4444" />
            </marker>
            <filter
              id="nodeShadow"
              x="-20%"
              y="-20%"
              width="140%"
              height="140%"
            >
              <feDropShadow
                dx="0"
                dy="1"
                stdDeviation="2"
                flood-color="#0f172a"
                flood-opacity="0.14"
              />
            </filter>
          </defs>

          <!-- Connection lines with bezier curves -->
          {#each connections as conn (conn.id)}
            {@const source = positions.get(conn.source)}
            {@const target = positions.get(conn.target)}
            {#if source && target}
              {@const isHighlighted =
                selectedNode === conn.source || selectedNode === conn.target}
              {@const hasError = conn.errorCount > 0}
              {@const x1 = source.x + NODE_W}
              {@const y1 = source.y + NODE_H / 2}
              {@const x2 = target.x}
              {@const y2 = target.y + NODE_H / 2}
              {@const dx = Math.abs(x2 - x1) * 0.5}
              {@const errorRate =
                conn.requestCount > 0
                  ? (conn.errorCount / conn.requestCount) * 100
                  : 0}
              {@const label = hasError
                ? `${conn.requestCount}× · ${errorRate.toFixed(0)}% err · ${formatDuration(conn.p50Latency)}`
                : `${conn.requestCount}× · ${formatDuration(conn.p50Latency)}`}
              <g>
                <path
                  d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`}
                  fill="none"
                  stroke={hasError ? '#ef4444' : '#94a3b8'}
                  stroke-width={hasError ? 2.5 : isHighlighted ? 2.5 : 1.5}
                  stroke-dasharray={hasError ? '6 4' : undefined}
                  stroke-linecap="round"
                  stroke-opacity={selectedNode && !isHighlighted ? 0.2 : 1}
                  marker-end={`url(#${hasError ? 'arrowhead-error' : 'arrowhead'})`}
                />
                <!-- Edge label — always visible, dimmed when a node is selected elsewhere -->
                <text
                  x={(x1 + x2) / 2}
                  y={(y1 + y2) / 2 - 6}
                  text-anchor="middle"
                  class={cn(
                    'at-edge-label text-[10px]',
                    hasError ? 'fill-red-500 font-medium' : 'fill-gray-500',
                  )}
                  opacity={selectedNode && !isHighlighted ? 0.25 : 1}
                >
                  {label}
                </text>
              </g>
            {/if}
          {/each}

          <!-- Service nodes -->
          {#each nodes as node (node.id)}
            {@const pos = positions.get(node.id)}
            {#if pos}
              {@const isSelected = selectedNode === node.id}
              {@const isHovered = hoveredNode === node.id}
              {@const hasError = node.errorCount > 0}
              {@const palette = serviceColor(node.id)}
              {@const fill = palette.fill}
              {@const stroke = hasError ? '#ef4444' : palette.stroke}
              {@const sw = isSelected || hasError ? 2.5 : isHovered ? 2 : 1.5}
              <g
                transform={`translate(${pos.x}, ${pos.y})`}
                onclick={() => (selectedNode = isSelected ? null : node.id)}
                onkeydown={activateOnKey(
                  () => (selectedNode = isSelected ? null : node.id),
                )}
                onmouseenter={() => (hoveredNode = node.id)}
                onmouseleave={() => (hoveredNode = null)}
                class="cursor-pointer"
                role="button"
                tabindex="-1"
              >
                <!-- Node shape (per-type) filled with the service colour -->
                <g filter="url(#nodeShadow)">
                  {#if node.nodeType === 'database'}
                    <!-- Cylinder for databases -->
                    <rect
                      x={2}
                      y={6}
                      width={NODE_W - 4}
                      height={NODE_H - 12}
                      {fill}
                    />
                    <path
                      d={`M${2},${NODE_H - 6} A${NODE_W / 2 - 2},6 0 0,0 ${NODE_W - 2},${NODE_H - 6} L${NODE_W - 2},6 A${NODE_W / 2 - 2},6 0 0,1 2,6 Z`}
                      {fill}
                      {stroke}
                      stroke-width={sw}
                    />
                    <ellipse
                      cx={NODE_W / 2}
                      cy={6}
                      rx={NODE_W / 2 - 2}
                      ry={6}
                      {fill}
                      {stroke}
                      stroke-width={sw}
                    />
                  {:else if node.nodeType === 'messaging'}
                    <!-- Hexagon for messaging -->
                    <polygon
                      points={`${NODE_W / 2},2 ${NODE_W - 2},${NODE_H / 4} ${NODE_W - 2},${(3 * NODE_H) / 4} ${NODE_W / 2},${NODE_H - 2} 2,${(3 * NODE_H) / 4} 2,${NODE_H / 4}`}
                      {fill}
                      {stroke}
                      stroke-width={sw}
                    />
                  {:else}
                    <!-- Rounded rect for services and external -->
                    <rect
                      x={2}
                      y={2}
                      width={NODE_W - 4}
                      height={NODE_H - 4}
                      rx={8}
                      {fill}
                      {stroke}
                      stroke-width={sw}
                    />
                  {/if}
                </g>

                <!-- Opacity dimming for non-related nodes -->
                {#if selectedNode && !isSelected && !relatedConnections.some((c) => c.source === node.id || c.target === node.id)}
                  <rect
                    x={0}
                    y={0}
                    width={NODE_W}
                    height={NODE_H}
                    rx={8}
                    fill="#64748b"
                    opacity={0.4}
                  />
                {/if}

                <!-- Service name — shape already encodes the node type -->
                <text
                  text-anchor="middle"
                  x={NODE_W / 2}
                  y={NODE_H / 2 - 3}
                  class="text-[11px] font-semibold"
                  fill="#1f2937"
                >
                  {node.name.length > 16
                    ? node.name.slice(0, 14) + '…'
                    : node.name}
                </text>

                <!-- Spans + error count -->
                <text
                  text-anchor="middle"
                  x={NODE_W / 2}
                  y={NODE_H / 2 + 12}
                  class="text-[10px]"
                  fill="#475569"
                >
                  {node.requestCount} span{node.requestCount === 1 ? '' : 's'}
                  {#if hasError}
                    <tspan fill="#dc2626" class="font-semibold">
                      &nbsp;·&nbsp;{node.errorCount} err
                    </tspan>
                  {/if}
                </text>
              </g>
            {/if}
          {/each}
        </svg>
      </div>

      <!-- Details panel -->
      {#if selectedNodeData}
        <div class="w-64 border-l border-line bg-subtle overflow-auto">
          <div class="p-4">
            <div class="flex items-center justify-between mb-4">
              <h4 class="font-semibold text-fg">
                {selectedNodeData.name}
              </h4>
              <button
                onclick={() => (selectedNode = null)}
                class="text-fg-subtle hover:text-fg-muted"
              >
                ×
              </button>
            </div>

            <!-- Stats -->
            <div class="space-y-3">
              {@render statRow(
                'Requests',
                selectedNodeData.requestCount.toString(),
              )}
              {@render statRow(
                'Errors',
                selectedNodeData.errorCount.toString(),
                selectedNodeData.errorCount > 0,
              )}
              {@render statRow(
                'Error Rate',
                `${(
                  (selectedNodeData.errorCount /
                    selectedNodeData.requestCount) *
                  100
                ).toFixed(1)}%`,
                selectedNodeData.errorCount > 0,
              )}
              {@render statRow(
                'Avg Latency',
                formatDuration(selectedNodeData.avgLatency),
              )}
              {@render statRow(
                'Min Latency',
                formatDuration(selectedNodeData.minLatency),
              )}
              {@render statRow(
                'Max Latency',
                formatDuration(selectedNodeData.maxLatency),
              )}
            </div>

            <!-- Connections -->
            {#if relatedConnections.length > 0}
              <div class="mt-4 pt-4 border-t border-line">
                <h5 class="text-xs font-medium text-fg-muted mb-2">
                  Connections
                </h5>
                <div class="space-y-2">
                  {#each relatedConnections as conn (conn.id)}
                    <div
                      class="text-xs p-2 bg-surface rounded border border-line"
                    >
                      <div class="flex items-center gap-1 text-fg-muted">
                        <span class="font-medium">
                          {conn.source === selectedNode
                            ? conn.target
                            : conn.source}
                        </span>
                        {#if conn.source === selectedNode}
                          <ArrowRight size={10} />
                        {:else}
                          <ArrowRight size={10} class="rotate-180" />
                        {/if}
                      </div>
                      <div class="flex items-center gap-2 mt-1 text-fg-subtle">
                        <span>{conn.requestCount} req</span>
                        {#if conn.errorCount > 0}
                          <span class="text-red-600">
                            {conn.errorCount} err
                          </span>
                        {/if}
                        <span>{formatDuration(conn.avgLatency)}</span>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <!-- Legend -->
    <div
      class="flex items-center gap-4 px-4 py-2 border-t border-line bg-subtle text-xs"
    >
      <div class="flex items-center gap-1">
        <div
          class="w-4 h-4 rounded-full border-2 border-blue-500 bg-surface"
        ></div>
        <span class="text-fg-muted">Healthy</span>
      </div>
      <div class="flex items-center gap-1">
        <div
          class="w-4 h-4 rounded-full border-2 border-red-500 bg-surface"
        ></div>
        <span class="text-fg-muted">Has Errors</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="w-6 h-0.5 bg-gray-400"></div>
        <span class="text-fg-muted">Connection</span>
      </div>
    </div>
  </div>
{/if}
