<script lang="ts">
  /**
   * Service Map Visualization
   * Shows services as nodes and their connections as edges
   * Highlights error paths and displays latency information
   */

  import {
    Server,
    ArrowRight,
    Activity,
    Plus,
    Minus,
    Scan,
    RotateCcw,
  } from '@lucide/svelte';
  import { cn } from '../utils/cn';
  import { formatDuration } from '../utils';
  import { tracesSignal } from '../store.svelte';
  import { serviceColor } from '../utils/serviceColor';
  import CopyButton from './CopyButton.svelte';
  import Copyable from './Copyable.svelte';
  import SearchInput from './SearchInput.svelte';
  import { matchesNeedle } from '../utils/textMatch';
  import {
    buildServiceMap,
    calculateSugiyamaLayout,
    NODE_W,
    NODE_H,
    type ServiceNode,
  } from './serviceMap';
  import { useZoomPan } from './zoomPan.svelte';

  const SVG_MIN_HEIGHT = 'min-height: 300px;';


  const traces = $derived(tracesSignal.value);
  let selectedNode = $state<string | null>(null);
  let hoveredNode = $state<string | null>(null);
  let query = $state('');

  const map = $derived.by(() => buildServiceMap(traces));
  const nodes = $derived(map.nodes);
  const connections = $derived(map.connections);

  const isFiltered = $derived(query.length > 0);

  /**
   * Case-insensitive substring match of a node's name against the query.
   * Highlights — rather than removes — matches so the graph layout stays put.
   */
  function nodeMatches(node: ServiceNode): boolean {
    return matchesNeedle(query.toLowerCase(), [node.name]);
  }

  const matchedNodes = $derived.by(() => nodes.filter(nodeMatches));
  const matchedIds = $derived(new Set(matchedNodes.map((n) => n.id)));
  const hasMatches = $derived(matchedNodes.length > 0);

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

  // Zoom & pan: large maps are unusable in a narrow dock, so let users zoom
  // toward the cursor, pan empty canvas, fit-to-content and reset to 1:1. The
  // controller is useZoomPan; we feed it the live view dimensions, the SVG
  // element and the content bounding box (node extents).
  let svgEl = $state<SVGSVGElement | null>(null);

  const zoom = useZoomPan({
    viewWidth: () => viewWidth,
    viewHeight: () => viewHeight,
    svg: () => svgEl,
    contentBounds: () => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [, pos] of positions) {
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
        maxX = Math.max(maxX, pos.x + NODE_W);
        maxY = Math.max(maxY, pos.y + NODE_H);
      }
      return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
    },
  });

  const selectedNodeData = $derived(
    selectedNode ? (nodes.find((n) => n.id === selectedNode) ?? null) : null,
  );

  /**
   * Keyboard activation for a service node (a graph element, not a list row).
   * Enter/Space toggles selection (mirrors the node's onclick); Escape clears
   * the current selection. The Escape branch calls stopPropagation so that
   * "Escape-to-deselect" does NOT also bubble up to the panel's global
   * Escape-closes-devtools handler.
   */
  function handleNodeKeydown(event: KeyboardEvent, nodeId: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectedNode = selectedNode === nodeId ? null : nodeId;
      return;
    }
    if (event.key === 'Escape' && selectedNode) {
      event.stopPropagation();
      selectedNode = null;
    }
  }

  const relatedConnections = $derived(
    selectedNode
      ? connections.filter(
          (c) => c.source === selectedNode || c.target === selectedNode,
        )
      : [],
  );

  const relatedConnectionsSummary = $derived.by(() =>
    relatedConnections.length > 0
      ? JSON.stringify(
          relatedConnections.map((c) => ({
            source: c.source,
            target: c.target,
            requests: c.requestCount,
            errors: c.errorCount,
            avgLatency: formatDuration(c.avgLatency),
          })),
          null,
          2,
        )
      : '',
  );

  const selectedNodeSummary = $derived.by(() => {
    if (!selectedNodeData) return '';
    const node = selectedNodeData;
    return JSON.stringify(
      {
        service: node.name,
        requests: node.requestCount,
        errors: node.errorCount,
        errorRate: `${((node.errorCount / node.requestCount) * 100).toFixed(1)}%`,
        avgLatency: formatDuration(node.avgLatency),
        minLatency: formatDuration(node.minLatency),
        maxLatency: formatDuration(node.maxLatency),
        connections: relatedConnections.map((c) => ({
          source: c.source,
          target: c.target,
          requests: c.requestCount,
          errors: c.errorCount,
          avgLatency: formatDuration(c.avgLatency),
        })),
      },
      null,
      2,
    );
  });
</script>

{#snippet statRow(label: string, value: string, isError = false)}
  <div class="flex justify-between text-xs">
    <span class="text-fg-subtle">{label}</span>
    <span class={cn('font-medium', isError ? 'text-danger' : 'text-fg')}>
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
        Service Map ({isFiltered
          ? `${matchedNodes.length} of ${nodes.length}`
          : nodes.length} services)
      </h3>
      <div class="text-xs text-fg-subtle">
        {connections.length} connections
      </div>
    </div>

    <!-- Filter bar -->
    <div class="px-4 py-2 border-b border-line flex items-center gap-2">
      <SearchInput
        bind:value={query}
        placeholder="Find a service by name…"
        ariaLabel="Find a service by name"
      />
      {#if isFiltered && !hasMatches}
        <span class="text-xs text-fg-subtle flex-shrink-0">
          No service matches
        </span>
      {/if}
    </div>

    <!-- Map container -->
    <div class="flex-1 overflow-hidden flex">
      <!-- SVG Map -->
      <div class="relative flex-1 overflow-auto p-4">
        <svg
          bind:this={svgEl}
          viewBox={`0 0 ${viewWidth} ${viewHeight}`}
          class={cn(
            'w-full h-full',
            zoom.isPanning ? 'cursor-grabbing' : 'cursor-grab',
          )}
          style={SVG_MIN_HEIGHT}
          role="application"
          aria-label="Service map. Drag to pan, ctrl or cmd and scroll to zoom."
          onwheel={zoom.onWheel}
          onpointerdown={zoom.onPointerDown}
          onpointermove={zoom.onPointerMove}
          onpointerup={zoom.onPointerEnd}
          onpointercancel={zoom.onPointerEnd}
          onpointerleave={zoom.onPointerEnd}
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

          <!-- Zoom/pan group — wraps the layout output; the layout algorithm
               itself is untouched, we only transform its rendered coordinates. -->
          <g
            transform={`translate(${zoom.translate.x}, ${zoom.translate.y}) scale(${zoom.scale})`}
          >
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
                    hasError ? 'fill-danger font-medium' : 'fill-fg-subtle',
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
              {@const isMatch = matchedIds.has(node.id)}
              {@const isDimmed = isFiltered && !isMatch}
              {@const palette = serviceColor(node.id)}
              {@const fill = palette.fill}
              {@const stroke = hasError ? '#ef4444' : palette.stroke}
              {@const sw = isSelected || hasError ? 2.5 : isHovered ? 2 : 1.5}
              <g
                data-node={node.id}
                transform={`translate(${pos.x}, ${pos.y})`}
                onclick={() => (selectedNode = isSelected ? null : node.id)}
                onkeydown={(event) => handleNodeKeydown(event, node.id)}
                onmouseenter={() => (hoveredNode = node.id)}
                onmouseleave={() => (hoveredNode = null)}
                class={cn(
                  'cursor-pointer',
                  isDimmed && 'opacity-30',
                )}
                role="button"
                aria-label={node.name}
                tabindex="0"
              >
                <!-- Accent ring for query matches — keeps layout intact while
                     drawing attention to the searched service(s). -->
                {#if isFiltered && isMatch}
                  <rect
                    x={-3}
                    y={-3}
                    width={NODE_W + 6}
                    height={NODE_H + 6}
                    rx={11}
                    fill="none"
                    class="stroke-accent"
                    stroke-width={2.5}
                  />
                {/if}
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
          </g>
        </svg>

        <!-- Zoom / pan controls — bottom-right cluster -->
        <div
          class="absolute bottom-3 right-3 flex flex-col gap-1 rounded-md border border-line bg-surface p-1 shadow-sm"
        >
          <button
            type="button"
            onclick={zoom.zoomIn}
            class="flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent transition-colors"
            title="Zoom in"
            aria-label="Zoom in"
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            onclick={zoom.zoomOut}
            class="flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent transition-colors"
            title="Zoom out"
            aria-label="Zoom out"
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            onclick={zoom.fit}
            class="flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent transition-colors"
            title="Fit to content"
            aria-label="Fit to content"
          >
            <Scan size={14} />
          </button>
          <button
            type="button"
            onclick={zoom.reset}
            class="flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent transition-colors"
            title="Reset to 1:1"
            aria-label="Reset zoom to 1:1"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      <!-- Details panel -->
      {#if selectedNodeData}
        <div class="w-64 border-l border-line bg-subtle overflow-auto">
          <div class="p-4">
            <div class="flex items-center justify-between mb-4">
              <div class="group flex items-center gap-1 min-w-0">
                <h4 class="font-semibold text-fg truncate">
                  {selectedNodeData.name}
                </h4>
                <CopyButton
                  value={selectedNodeData.name}
                  label="Copy service name"
                  class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                />
              </div>
              <button
                onclick={() => (selectedNode = null)}
                class="text-fg-subtle hover:text-fg-muted"
              >
                ×
              </button>
            </div>

            <!-- Stats -->
            <Copyable content={selectedNodeSummary}>
              <div class="space-y-3 pr-8">
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
            </Copyable>

            <!-- Connections -->
            {#if relatedConnections.length > 0}
              <div class="mt-4 pt-4 border-t border-line">
                <div class="group flex items-center justify-between mb-2">
                  <h5 class="text-xs font-medium text-fg-muted">
                    Connections
                  </h5>
                  <CopyButton
                    value={relatedConnectionsSummary}
                    label="Copy connections"
                    class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                  />
                </div>
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
                          <span class="text-danger">
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
          class="w-4 h-4 rounded-full border-2 border-accent bg-surface"
        ></div>
        <span class="text-fg-muted">Healthy</span>
      </div>
      <div class="flex items-center gap-1">
        <div
          class="w-4 h-4 rounded-full border-2 border-danger-border bg-surface"
        ></div>
        <span class="text-fg-muted">Has Errors</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="w-6 h-0.5 bg-fg-subtle"></div>
        <span class="text-fg-muted">Connection</span>
      </div>
    </div>
  </div>
{/if}
