<script lang="ts" module>
  import type { LogData } from '../types';

  type SeverityFilter = 'all' | 'error' | 'warn' | 'info';

  function severityRank(log: LogData): SeverityFilter {
    const severityNumber = log.severityNumber;
    const text = (log.severityText ?? '').toUpperCase();
    if (
      text === 'ERROR' ||
      (severityNumber !== undefined && severityNumber >= 17)
    )
      return 'error';
    if (
      text === 'WARN' ||
      text === 'WARNING' ||
      (severityNumber !== undefined && severityNumber >= 13)
    )
      return 'warn';
    return 'info';
  }

  function logBodyText(body: string | Record<string, unknown>): string {
    if (typeof body === 'string') return body;
    try {
      return JSON.stringify(body);
    } catch {
      return String(body);
    }
  }

  function logJson(log: LogData): string {
    try {
      return JSON.stringify(
        {
          body: log.body,
          severity: log.severityText ?? null,
          severityNumber: log.severityNumber ?? null,
          timestamp: log.timestamp,
          traceId: log.traceId ?? null,
          attributes: log.attributes ?? {},
        },
        null,
        2,
      );
    } catch {
      return logBodyText(log.body);
    }
  }

  function logMatches(
    log: LogData,
    query: string,
    severity: SeverityFilter,
  ): boolean {
    if (severity !== 'all') {
      const rank = severityRank(log);
      if (severity === 'error' && rank !== 'error') return false;
      if (severity === 'warn' && rank !== 'warn' && rank !== 'error')
        return false;
      if (severity === 'info' && rank !== 'info') return false;
    }
    return matchesNeedle(query.toLowerCase(), [
      logBodyText(log.body),
      log.severityText,
      log.resourceName,
      log.traceId,
    ]);
  }

  /** Semantic text colour for the dense-row severity chip/dot. */
  function severityToneText(log: LogData): string {
    const rank = severityRank(log);
    if (rank === 'error') return 'text-danger';
    if (rank === 'warn') return 'text-warning';
    return 'text-fg-subtle';
  }

  /** 2px left accent bar colour for the dense row (semantic tokens only). */
  function severityAccentBar(log: LogData): string {
    const rank = severityRank(log);
    if (rank === 'error') return 'bg-danger';
    if (rank === 'warn') return 'bg-warning';
    return 'bg-line';
  }

  /** Fixed-width clock timestamp (HH:MM:SS) for the dense monospace column. */
  function clockTime(timestamp: number): string {
    const d = new Date(timestamp);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function logAttributes(log: LogData): string {
    try {
      return JSON.stringify(log.attributes ?? {}, null, 2);
    } catch {
      return '{}';
    }
  }
</script>

<script lang="ts">
  /**
   * Logs view - OTel log stream with optional trace linking
   */
  import { FileText, Link2, Pause, Play } from '@lucide/svelte';
  import {
    sortedLogsSignal,
    setSelectedTrace,
    setSelectedTab,
    pausedSignal,
    pendingLogCountSignal,
    togglePaused,
    dropPendingBuffer,
  } from '../store.svelte';
  import { cn } from '../utils/cn';
  import CopyButton from './CopyButton.svelte';
  import Copyable from './Copyable.svelte';
  import SearchInput from './SearchInput.svelte';
  import { matchesNeedle } from '../utils/textMatch';

  const logs = $derived(sortedLogsSignal.value);
  const paused = $derived(pausedSignal.value);
  const pendingCount = $derived(pendingLogCountSignal.value);

  let query = $state('');
  let severityFilter = $state<SeverityFilter>('all');
  let expanded = $state<Set<string>>(new Set());

  function toggleExpanded(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded = next;
  }

  const filtered = $derived.by(() =>
    logs.filter((log) => logMatches(log, query, severityFilter)),
  );

  const isFiltered = $derived(query.length > 0 || severityFilter !== 'all');

  function goToTrace(log: LogData) {
    if (log.traceId) {
      setSelectedTrace(log.traceId);
      setSelectedTab('traces');
    }
  }
</script>

{#snippet logRow(log: LogData)}
  {@const body = logBodyText(log.body)}
  {@const toneText = severityToneText(log)}
  {@const accentBar = severityAccentBar(log)}
  {@const isOpen = expanded.has(log.id)}
  <div
    class="group relative flex flex-col border-b border-line-subtle hover:bg-hover"
  >
    <!-- 2px severity accent bar instead of a full tinted background -->
    <span
      aria-hidden="true"
      class={cn('absolute inset-y-0 left-0 w-0.5', accentBar)}
    ></span>
    <div class="flex items-center gap-2 pl-3 pr-2 py-1 text-xs">
      <button
        type="button"
        onclick={() => toggleExpanded(log.id)}
        aria-expanded={isOpen}
        title={isOpen ? 'Collapse log' : 'Expand log'}
        class="flex flex-1 items-center gap-2 min-w-0 text-left"
      >
        <span class="font-mono tabular-nums text-fg-subtle flex-shrink-0">
          {clockTime(log.timestamp)}
        </span>
        <span
          class={cn(
            'flex-shrink-0 font-medium uppercase tracking-wide text-[10px]',
            toneText,
          )}
        >
          {log.severityText ?? 'LOG'}
        </span>
        <span class="font-mono text-fg truncate min-w-0 flex-1">{body}</span>
        {#if log.resourceName}
          <span class="flex-shrink-0 text-fg-subtle truncate max-w-[10rem]">
            {log.resourceName}
          </span>
        {/if}
      </button>
      {#if log.traceId}
        <button
          type="button"
          onclick={() => goToTrace(log)}
          title="Go to trace"
          aria-label="Go to trace"
          class="flex-shrink-0 inline-flex items-center justify-center p-1 rounded text-fg-subtle hover:text-fg hover:bg-hover opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        >
          <Link2 size={12} />
        </button>
      {/if}
      <CopyButton
        value={logJson(log)}
        label="Copy log as JSON"
        class="flex-shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
      />
    </div>

    {#if isOpen}
      <div class="pl-3 pr-2 pb-2 space-y-2">
        <Copyable content={body}>
          <div class="font-mono text-xs break-words whitespace-pre-wrap pr-6">
            {body}
          </div>
        </Copyable>
        {#if log.attributes && Object.keys(log.attributes).length > 0}
          <Copyable content={logAttributes(log)}>
            <pre
              class="font-mono text-[11px] text-fg-muted whitespace-pre-wrap break-words pr-6">{logAttributes(
                log,
              )}</pre>
          </Copyable>
        {/if}
        {#if log.traceId}
          <div class="flex items-center gap-1">
            <button
              type="button"
              onclick={() => goToTrace(log)}
              class="inline-flex items-center gap-1 text-xs text-fg-muted hover:underline"
            >
              <Link2 size={12} />
              Go to trace
            </button>
            <CopyButton value={log.traceId} label="Copy trace ID" />
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

<div class="flex flex-col h-full">
  <div
    class="px-4 py-3 border-b border-line flex items-center justify-between gap-2"
  >
    <h3 class="text-sm font-semibold flex items-center gap-2 text-fg">
      <FileText size={16} />
      Logs ({isFiltered ? `${filtered.length} of ${logs.length}` : logs.length})
    </h3>
    <div class="flex items-center gap-1">
      <button
        onclick={togglePaused}
        class={cn(
          'flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors',
          paused
            ? 'bg-warning-bg text-warning hover:bg-warning-bg'
            : 'hover:bg-hover text-fg-muted',
        )}
        title={paused ? 'Resume live tail' : 'Pause live tail'}
      >
        {#if paused}
          <Play size={12} />
        {:else}
          <Pause size={12} />
        {/if}
        {paused
          ? `Resume${pendingCount > 0 ? ` (+${pendingCount})` : ''}`
          : 'Pause'}
      </button>
      {#if paused && pendingCount > 0}
        <button
          onclick={dropPendingBuffer}
          class="px-2 py-1 text-xs rounded text-fg-subtle hover:bg-hover transition-colors"
          title="Drop buffered logs received while paused"
        >
          Drop buffer
        </button>
      {/if}
    </div>
  </div>

  <div class="px-4 py-2 border-b border-line flex items-center gap-2">
    <SearchInput
      bind:value={query}
      placeholder="Filter by message, resource, trace id…"
    />
    <select
      value={severityFilter}
      onchange={(event) =>
        (severityFilter = (event.currentTarget as HTMLSelectElement)
          .value as SeverityFilter)}
      class="text-xs border border-line rounded px-1.5 py-1 bg-surface text-fg-muted"
    >
      <option value="all">All</option>
      <option value="error">Errors</option>
      <option value="warn">Warn+</option>
      <option value="info">Info</option>
    </select>
  </div>

  <div class="flex-1 overflow-auto space-y-0">
    {#if logs.length === 0}
      <div class="text-center text-fg-subtle text-sm py-12">
        No logs yet. Send logs via AutotelLogExporter or POST /ingest/logs.
      </div>
    {:else if filtered.length === 0}
      <div class="text-center text-fg-subtle text-sm py-12">
        No logs match the current filter.
      </div>
    {:else}
      {#each filtered as log (log.id)}
        {@render logRow(log)}
      {/each}
    {/if}
  </div>
</div>
