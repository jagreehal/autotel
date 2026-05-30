<script lang="ts" module>
  import type { SpanData } from '../types';

  export interface SpanNode {
    span: SpanData;
    children: SpanNode[];
    depth: number;
  }

  /**
   * Count all descendants of a node
   */
  export function countDescendants(node: SpanNode): number {
    let count = node.children.length;
    for (const child of node.children) count += countDescendants(child);
    return count;
  }

  /**
   * Calculate timing info for waterfall bar positioning
   */
  export function calculateTimingInfo(span: SpanData, trace: TraceData) {
    const traceStart = trace.startTime;
    const traceDuration = trace.duration || 1; // Prevent division by zero

    const offsetMs = span.startTime - traceStart;
    const offsetPercent = (offsetMs / traceDuration) * 100;
    const widthPercent = (span.duration / traceDuration) * 100;

    return {
      offsetMs,
      offsetPercent: Math.max(0, Math.min(100, offsetPercent)),
      widthPercent: Math.max(0.5, Math.min(100 - offsetPercent, widthPercent)), // Min 0.5% for visibility
    };
  }

  /**
   * Get color for span kind
   */
  export function getSpanKindColor(kind: SpanData['kind']): string {
    switch (kind) {
      case 'SERVER': {
        return 'bg-blue-500';
      }
      case 'CLIENT': {
        return 'bg-green-500';
      }
      case 'PRODUCER': {
        return 'bg-purple-500';
      }
      case 'CONSUMER': {
        return 'bg-orange-500';
      }
      case 'INTERNAL':
      default: {
        return 'bg-gray-500';
      }
    }
  }

  /**
   * Get lighter color for span kind (hover state)
   */
  export function getSpanKindColorLight(kind: SpanData['kind']): string {
    switch (kind) {
      case 'SERVER': {
        return 'bg-blue-400';
      }
      case 'CLIENT': {
        return 'bg-green-400';
      }
      case 'PRODUCER': {
        return 'bg-purple-400';
      }
      case 'CONSUMER': {
        return 'bg-orange-400';
      }
      case 'INTERNAL':
      default: {
        return 'bg-gray-400';
      }
    }
  }
</script>

<script lang="ts">
  import {
    AlertCircle,
    ChevronDown,
    ChevronRight,
    Info,
    Zap,
  } from '@lucide/svelte';
  import { cn } from '../utils/cn';
  import { formatDuration } from '../utils';
  import type { TraceData } from '../types';

  interface Props {
    node: SpanNode;
    trace: TraceData;
    isSelected: boolean;
    isCollapsed: boolean;
    hasChildren: boolean;
    isCritical: boolean;
    onSelect?: () => void;
    onToggleCollapse?: () => void;
  }

  let {
    node,
    trace,
    isSelected,
    isCollapsed,
    hasChildren,
    isCritical,
    onSelect,
    onToggleCollapse,
  }: Props = $props();

  const span = $derived(node.span);
  const timing = $derived(calculateTimingInfo(span, trace));
  const isError = $derived(span.status.code === 'ERROR');
  const hasEvents = $derived(span.events && span.events.length > 0);

  // Pack event markers into sub-lanes to avoid overlap
  const eventLanes = $derived.by(() => {
    if (!span.events || span.events.length === 0) return [];
    const lanes: number[][] = []; // Each lane is a list of event indices

    for (let i = 0; i < span.events.length; i++) {
      const event = span.events[i];
      const eventPos =
        trace.duration > 0
          ? ((event.timestamp - trace.startTime) / trace.duration) * 100
          : 0;
      const clampedPos = Math.min(Math.max(eventPos, 0), 100);

      // Place in the first lane that doesn't overlap
      let placed = false;
      for (let lane = 0; lane < lanes.length; lane++) {
        const canPlace = lanes[lane].every((otherIdx) => {
          const other = span.events![otherIdx];
          const otherPos =
            trace.duration > 0
              ? ((other.timestamp - trace.startTime) / trace.duration) * 100
              : 0;
          return Math.abs(clampedPos - otherPos) > 2; // 2% gap
        });
        if (canPlace) {
          lanes[lane].push(i);
          placed = true;
          break;
        }
      }
      if (!placed) {
        lanes.push([i]);
      }
    }
    return lanes;
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  id={`waterfall-row-${span.spanId}`}
  class={cn(
    'flex items-center border-b border-line-subtle hover:bg-blue-50/50 cursor-pointer transition-colors',
    isSelected && 'bg-blue-50 hover:bg-blue-100/50',
    isError && 'bg-red-50/30 hover:bg-red-50/50',
    isCritical && 'border-l-2 border-l-amber-400',
  )}
  onclick={() => onSelect?.()}
>
  <!-- Span name column -->
  <div
    class="w-[200px] shrink-0 px-2 py-2 flex items-center gap-1 min-w-0"
    style={`padding-left: ${8 + node.depth * 16}px;`}
  >
    <!-- Collapse/expand button -->
    {#if hasChildren}
      <button
        onclick={(e) => {
          e.stopPropagation();
          onToggleCollapse?.();
        }}
        class="p-0.5 hover:bg-hover rounded flex-shrink-0"
      >
        {#if isCollapsed}
          <ChevronRight size={12} class="text-fg-subtle" />
        {:else}
          <ChevronDown size={12} class="text-fg-subtle" />
        {/if}
      </button>
    {:else}
      <div class="w-4"></div>
    {/if}

    <!-- Error indicator -->
    {#if isError}
      <AlertCircle size={12} class="text-red-500 flex-shrink-0" />
    {/if}

    <!-- Events indicator -->
    {#if hasEvents}
      <Info size={10} class="text-blue-500 flex-shrink-0" />
    {/if}

    <!-- Critical-path indicator -->
    {#if isCritical}
      <Zap size={10} class="text-amber-500 fill-amber-400 flex-shrink-0" />
    {/if}

    <!-- Span name -->
    <span
      class={cn('text-xs truncate', isError ? 'text-red-700' : 'text-fg')}
      title={span.name}
    >
      {span.name || 'unknown'}
    </span>

    <!-- Collapsed children count -->
    {#if isCollapsed && node.children.length > 0}
      <span class="text-xs text-fg-subtle ml-1"
        >(+{countDescendants(node)})</span
      >
    {/if}
  </div>

  <!-- Timeline bar column - taller when event lanes stack below the bar.
       The bar is top-anchored (6px) so the lanes have room underneath; height
       grows by 8px per lane plus a 2px breathing gap under the last dot. -->
  <div
    class="flex-1 relative"
    style={`height: ${Math.max(32, 30 + eventLanes.length * 8)}px;`}
  >
    <!-- Span bar -->
    <div
      class={cn(
        'absolute h-5 rounded-sm transition-colors group',
        isError ? 'bg-red-500' : getSpanKindColor(span.kind),
        isSelected &&
          (isError ? 'bg-red-600' : getSpanKindColorLight(span.kind)),
      )}
      style={`left: ${timing.offsetPercent}%; width: ${timing.widthPercent}%; top: 6px; min-width: 4px;`}
      title={`${span.name}: ${formatDuration(span.duration)}`}
    >
      <!-- Show duration label inside bar if wide enough -->
      {#if timing.widthPercent > 10}
        <span
          class="absolute inset-0 flex items-center justify-center text-[10px] text-white font-medium"
        >
          {formatDuration(span.duration)}
        </span>
      {/if}
    </div>

    <!-- Event markers in sub-lanes -->
    {#each eventLanes as lane, laneIdx (laneIdx)}
      {#each lane as eventIdx (eventIdx)}
        {@const event = span.events![eventIdx]}
        {@const eventPos =
          trace.duration > 0
            ? ((event.timestamp - trace.startTime) / trace.duration) * 100
            : 0}
        {@const topOffset = 28 + laneIdx * 8}
        <div
          class={cn(
            'absolute w-2 h-2 rounded-full border border-white z-10',
            event.name === 'exception' ? 'bg-red-500' : 'bg-yellow-500',
          )}
          style={`left: ${Math.min(Math.max(eventPos, 0), 100)}%; top: ${topOffset}px;`}
          title={`${event.name} at ${formatDuration(event.timestamp - trace.startTime)}`}
        ></div>
      {/each}
    {/each}
  </div>

  <!-- Duration column -->
  <div class="w-[80px] shrink-0 px-2 py-2 text-right">
    <span
      class={cn(
        'text-xs font-mono',
        isError ? 'text-red-600' : 'text-fg-muted',
      )}
    >
      {formatDuration(span.duration)}
    </span>
  </div>
</div>
