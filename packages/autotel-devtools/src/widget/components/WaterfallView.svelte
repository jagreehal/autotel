<script lang="ts" module>
  import type { SpanData } from '../types';
  import type { SpanNode } from './WaterfallRow.svelte';

  /**
   * Build a tree structure from flat spans array.
   * Handles cycle detection and orphan spans with phantom placeholder nodes.
   */
  function buildSpanTree(spans: SpanData[]): SpanNode[] {
    const spanMap = new Map<string, SpanNode>();
    const roots: SpanNode[] = [];
    const orphansByParent = new Map<string, SpanNode[]>();

    // Create nodes for all spans
    for (const span of spans) {
      spanMap.set(span.spanId, { span, children: [], depth: 0 });
    }

    // Build tree structure
    for (const span of spans) {
      const node = spanMap.get(span.spanId)!;
      if (span.parentSpanId) {
        const parent = spanMap.get(span.parentSpanId);
        if (parent) {
          parent.children.push(node);
        } else {
          // Parent not found — group orphan under missing parent id
          const orphans = orphansByParent.get(span.parentSpanId) || [];
          orphans.push(node);
          orphansByParent.set(span.parentSpanId, orphans);
        }
      } else {
        roots.push(node);
      }
    }

    // Set depths and detect cycles via visited set
    const setDepth = (
      node: SpanNode,
      depth: number,
      visited: Set<string> = new Set(),
    ) => {
      if (visited.has(node.span.spanId)) return; // Cycle detected
      visited.add(node.span.spanId);
      node.depth = depth;
      for (const child of node.children) {
        setDepth(child, depth + 1, new Set(visited));
      }
    };

    // Build phantom placeholder nodes for orphaned children
    for (const [missingParentId, orphanNodes] of orphansByParent) {
      orphanNodes.sort((a, b) => a.span.startTime - b.span.startTime);
      const startTime = Math.min(...orphanNodes.map((n) => n.span.startTime));
      const endTime = Math.max(...orphanNodes.map((n) => n.span.endTime));

      // Find any existing span that knows about this missing parent id
      const referencingSpan = spans.find((s) => s.spanId === missingParentId);

      const phantomSpan: SpanData = {
        spanId: missingParentId,
        traceId: orphanNodes[0].span.traceId,
        parentSpanId: referencingSpan?.parentSpanId || undefined,
        name: '(missing)',
        kind: 'INTERNAL',
        startTime,
        endTime,
        duration: endTime - startTime,
        attributes: {},
        status: { code: 'UNSET' },
        events: [],
      };
      const phantomNode: SpanNode = {
        span: phantomSpan,
        children: orphanNodes,
        depth: 0,
      };
      roots.push(phantomNode);
    }

    // Set depths for all root nodes
    for (const root of roots) {
      setDepth(root, 0);
    }

    // Sort children recursively by start time
    const sortChildren = (nodes: SpanNode[]) => {
      nodes.sort((a, b) => a.span.startTime - b.span.startTime);
      for (const node of nodes) sortChildren(node.children);
    };
    sortChildren(roots);

    return roots;
  }

  /**
   * Flatten tree to array while preserving depth info, skipping children of collapsed nodes
   */
  function flattenTree(nodes: SpanNode[], collapsed: Set<string>): SpanNode[] {
    const result: SpanNode[] = [];
    const traverse = (node: SpanNode) => {
      result.push(node);
      if (!collapsed.has(node.span.spanId)) {
        node.children.forEach(traverse);
      }
    };
    nodes.forEach(traverse);
    return result;
  }
</script>

<script lang="ts">
  /**
   * Waterfall visualization for trace spans
   * Shows spans in a timeline view with bars representing duration
   */
  import { Zap } from '@lucide/svelte';
  import { cn } from '../utils/cn';
  import { formatDuration } from '../utils';
  import { isInputFocused } from '../utils/keyboard';
  import { computeCriticalPath } from '../utils/spanAnalysis';
  import { helpShortcutsSignal } from '../store.svelte';
  import type { TraceData } from '../types';
  import WaterfallRow, { getSpanKindColor } from './WaterfallRow.svelte';

  interface Props {
    trace: TraceData;
    onSpanSelect?: (span: SpanData | null) => void;
    selectedSpanId?: string | null;
  }

  let { trace, onSpanSelect, selectedSpanId = null }: Props = $props();

  const GRID_LINES_STYLE = 'left: 200px; right: 80px;';

  let collapsed = $state(new Set<string>());
  let showCritical = $state(true);
  let markersEl: HTMLDivElement | undefined = $state();
  let markersWidth = $state(0);

  const criticalPath = $derived.by(() => computeCriticalPath(trace.spans));

  // Track the timeline column width so the number of axis labels adapts to the
  // available space (the detail pane is resizable / responsive).
  $effect(() => {
    const el = markersEl;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      markersWidth = entries[0].contentRect.width;
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  // Build span tree and flatten (skipping children of collapsed nodes)
  const spanTree = $derived.by(() => buildSpanTree(trace.spans));
  const visibleSpans = $derived.by(() => flattenTree(spanTree, collapsed));

  // Arrow key navigation
  const handleKeydown = (e: KeyboardEvent) => {
    if (helpShortcutsSignal.value || isInputFocused()) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Enter')
      return;

    e.preventDefault();
    const currentIdx = visibleSpans.findIndex(
      (n) => n.span.spanId === selectedSpanId,
    );
    let nextIdx: number;

    if (e.key === 'ArrowUp') {
      nextIdx = currentIdx > 0 ? currentIdx - 1 : visibleSpans.length - 1;
    } else if (e.key === 'ArrowDown') {
      nextIdx = currentIdx < visibleSpans.length - 1 ? currentIdx + 1 : 0;
    } else {
      // Enter — if a span is focused, select it; otherwise select first
      if (currentIdx >= 0) {
        onSpanSelect?.(visibleSpans[currentIdx].span);
        return;
      }
      nextIdx = 0;
    }

    const next = visibleSpans[nextIdx];
    if (next) {
      onSpanSelect?.(next.span);
      // Scroll the row into view
      const el = document.getElementById(`waterfall-row-${next.span.spanId}`);
      el?.scrollIntoView({ block: 'nearest' });
    }
  };

  $effect(() => {
    // Re-subscribe when visibleSpans / selectedSpanId change (matches source deps).
    void visibleSpans;
    void selectedSpanId;
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });

  const toggleCollapse = (spanId: string) => {
    const next = new Set(collapsed);
    if (next.has(spanId)) next.delete(spanId);
    else next.add(spanId);
    collapsed = next;
  };

  const hasChildren = (spanId: string) => {
    return trace.spans.some((s) => s.parentSpanId === spanId);
  };

  // Generate time markers. One label per ~90px (min 2, max 8 segments), so
  // labels never collide in a narrow column. Falls back to 5 before measuring.
  const timeMarkers = $derived.by(() => {
    const duration = trace.duration || 1;
    const segments =
      markersWidth > 0
        ? Math.min(8, Math.max(2, Math.floor(markersWidth / 90)))
        : 5;
    const markers: {
      percent: number;
      label: string;
      align: 'start' | 'mid' | 'end';
    }[] = [];

    for (let i = 0; i <= segments; i++) {
      markers.push({
        percent: (i / segments) * 100,
        label: formatDuration((i / segments) * duration),
        align: i === 0 ? 'start' : i === segments ? 'end' : 'mid',
      });
    }
    return markers;
  });

  const SPAN_KINDS = [
    'SERVER',
    'CLIENT',
    'INTERNAL',
    'PRODUCER',
    'CONSUMER',
  ] as const;
</script>

<div class="flex flex-col h-full">
  <!-- Timeline header with time markers -->
  <div class="flex border-b border-line bg-subtle text-xs text-fg-subtle">
    <div class="w-[200px] shrink-0 px-3 py-2 font-medium text-fg-muted">
      Span Name
    </div>
    <div bind:this={markersEl} class="flex-1 relative py-2">
      {#each timeMarkers as marker, idx (idx)}
        <div
          class="absolute text-[10px] whitespace-nowrap tabular-nums"
          style={`left: ${marker.percent}%; transform: ${
            marker.align === 'start'
              ? 'translateX(0)'
              : marker.align === 'end'
                ? 'translateX(-100%)'
                : 'translateX(-50%)'
          };`}
        >
          {marker.label}
        </div>
      {/each}
    </div>
    <div
      class="w-[80px] shrink-0 px-2 py-2 text-right font-medium text-fg-muted"
    >
      Duration
    </div>
  </div>

  <!-- Timeline grid lines -->
  <div class="flex-1 overflow-auto relative">
    <!-- Grid lines behind content -->
    <div class="absolute inset-0 pointer-events-none" style={GRID_LINES_STYLE}>
      {#each timeMarkers as marker, idx (idx)}
        <div
          class="absolute top-0 bottom-0 border-l border-line-subtle"
          style={`left: ${marker.percent}%;`}
        ></div>
      {/each}
    </div>

    <!-- Span rows -->
    <div class="relative">
      {#each visibleSpans as node (node.span.spanId)}
        <WaterfallRow
          {node}
          {trace}
          isSelected={selectedSpanId === node.span.spanId}
          isCollapsed={collapsed.has(node.span.spanId)}
          hasChildren={hasChildren(node.span.spanId)}
          isCritical={showCritical && criticalPath.has(node.span.spanId)}
          onSelect={() => onSpanSelect?.(node.span)}
          onToggleCollapse={() => toggleCollapse(node.span.spanId)}
        />
      {/each}
    </div>
  </div>

  <!-- Legend -->
  <div
    class="flex items-center gap-4 px-3 py-2 border-t border-line bg-subtle text-xs"
  >
    <span class="text-fg-subtle font-medium">Kind:</span>
    {#each SPAN_KINDS as kind (kind)}
      <div class="flex items-center gap-1">
        <div class={cn('w-3 h-3 rounded-sm', getSpanKindColor(kind))}></div>
        <span class="text-fg-muted">{kind}</span>
      </div>
    {/each}
    <button
      onclick={() => (showCritical = !showCritical)}
      class={cn(
        'ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded border transition-colors',
        showCritical
          ? 'bg-amber-100 text-amber-800 border-amber-300'
          : 'text-fg-subtle border-line hover:bg-hover',
      )}
      title="Highlight the spans that determine total trace latency"
    >
      <Zap size={11} />
      Critical path
    </button>
  </div>
</div>
