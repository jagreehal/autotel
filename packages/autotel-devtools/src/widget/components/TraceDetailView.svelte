<script lang="ts">
  import {
    ChevronLeft,
    LayoutList,
    BarChart3,
    Flame,
    Download,
    Copy,
    Check,
    HelpCircle,
  } from '@lucide/svelte';
  import {
    setSelectedTrace,
    helpShortcutsSignal,
    openHelp,
  } from '../store.svelte';
  import { TRACE_DETAIL_SHORTCUTS } from '../shortcuts';
  import { formatDuration, getStatusColor } from '../utils';
  import { cn } from '../utils/cn';
  import { isInputFocused } from '../utils/keyboard';
  import WaterfallView from './WaterfallView.svelte';
  import FlameGraphView from './FlameGraphView.svelte';
  import SpanDetailPanel from './SpanDetailPanel.svelte';
  import ResizeHandle from './ResizablePanel.svelte';
  import { useResizable } from './resizable.svelte';
  import SpanRow from './SpanRow.svelte';
  import { downloadTraceAsJson, copyTraceToClipboard } from '../export-import';
  import type { TraceData, SpanData } from '../types';

  type ViewMode = 'waterfall' | 'flame' | 'list';

  interface Props {
    trace: TraceData;
  }
  let { trace }: Props = $props();

  let viewMode = $state<ViewMode>('waterfall');
  let selectedSpan = $state<SpanData | null>(null);
  let copied = $state(false);
  let contentRef: HTMLDivElement | undefined = $state();

  const resizable = useResizable({
    initial: 320,
    min: 260,
    minOther: 360,
    containerRef: {
      get current() {
        return contentRef ?? null;
      },
    },
    storageKey: 'autotel-devtools:span-detail-width',
    invert: true,
  });
  const detailWidth = $derived(resizable.size);
  const dragging = $derived(resizable.dragging);
  const separatorProps = $derived(resizable.separatorProps);

  /** Cycle to the next/previous error span relative to the current selection. */
  function stepErrorSpan(
    spans: SpanData[],
    current: SpanData | null,
    dir: 1 | -1,
  ): SpanData | null {
    const errors = spans.filter((s) => s.status.code === 'ERROR');
    if (errors.length === 0) return null;
    const idx = current
      ? errors.findIndex((s) => s.spanId === current.spanId)
      : -1;
    return errors[(idx + dir + errors.length) % errors.length];
  }

  // Keyboard shortcuts for trace detail. `?` help is owned globally by Layout.
  $effect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if (helpShortcutsSignal.value) return; // help modal open
      if (e.key === 'Escape') {
        if (selectedSpan) {
          selectedSpan = null;
        } else {
          setSelectedTrace(null);
        }
        return;
      }
      if (isInputFocused()) return;
      if (e.key === 'w') {
        e.preventDefault();
        viewMode = 'waterfall';
      } else if (e.key === 'f') {
        e.preventDefault();
        viewMode = 'flame';
      } else if (e.key === 'l') {
        e.preventDefault();
        viewMode = 'list';
      } else if (e.key === 'e' && !e.shiftKey) {
        e.preventDefault();
        const next = stepErrorSpan(trace.spans, selectedSpan, 1);
        if (next) selectedSpan = next;
      } else if (e.key === 'E' && e.shiftKey) {
        e.preventDefault();
        const next = stepErrorSpan(trace.spans, selectedSpan, -1);
        if (next) selectedSpan = next;
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });

  function formatDate(timestamp: number) {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  function handleDownload() {
    downloadTraceAsJson(trace);
  }

  async function handleCopy() {
    await copyTraceToClipboard(trace);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<div class="flex flex-col h-full">
  <!-- Header -->
  <div class="px-4 py-3 border-b border-line">
    <div class="flex items-center justify-between mb-3">
      <button
        onclick={() => setSelectedTrace(null)}
        class={cn(
          'text-xs text-fg-muted hover:text-fg',
          'flex items-center gap-1 transition-colors',
        )}
      >
        <ChevronLeft size={14} />
        Back to traces
      </button>

      <div class="flex items-center gap-2">
        <!-- Export buttons -->
        <div class="flex items-center gap-1">
          <button
            onclick={handleCopy}
            class="p-1.5 hover:bg-hover rounded transition-colors"
            title="Copy trace JSON to clipboard"
          >
            {#if copied}
              <Check size={14} class="text-green-600" />
            {:else}
              <Copy size={14} class="text-fg-subtle" />
            {/if}
          </button>
          <button
            onclick={handleDownload}
            class="p-1.5 hover:bg-hover rounded transition-colors"
            title="Download trace as JSON"
          >
            <Download size={14} class="text-fg-subtle" />
          </button>
        </div>

        <!-- View mode toggle -->
        <div class="flex items-center gap-1 bg-hover rounded-md p-0.5">
          <button
            onclick={() => (viewMode = 'waterfall')}
            class={cn(
              'px-2 py-1 text-xs rounded transition-colors flex items-center gap-1',
              viewMode === 'waterfall'
                ? 'bg-surface text-fg shadow-sm'
                : 'text-fg-muted hover:text-fg',
            )}
            title="Waterfall view (w)"
          >
            <BarChart3 size={12} />
            Timeline
          </button>
          <button
            onclick={() => (viewMode = 'flame')}
            class={cn(
              'px-2 py-1 text-xs rounded transition-colors flex items-center gap-1',
              viewMode === 'flame'
                ? 'bg-surface text-fg shadow-sm'
                : 'text-fg-muted hover:text-fg',
            )}
            title="Flame graph view (f)"
          >
            <Flame size={12} />
            Flame
          </button>
          <button
            onclick={() => (viewMode = 'list')}
            class={cn(
              'px-2 py-1 text-xs rounded transition-colors flex items-center gap-1',
              viewMode === 'list'
                ? 'bg-surface text-fg shadow-sm'
                : 'text-fg-muted hover:text-fg',
            )}
            title="List view (l)"
          >
            <LayoutList size={12} />
            List
          </button>
        </div>
        <button
          onclick={() => openHelp(TRACE_DETAIL_SHORTCUTS)}
          class="p-1.5 hover:bg-hover rounded transition-colors"
          title="Keyboard shortcuts (?)"
        >
          <HelpCircle size={14} class="text-fg-subtle" />
        </button>
      </div>
    </div>

    <div class="flex items-start justify-between gap-4">
      <div class="flex-1 min-w-0">
        <h3 class="font-semibold text-base mb-1.5 text-fg">
          {trace.rootSpan.name || 'Trace'}
        </h3>
        <div class="text-xs text-fg-subtle space-y-0.5">
          <div>{formatDate(trace.startTime)}</div>
          <div class="font-mono">Trace ID: {trace.traceId}</div>
        </div>
      </div>

      <div class="text-right flex-shrink-0">
        <div
          class={cn('font-medium text-sm mb-1', getStatusColor(trace.status))}
        >
          {trace.status}
        </div>
        <div class="text-xs text-fg-muted">
          {formatDuration(trace.duration)}
        </div>
        <div class="text-xs text-fg-subtle mt-1">
          {trace.spans.length} spans
        </div>
      </div>
    </div>
  </div>

  <!-- Content area - flex row for waterfall + detail panel -->
  <div bind:this={contentRef} class="flex-1 overflow-hidden flex">
    <!-- Main content -->
    <div class="flex-1 overflow-hidden min-w-0">
      {#if viewMode === 'waterfall'}
        <WaterfallView
          {trace}
          onSpanSelect={(s) => (selectedSpan = s)}
          selectedSpanId={selectedSpan?.spanId}
        />
      {:else if viewMode === 'flame'}
        <FlameGraphView
          {trace}
          onSpanSelect={(s) => (selectedSpan = s)}
          selectedSpanId={selectedSpan?.spanId}
        />
      {:else}
        <div class="overflow-auto h-full">
          <div class="divide-y divide-zinc-100">
            {#each trace.spans as span (span.spanId)}
              <SpanRow
                {span}
                {trace}
                isSelected={selectedSpan?.spanId === span.spanId}
                onSelect={() => (selectedSpan = span)}
              />
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <!-- Resizable span detail panel (right side) -->
    {#if selectedSpan}
      <ResizeHandle
        {dragging}
        title="Drag to resize the detail panel · double-click to reset"
        {...separatorProps}
      />
      <div
        class="flex-shrink-0 overflow-hidden"
        style="width: {detailWidth}px;"
      >
        <SpanDetailPanel
          span={selectedSpan}
          {trace}
          onClose={() => (selectedSpan = null)}
        />
      </div>
    {/if}
  </div>
</div>
