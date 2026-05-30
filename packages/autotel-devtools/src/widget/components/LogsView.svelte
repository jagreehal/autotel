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
    if (!query) return true;
    const needle = query.toLowerCase();
    if (logBodyText(log.body).toLowerCase().includes(needle)) return true;
    if (log.severityText?.toLowerCase().includes(needle)) return true;
    if (log.resourceName?.toLowerCase().includes(needle)) return true;
    if (log.traceId?.toLowerCase().includes(needle)) return true;
    return false;
  }

  function severityColor(
    severityText?: string,
    severityNumber?: number,
  ): string {
    const s = (severityText ?? '').toUpperCase();
    if (s === 'ERROR' || (severityNumber !== undefined && severityNumber >= 17))
      return 'text-red-700 bg-red-50 border-red-200';
    if (
      s === 'WARN' ||
      s === 'WARNING' ||
      (severityNumber !== undefined && severityNumber >= 13)
    )
      return 'text-amber-700 bg-amber-50 border-amber-200';
    if (s === 'INFO' || (severityNumber !== undefined && severityNumber >= 9))
      return 'text-fg-muted bg-subtle border-line';
    if (s === 'DEBUG') return 'text-fg-muted bg-subtle border-line';
    return 'text-fg-muted bg-subtle border-line';
  }
</script>

<script lang="ts">
  /**
   * Logs view - OTel log stream with optional trace linking
   */
  import { FileText, Link2, Pause, Play, Search, X } from '@lucide/svelte';
  import {
    sortedLogsSignal,
    setSelectedTrace,
    setSelectedTab,
    pausedSignal,
    pendingLogCountSignal,
    togglePaused,
    dropPendingBuffer,
  } from '../store.svelte';
  import { formatTimestamp } from '../utils';
  import { cn } from '../utils/cn';

  const logs = $derived(sortedLogsSignal.value);
  const paused = $derived(pausedSignal.value);
  const pendingCount = $derived(pendingLogCountSignal.value);

  let query = $state('');
  let severityFilter = $state<SeverityFilter>('all');

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
  {@const colorClass = severityColor(log.severityText, log.severityNumber)}
  {@const body = logBodyText(log.body)}
  <div class={cn('p-3 rounded-md border text-sm', colorClass)}>
    <div class="flex items-start justify-between gap-2 mb-1">
      <span class="font-medium text-xs uppercase">
        {log.severityText ?? 'LOG'}
      </span>
      <span class="text-xs text-fg-subtle flex-shrink-0">
        {formatTimestamp(log.timestamp)}
      </span>
    </div>
    <div class="font-mono text-xs break-words mb-2">{body}</div>
    {#if log.traceId}
      <button
        type="button"
        onclick={() => goToTrace(log)}
        class="inline-flex items-center gap-1 text-xs text-fg-muted hover:underline"
      >
        <Link2 size={12} />
        Go to trace
      </button>
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
            ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
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
    <div class="relative flex-1">
      <Search
        size={12}
        class="absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle"
      />
      <input
        value={query}
        oninput={(event) =>
          (query = (event.currentTarget as HTMLInputElement).value)}
        class="w-full pl-7 pr-7 py-1 text-xs rounded border border-line focus:border-line focus:outline-none"
        placeholder="Filter by message, resource, trace id…"
      />
      {#if query}
        <button
          onclick={() => (query = '')}
          class="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-fg-subtle hover:text-fg-muted"
          title="Clear filter"
        >
          <X size={12} />
        </button>
      {/if}
    </div>
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

  <div class="flex-1 overflow-auto p-4 space-y-2">
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
