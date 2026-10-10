<script lang="ts">
  import { onMount } from 'svelte';
  import WaterfallView from '../components/WaterfallView.svelte';
  import { formatDuration } from '../utils';
  import type { SpanData, TraceData } from '../types';
  import {
    connectToHost,
    type HostConnection,
    type HostContext,
    type ToolResult,
  } from './host';
  import { toTraceData, traceFromToolResult } from './trace-data';
  import { selectionContext } from './selection';

  // Rows are about 37px, and the waterfall's time axis and kind legend take
  // about 80px more. The frame grows with the trace up to a cap, and the
  // waterfall scrolls past it.
  const ROW_PX = 37;
  const CHROME_PX = 80;
  const MIN_PX = 160;
  const MAX_PX = 520;

  let trace = $state<TraceData | null>(null);
  let notice = $state('Waiting for the trace…');
  let selected = $state<SpanData | null>(null);
  let host: HostConnection | undefined;
  let rootEl: HTMLDivElement | undefined = $state();

  const errorCount = $derived(
    trace?.spans.filter((s) => s.status.code === 'ERROR').length ?? 0,
  );
  const height = $derived(
    Math.min(
      MAX_PX,
      Math.max(MIN_PX, (trace?.spans.length ?? 0) * ROW_PX + CHROME_PX),
    ),
  );

  function applyTheme(context: HostContext): void {
    if (context.theme) document.documentElement.dataset.theme = context.theme;
  }

  function showResult(result: ToolResult): void {
    const found = traceFromToolResult(result);
    trace = found ? toTraceData(found) : null;
    selected = null;
    if (!trace) notice = 'No trace to show for this call.';
  }

  function select(span: SpanData | null): void {
    selected = span;
    if (span)
      void host?.updateModelContext(selectionContext(span)).catch(() => {});
  }

  onMount(() => {
    let closed = false;
    void connectToHost({
      onToolResult: showResult,
      onHostContext: applyTheme,
    }).then(
      (connection) => {
        if (closed) return connection.close();
        host = connection;
        applyTheme(connection.hostContext);
      },
      () => {
        notice = 'Could not connect to the chat host.';
      },
    );

    const observer = new ResizeObserver(() => {
      if (rootEl) host?.reportSize(Math.ceil(rootEl.scrollHeight));
    });
    if (rootEl) observer.observe(rootEl);
    return () => {
      closed = true;
      observer.disconnect();
      host?.close();
    };
  });
</script>

<div bind:this={rootEl} class="bg-surface text-fg font-sans text-sm">
  {#if trace}
    <header
      class="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 border-b border-line"
    >
      <span class="font-semibold truncate">{trace.rootSpan.name}</span>
      <span class="text-fg-muted">{trace.service}</span>
      <span class="font-mono text-fg-muted"
        >{formatDuration(trace.duration)}</span
      >
      <span class="text-fg-subtle">{trace.spans.length} spans</span>
      {#if errorCount > 0}
        <span class="text-danger">{errorCount} failed</span>
      {/if}
      {#if trace.partial}
        <span class="text-fg-subtle">partial trace</span>
      {/if}
    </header>
    <div style:height="{height}px">
      <WaterfallView
        {trace}
        selectedSpanId={selected?.spanId ?? null}
        onSpanSelect={select}
      />
    </div>
    <footer class="px-3 py-2 border-t border-line text-xs text-fg-subtle">
      {#if selected}
        <span class="text-fg">{selected.name}</span>
        · {formatDuration(selected.duration)}
        {#if selected.status.code === 'ERROR'}
          · <span class="text-danger"
            >{selected.status.message ?? 'failed'}</span
          >
        {/if}
        · ask about it in the chat
      {:else}
        Select a span to ask about it in the chat.
      {/if}
    </footer>
  {:else}
    <p class="px-3 py-6 text-center text-fg-subtle">{notice}</p>
  {/if}
</div>
