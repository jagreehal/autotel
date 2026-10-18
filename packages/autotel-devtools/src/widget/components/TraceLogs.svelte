<script lang="ts">
  /**
   * The logs a trace wrote, under its waterfall, in the order they happened.
   *
   * Read from the store by trace id, every page of it, so a trace opened from
   * history shows its logs as well as one still in the live tail. Live lines
   * are merged in by id, so a line the store has not returned yet, or a
   * refresh that failed, never hides one. Clicking a line selects the span
   * that wrote it.
   */
  import { untrack } from 'svelte';
  import { FileText } from '@lucide/svelte';
  import { queryLogs } from '../query-client';
  import { httpBaseFromWsUrl } from '../source-client';
  import {
    connectionUrlSignal,
    logsSignal,
    timeZoneSignal,
  } from '../store.svelte';
  import { formatClock } from '../timeFormat';
  import { cn } from '../utils/cn';
  import type { LogData, TraceData } from '../types';

  interface Props {
    trace: TraceData;
    selectedSpanId?: string;
    onSpanSelect: (spanId: string) => void;
  }
  let { trace, selectedSpanId, onSpanSelect }: Props = $props();

  let stored = $state<{ traceId: string; logs: LogData[] } | null>(null);

  const live = $derived(
    logsSignal.value.filter((log) => log.traceId === trace.traceId),
  );

  // A string, so a log for another trace (a new `live` array, same ids) is no
  // change. Ids rather than a count: the live buffer is capped, and once full a
  // busy trace swaps lines without changing how many it holds.
  const liveIds = $derived(live.map((log) => log.id).join('\n'));
  let refresh = $state(0);
  let inFlight = false;
  let queued = false;

  // Read every page when the trace or connection changes, or on a queued
  // refresh. A refresh never interrupts pagination: it waits for it.
  $effect(() => {
    const traceId = trace.traceId;
    void refresh;
    const wsUrl = connectionUrlSignal.value;
    const controller = new AbortController();
    const deps = {
      fetch: globalThis.fetch.bind(globalThis),
      baseUrl:
        (wsUrl ? httpBaseFromWsUrl(wsUrl) : null) ?? globalThis.location.origin,
      signal: controller.signal,
    };
    inFlight = true;
    void (async () => {
      const logs: LogData[] = [];
      let cursor: string | undefined;
      try {
        do {
          const result = await queryLogs(
            { query: `trace_id = "${traceId}"`, limit: 200, cursor },
            deps,
          );
          if (result.status !== 'ok') return;
          logs.push(...result.logs);
          cursor = result.nextCursor ?? undefined;
        } while (cursor);
        stored = { traceId, logs };
      } finally {
        if (!controller.signal.aborted) {
          inFlight = false;
          if (queued) {
            queued = false;
            refresh++;
          }
        }
      }
    })();
    return () => controller.abort();
  });

  // This trace's live lines changed: re-read the store once the current read
  // finishes, so it holds what arrived and what the buffer has since dropped.
  let seenIds: string | undefined;
  $effect(() => {
    const ids = liveIds;
    untrack(() => {
      if (seenIds !== undefined && ids !== seenIds) {
        if (inFlight) queued = true;
        else refresh++;
      }
      seenIds = ids;
    });
  });

  const logs = $derived(
    [
      ...new Map(
        [
          ...(stored?.traceId === trace.traceId ? stored.logs : []),
          ...live,
        ].map((log) => [log.id, log]),
      ).values(),
    ].sort((a, b) => a.timestamp - b.timestamp),
  );

  const spanNames = $derived(
    new Map(trace.spans.map((span) => [span.spanId, span.name])),
  );
</script>

{#if logs.length > 0}
  <section
    class="shrink-0 max-h-[35%] flex flex-col border-t border-line"
    aria-label="Logs in this trace"
  >
    <div class="flex items-center gap-2 px-4 py-2 border-b border-line-subtle">
      <FileText size={14} class="text-fg-subtle" />
      <span class="text-xs font-medium text-fg-muted">
        Logs ({logs.length})
      </span>
    </div>
    <div class="overflow-auto">
      {#each logs as log (log.id)}
        <!-- Pino and others send lowercase; colour by level whatever the case. -->
        {@const severity = (log.severityText || 'INFO').toUpperCase()}
        <button
          type="button"
          disabled={!log.spanId}
          onclick={() => log.spanId && onSpanSelect(log.spanId)}
          class={cn(
            'w-full flex items-baseline gap-3 px-4 py-1 text-left text-xs',
            'border-b border-line-subtle hover:bg-hover disabled:hover:bg-transparent',
            'focus-visible:outline-none focus-visible:bg-hover',
            log.spanId && log.spanId === selectedSpanId && 'bg-selected',
          )}
        >
          <span class="font-mono text-fg-subtle tabular-nums shrink-0">
            {formatClock(log.timestamp, timeZoneSignal.value)}
          </span>
          <span
            class={cn(
              'font-mono font-medium shrink-0 w-10',
              severity === 'ERROR'
                ? 'text-danger'
                : severity === 'WARN'
                  ? 'text-warning'
                  : 'text-fg-subtle',
            )}
          >
            {severity}
          </span>
          <span class="font-mono text-fg truncate flex-1 min-w-0">
            {typeof log.body === 'string' ? log.body : JSON.stringify(log.body)}
          </span>
          {#if log.spanId && spanNames.has(log.spanId)}
            <span class="text-fg-subtle truncate shrink-0 max-w-[30%]">
              {spanNames.get(log.spanId)}
            </span>
          {/if}
        </button>
      {/each}
    </div>
  </section>
{/if}
