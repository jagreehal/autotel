<script lang="ts" module>
  /**
   * Flame Graph visualization for trace spans
   * Shows spans as stacked horizontal bars where width represents duration
   * and vertical position represents call hierarchy
   */
  import type { TraceData, SpanData } from '../types';

  interface FlameNode {
    span: SpanData;
    children: FlameNode[];
    depth: number;
    // Calculated layout properties
    x: number; // percentage from left
    width: number; // percentage width
  }

  interface ZoomState {
    focusedSpanId: string | null;
    // When zoomed, we show this span and its descendants at full width
  }

  /**
   * Build a tree structure from flat spans array
   */
  function buildFlameTree(spans: SpanData[], trace: TraceData): FlameNode[] {
    const spanMap = new Map<string, FlameNode>();
    const roots: FlameNode[] = [];
    const traceDuration = trace.duration || 1;
    const traceStart = trace.startTime;

    // Create nodes for all spans
    for (const span of spans) {
      const x = ((span.startTime - traceStart) / traceDuration) * 100;
      const width = (span.duration / traceDuration) * 100;
      spanMap.set(span.spanId, {
        span,
        children: [],
        depth: 0,
        x: Math.max(0, x),
        width: Math.max(0.5, Math.min(100 - x, width)), // Min 0.5% for visibility
      });
    }

    // Build tree structure
    for (const span of spans) {
      const node = spanMap.get(span.spanId)!;
      if (span.parentSpanId) {
        const parent = spanMap.get(span.parentSpanId);
        if (parent) {
          parent.children.push(node);
          node.depth = parent.depth + 1;
        } else {
          roots.push(node);
        }
      } else {
        roots.push(node);
      }
    }

    // Sort children by start time
    const sortChildren = (nodes: FlameNode[]) => {
      nodes.sort((a, b) => a.span.startTime - b.span.startTime);
      for (const node of nodes) sortChildren(node.children);
    };
    sortChildren(roots);

    return roots;
  }

  /**
   * Flatten tree to array with depth info, for rendering
   */
  function flattenFlameTree(nodes: FlameNode[]): FlameNode[] {
    const result: FlameNode[] = [];
    const traverse = (node: FlameNode) => {
      result.push(node);
      node.children.forEach(traverse);
    };
    nodes.forEach(traverse);
    return result;
  }

  /**
   * Get max depth in tree
   */
  function getMaxDepth(nodes: FlameNode[]): number {
    let max = 0;
    const traverse = (node: FlameNode) => {
      max = Math.max(max, node.depth);
      node.children.forEach(traverse);
    };
    nodes.forEach(traverse);
    return max;
  }

  /**
   * Recalculate positions when zoomed to a specific span
   */
  function recalculateForZoom(
    nodes: FlameNode[],
    focusedSpanId: string,
    allSpans: SpanData[],
  ): FlameNode[] {
    // Find the focused span
    const focusedSpan = allSpans.find((s) => s.spanId === focusedSpanId);
    if (!focusedSpan) return nodes;

    const focusStart = focusedSpan.startTime;
    const focusDuration = focusedSpan.duration || 1;

    // Get all descendants of focused span
    const isDescendant = (spanId: string, ancestorId: string): boolean => {
      const span = allSpans.find((s) => s.spanId === spanId);
      if (!span) return false;
      if (span.parentSpanId === ancestorId) return true;
      if (span.parentSpanId) return isDescendant(span.parentSpanId, ancestorId);
      return false;
    };

    // Recalculate x and width for visible spans
    const recalc = (node: FlameNode): FlameNode => {
      const isVisible =
        node.span.spanId === focusedSpanId ||
        isDescendant(node.span.spanId, focusedSpanId);

      if (!isVisible) {
        return {
          ...node,
          x: -100,
          width: 0,
          children: node.children.map(recalc),
        };
      }

      const x = ((node.span.startTime - focusStart) / focusDuration) * 100;
      const width = (node.span.duration / focusDuration) * 100;

      return {
        ...node,
        x: Math.max(0, x),
        width: Math.max(0.5, Math.min(100 - Math.max(0, x), width)),
        children: node.children.map(recalc),
      };
    };

    return nodes.map(recalc);
  }

  /**
   * Get color for span based on kind and status
   */
  function getSpanColor(span: SpanData): string {
    if (span.status.code === 'ERROR') {
      return 'bg-red-500 hover:bg-red-400';
    }
    switch (span.kind) {
      case 'SERVER': {
        return 'bg-blue-500 hover:bg-blue-400';
      }
      case 'CLIENT': {
        return 'bg-green-500 hover:bg-green-400';
      }
      case 'PRODUCER': {
        return 'bg-purple-500 hover:bg-purple-400';
      }
      case 'CONSUMER': {
        return 'bg-orange-500 hover:bg-orange-400';
      }
      case 'INTERNAL':
      default: {
        return 'bg-gray-500 hover:bg-gray-400';
      }
    }
  }

  /**
   * Get border color for selected state
   */
  function getSelectedBorder(span: SpanData): string {
    if (span.status.code === 'ERROR') {
      return 'ring-2 ring-red-700';
    }
    return 'ring-2 ring-gray-900';
  }

  const ROW_HEIGHT = 24;
  const ROW_GAP = 2;
</script>

<script lang="ts">
  import { RotateCcw, AlertCircle } from '@lucide/svelte';
  import { cn } from '../utils/cn';
  import { formatDuration } from '../utils';
  import { activateOnKey } from '../utils/keyboard';

  interface Props {
    trace: TraceData;
    onSpanSelect?: (span: SpanData | null) => void;
    selectedSpanId?: string | null;
  }
  let { trace, onSpanSelect, selectedSpanId }: Props = $props();

  let zoom = $state<ZoomState>({ focusedSpanId: null });
  let hoveredSpan = $state<SpanData | null>(null);
  let tooltipPos = $state({ x: 0, y: 0 });
  let containerRef: HTMLDivElement | undefined = $state();

  // Build the flame tree
  const baseTree = $derived.by(() => buildFlameTree(trace.spans, trace));

  // Apply zoom if needed
  const flameTree = $derived.by(() => {
    if (zoom.focusedSpanId) {
      return recalculateForZoom(baseTree, zoom.focusedSpanId, trace.spans);
    }
    return baseTree;
  });

  const flatNodes = $derived.by(() => flattenFlameTree(flameTree));
  const maxDepth = $derived.by(() => getMaxDepth(flameTree));

  // Group nodes by depth for rendering
  const nodesByDepth = $derived.by(() => {
    const grouped: Map<number, FlameNode[]> = new Map();
    for (const node of flatNodes) {
      if (node.width > 0) {
        // Only visible nodes
        const existing = grouped.get(node.depth) || [];
        existing.push(node);
        grouped.set(node.depth, existing);
      }
    }
    return grouped;
  });

  const handleZoomIn = (spanId: string) => {
    zoom = { focusedSpanId: spanId };
  };

  const handleZoomOut = () => {
    zoom = { focusedSpanId: null };
  };

  const handleMouseMove = (e: MouseEvent, span: SpanData) => {
    if (containerRef) {
      const rect = containerRef.getBoundingClientRect();
      tooltipPos = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }
    hoveredSpan = span;
  };

  const handleMouseLeave = () => {
    hoveredSpan = null;
  };

  const graphHeight = $derived((maxDepth + 1) * (ROW_HEIGHT + ROW_GAP) + 20);
</script>

{#snippet flameBar(node: FlameNode, isSelected: boolean, _isHovered: boolean)}
  {@const { span, x, width } = node}
  <!-- Don't render if not visible -->
  {#if !(width <= 0 || x < 0)}
    <div
      class={cn(
        'absolute cursor-pointer transition-all',
        getSpanColor(span),
        isSelected && getSelectedBorder(span),
        'rounded-sm',
      )}
      style="left: {x}%; width: {width}%; height: {ROW_HEIGHT}px; min-width: 4px;"
      onclick={() => handleZoomIn(span.spanId)}
      onkeydown={activateOnKey(() => handleZoomIn(span.spanId))}
      ondblclick={() => onSpanSelect?.(span)}
      onmousemove={(e) => handleMouseMove(e, span)}
      onmouseleave={handleMouseLeave}
      title={`${span.name}: ${formatDuration(span.duration)}`}
      role="button"
      tabindex="-1"
    >
      <!-- Show label if wide enough -->
      {#if width > 5}
        <div class="absolute inset-0 flex items-center px-1.5 overflow-hidden">
          <span class="text-[10px] text-white font-medium truncate">
            {span.name}
          </span>
        </div>
      {/if}
    </div>
  {/if}
{/snippet}

<div class="flex flex-col h-full">
  <!-- Toolbar -->
  <div
    class="flex items-center justify-between px-3 py-2 border-b border-line bg-subtle"
  >
    <div class="text-xs text-fg-muted">
      {#if zoom.focusedSpanId}
        <span class="flex items-center gap-2">
          <span class="font-medium">Zoomed:</span>
          <span class="truncate max-w-[200px]">
            {trace.spans.find((s) => s.spanId === zoom.focusedSpanId)?.name}
          </span>
        </span>
      {:else}
        <span>Click a span to zoom in, double-click to select</span>
      {/if}
    </div>
    <div class="flex items-center gap-1">
      {#if zoom.focusedSpanId}
        <button
          onclick={handleZoomOut}
          class="p-1.5 hover:bg-hover rounded transition-colors flex items-center gap-1 text-xs text-fg-muted"
          title="Reset zoom"
        >
          <RotateCcw size={14} />
          Reset
        </button>
      {/if}
    </div>
  </div>

  <!-- Flame graph container -->
  <div
    bind:this={containerRef}
    class="flex-1 overflow-auto p-4 relative"
    onmouseleave={handleMouseLeave}
    role="presentation"
  >
    <div
      class="relative w-full"
      style="height: {graphHeight}px; min-width: 100%;"
    >
      <!-- Render rows by depth (bottom-up for flame graph, but we'll do top-down for icicle) -->
      {#each [...nodesByDepth.entries()] as [depth, nodes] (depth)}
        <div
          class="absolute left-0 right-0"
          style="top: {depth * (ROW_HEIGHT + ROW_GAP)}px;"
        >
          {#each nodes as node (node.span.spanId)}
            {@render flameBar(
              node,
              selectedSpanId === node.span.spanId,
              hoveredSpan?.spanId === node.span.spanId,
            )}
          {/each}
        </div>
      {/each}
    </div>

    <!-- Tooltip -->
    {#if hoveredSpan}
      <div
        class="absolute z-50 pointer-events-none"
        style="left: {Math.min(
          tooltipPos.x + 10,
          (containerRef?.clientWidth || 300) - 220,
        )}px; top: {tooltipPos.y + 10}px;"
      >
        <div
          class="bg-gray-900 text-white text-xs rounded-md shadow-lg p-2 max-w-[200px]"
        >
          <div class="font-medium truncate mb-1">
            {hoveredSpan.name}
          </div>
          <div class="flex items-center gap-2 text-gray-300">
            <span>{formatDuration(hoveredSpan.duration)}</span>
            <span>|</span>
            <span>{hoveredSpan.kind}</span>
          </div>
          {#if hoveredSpan.status.code === 'ERROR'}
            <div class="flex items-center gap-1 mt-1 text-red-400">
              <AlertCircle size={10} />
              <span>Error</span>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <!-- Legend -->
  <div
    class="flex items-center gap-4 px-3 py-2 border-t border-line bg-subtle text-xs"
  >
    <span class="text-fg-subtle font-medium">Kind:</span>
    {#each ['SERVER', 'CLIENT', 'INTERNAL', 'PRODUCER', 'CONSUMER'] as kind (kind)}
      <div class="flex items-center gap-1">
        <div
          class={cn(
            'w-3 h-3 rounded-sm',
            kind === 'SERVER' && 'bg-blue-500',
            kind === 'CLIENT' && 'bg-green-500',
            kind === 'PRODUCER' && 'bg-purple-500',
            kind === 'CONSUMER' && 'bg-orange-500',
            kind === 'INTERNAL' && 'bg-gray-500',
          )}
        ></div>
        <span class="text-fg-muted">{kind}</span>
      </div>
    {/each}
    <div class="flex items-center gap-1 ml-2">
      <div class="w-3 h-3 rounded-sm bg-red-500"></div>
      <span class="text-fg-muted">ERROR</span>
    </div>
  </div>
</div>
