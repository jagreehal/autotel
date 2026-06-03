<script lang="ts">
  /**
   * Traces view - displays trace list and detailed trace viewer with waterfall visualization
   */
  import {
    Database,
    AlertCircle,
    ChevronRight,
    Download,
    Pause,
    Play,
    HelpCircle,
    Trash2,
    Upload,
    ArrowUp,
    ArrowDown,
  } from '@lucide/svelte';
  import {
    sortedTracesSignal,
    selectedTraceSignal,
    setSelectedTrace,
    pausedSignal,
    pendingTraceCountSignal,
    togglePaused,
    dropPendingBuffer,
    selectedTraceIdsSignal,
    selectedTraceCountSignal,
    toggleTraceSelection,
    selectAllTraces,
    clearTraceSelection,
    deleteSelectedTraces,
    importTraces,
    helpShortcutsSignal,
    openHelp,
    traceSortSignal,
    setTraceSort,
  } from '../store.svelte';
  import type { TraceSortKey } from '../store.svelte';
  import { serviceColor } from '../utils/serviceColor';
  import { TRACE_LIST_SHORTCUTS } from '../shortcuts';
  import { formatDuration, formatTimestamp } from '../utils';
  import { cn } from '../utils/cn';
  import { isInputFocused, activateOnKey } from '../utils/keyboard';
  import TraceImportModal from './TraceImportModal.svelte';
  import TraceDetailView from './TraceDetailView.svelte';
  import CopyButton from './CopyButton.svelte';
  import SearchInput from './SearchInput.svelte';
  import { useListKeyboardNav } from './listNav.svelte';
  import { matchesNeedle } from '../utils/textMatch';
  import {
    readFileAsText,
    parseImportedJson,
    downloadTracesAsJson,
  } from '../export-import';
  import type { TraceData } from '../types';

  type StatusFilter = 'all' | 'error' | 'ok';

  function traceMatches(
    trace: TraceData,
    query: string,
    status: StatusFilter,
    minDurationMs: number,
  ): boolean {
    if (status === 'error' && trace.status !== 'ERROR') return false;
    if (status === 'ok' && trace.status === 'ERROR') return false;
    if (minDurationMs > 0 && trace.duration < minDurationMs) return false;
    return matchesNeedle(query.toLowerCase(), [
      trace.service,
      trace.rootSpan?.name,
      trace.traceId,
      trace.correlationId,
      ...trace.spans.map((span) => span.name),
    ]);
  }

  const traces = $derived(sortedTracesSignal.value);
  const sort = $derived(traceSortSignal.value);
  const selectedTrace = $derived(selectedTraceSignal.value);
  const paused = $derived(pausedSignal.value);
  const pendingCount = $derived(pendingTraceCountSignal.value);
  const selectedIds = $derived(selectedTraceIdsSignal.value);
  const selectedCount = $derived(selectedTraceCountSignal.value);

  let query = $state('');
  let statusFilter = $state<StatusFilter>('all');
  let minDuration = $state(0);
  let searchRef: HTMLInputElement | null = $state(null);
  let showImport = $state(false);

  const hasSelection = $derived(selectedCount > 0);

  // Keyboard shortcuts for trace list. `?` help is owned globally by Layout.
  $effect(() => {
    if (selectedTrace) return;
    const handleKeydown = (e: KeyboardEvent) => {
      if (helpShortcutsSignal.value || showImport) return; // a modal is open
      if (e.key === '/' && !isInputFocused()) {
        e.preventDefault();
        searchRef?.focus();
        return;
      }
      if (e.key === 'Escape') {
        if (hasSelection) {
          clearTraceSelection();
        } else if (document.activeElement === searchRef) {
          query = '';
        }
      }
      if (e.key === 'a' && (e.metaKey || e.ctrlKey) && !isInputFocused()) {
        e.preventDefault();
        selectAllTraces();
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });

  const filtered = $derived.by(() =>
    traces.filter((trace) =>
      traceMatches(trace, query, statusFilter, minDuration),
    ),
  );

  // Keyboard row navigation over the filtered list.
  let listRef: HTMLDivElement | undefined = $state();

  const nav = useListKeyboardNav({
    count: () => filtered.length,
    onActivate: (index) => {
      const trace = filtered[index];
      if (trace) setSelectedTrace(trace.traceId);
    },
    scrollToIndex: (index) =>
      queueMicrotask(() => {
        listRef
          ?.querySelector<HTMLElement>(`[data-row-index="${index}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      }),
  });

  function handleExportSelected() {
    const selected = traces.filter((t) => selectedIds.has(t.traceId));
    if (selected.length > 0) downloadTracesAsJson(selected);
  }

  const isFiltered = $derived(
    query.length > 0 || statusFilter !== 'all' || minDuration > 0,
  );
  const allFilteredSelected = $derived(
    filtered.length > 0 && filtered.every((t) => selectedIds.has(t.traceId)),
  );
</script>

{#snippet sortHeader(
  label: string,
  sortKey: TraceSortKey,
  align?: 'end',
  extraClass?: string,
)}
  {@const active = sort.key === sortKey}
  <button
    onclick={() => setTraceSort(sortKey)}
    class={cn(
      'flex items-center gap-1 min-w-0 transition-colors hover:text-fg-muted',
      active ? 'text-fg-muted' : 'text-fg-subtle',
      align === 'end' && 'justify-end',
      extraClass,
    )}
    title={`Sort by ${label.toLowerCase()}`}
  >
    <span class="truncate">{label}</span>
    {#if active}
      {#if sort.dir === 'asc'}
        <ArrowUp size={11} class="flex-shrink-0" />
      {:else}
        <ArrowDown size={11} class="flex-shrink-0" />
      {/if}
    {/if}
  </button>
{/snippet}

{#snippet traceRow(trace: TraceData, isSelected: boolean, index: number)}
  {@const isError = trace.status === 'ERROR'}
  {@const sc = serviceColor(trace.service || 'unknown')}
  {@const isCursor = nav.cursor === index}
  <div
    class={cn(
      'group trace-grid px-4 py-2 border-b border-line-subtle cursor-pointer transition-colors',
      isSelected
        ? 'bg-accent/10'
        : isError
          ? 'bg-danger-bg/40 hover:bg-danger-bg/70'
          : 'hover:bg-hover',
      isCursor && 'ring-1 ring-inset ring-accent bg-accent/10',
    )}
    role="option"
    aria-selected={isCursor}
    tabindex="-1"
    data-row-index={index}
    data-focus-inset
    onclick={() => {
      nav.cursor = index;
      setSelectedTrace(trace.traceId);
    }}
    onkeydown={activateOnKey(() => setSelectedTrace(trace.traceId))}
  >
    <!-- Select. stopPropagation lives on the checkbox (interactive) so toggling
         it doesn't also fire the row's select handler. -->
    <label class="cursor-pointer flex items-center">
      <input
        type="checkbox"
        checked={isSelected}
        onclick={(e) => e.stopPropagation()}
        onchange={() => toggleTraceSelection(trace.traceId)}
        class="w-3.5 h-3.5 rounded border-line text-accent"
      />
    </label>

    <!-- Service pill -->
    <span
      class="text-[11px] font-medium px-2 py-0.5 rounded truncate"
      style="background-color: {sc.fill}; color: {sc.stroke};"
      title={trace.service || 'unknown'}
    >
      {trace.service || 'unknown'}
    </span>

    <!-- Operation -->
    <div class="flex items-center gap-1.5 min-w-0">
      {#if isError}
        <AlertCircle size={13} class="text-danger flex-shrink-0" />
      {/if}
      <span class="truncate text-sm text-fg" title={trace.rootSpan.name}>
        {trace.rootSpan.name || 'unknown'}
      </span>
      <!-- One copy affordance per row (trace ID — the primary thing to grab).
           Correlation ID copy lives in the trace detail to avoid two identical
           icons cluttering the row. -->
      <CopyButton
        value={trace.traceId}
        label="Copy trace ID"
        class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
      />
    </div>

    <!-- Duration -->
    <span class="font-mono text-xs text-fg-muted text-right tabular-nums">
      {formatDuration(trace.duration)}
    </span>

    <!-- Span count -->
    <span
      class="trace-col-spans font-mono text-xs text-fg-subtle text-right tabular-nums"
    >
      {trace.spans.length}
    </span>

    <!-- Time -->
    <span class="trace-col-time font-mono text-[11px] text-fg-subtle truncate">
      {formatTimestamp(trace.startTime)}
    </span>

    <!-- Status -->
    <span
      class={cn(
        'text-[10px] font-semibold px-1.5 py-0.5 rounded justify-self-start',
        isError
          ? 'bg-danger-bg text-danger'
          : trace.status === 'OK'
            ? 'bg-success-bg text-success'
            : 'bg-hover text-fg-muted',
      )}
    >
      {trace.status}
    </span>

    <ChevronRight size={15} class="text-fg-subtle justify-self-end" />
  </div>
{/snippet}

{#if selectedTrace}
  <TraceDetailView trace={selectedTrace} />
{:else}
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div
      class="px-4 py-3 border-b border-line flex items-center justify-between gap-2"
    >
      <h3 class="text-sm font-semibold flex items-center gap-2 text-fg">
        <Database size={16} />
        Traces ({isFiltered
          ? `${filtered.length} of ${traces.length}`
          : traces.length})
        {#if hasSelection}
          <span class="text-xs font-normal text-accent">
            ({selectedCount} selected)
          </span>
        {/if}
      </h3>
      <div class="flex items-center gap-1">
        <!-- Bulk actions bar -->
        {#if hasSelection}
          <div class="flex items-center gap-1 mr-2 px-2 border-r border-line">
            <button
              onclick={handleExportSelected}
              class="flex items-center gap-1 px-2 py-1 text-xs rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
              title="Export selected traces"
            >
              <Download size={12} />
              Export ({selectedCount})
            </button>
            <button
              onclick={deleteSelectedTraces}
              class="flex items-center gap-1 px-2 py-1 text-xs rounded bg-danger-bg text-danger hover:bg-danger-bg/80 transition-colors"
              title="Delete selected traces"
            >
              <Trash2 size={12} />
              Delete
            </button>
          </div>
        {/if}
        <button
          onclick={togglePaused}
          class={cn(
            'flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors',
            paused
              ? 'bg-warning-bg text-warning hover:bg-warning-bg/80'
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
            title="Drop buffered traces received while paused"
          >
            Drop buffer
          </button>
        {/if}
        <button
          onclick={() => (showImport = true)}
          class="p-1.5 hover:bg-hover rounded transition-colors"
          title="Import traces from file"
        >
          <Upload size={14} class="text-fg-subtle" />
        </button>
        {#if traces.length > 0}
          <button
            onclick={() => downloadTracesAsJson(traces)}
            class="p-1.5 hover:bg-hover rounded transition-colors"
            title="Export all traces as JSON"
          >
            <Download size={14} class="text-fg-subtle" />
          </button>
        {/if}
        <button
          onclick={() => openHelp(TRACE_LIST_SHORTCUTS)}
          class="p-1.5 hover:bg-hover rounded transition-colors"
          title="Keyboard shortcuts (?)"
        >
          <HelpCircle size={14} class="text-fg-subtle" />
        </button>
      </div>
    </div>

    <!-- Filter bar -->
    <div class="px-4 py-2 border-b border-line flex items-center gap-2">
      <SearchInput
        bind:value={query}
        bind:ref={searchRef}
        placeholder="Filter by service, span, trace id…"
      />
      <select
        value={statusFilter}
        onchange={(event) =>
          (statusFilter = (event.currentTarget as HTMLSelectElement)
            .value as StatusFilter)}
        class="text-xs border border-line rounded px-1.5 py-1 bg-surface text-fg-muted"
      >
        <option value="all">All</option>
        <option value="error">Errors</option>
        <option value="ok">OK</option>
      </select>
      <!-- Min duration -->
      <div
        class="flex items-center text-xs text-fg-subtle flex-shrink-0"
        title="Only show traces at least this slow"
      >
        <span class="mr-1">≥</span>
        <input
          type="number"
          min={0}
          step={50}
          value={minDuration || ''}
          placeholder="0"
          oninput={(event) =>
            (minDuration =
              Number((event.currentTarget as HTMLInputElement).value) || 0)}
          class="w-14 px-1 py-1 rounded border border-line bg-surface text-fg-muted focus:outline-none"
        />
        <span class="ml-1">ms</span>
      </div>
    </div>

    <!-- Traces list — dense, sortable, container-responsive -->
    <div
      bind:this={listRef}
      class="trace-list-container flex-1 overflow-auto focus:outline-none"
      role="listbox"
      aria-label="Traces"
      tabindex="0"
      onkeydown={nav.onKeyDown}
    >
      {#if traces.length === 0}
        <div class="text-center text-fg-subtle text-sm py-12">
          <p class="mb-3">No traces yet. Waiting for data…</p>
        </div>
      {:else if filtered.length === 0}
        <div class="text-center text-fg-subtle text-sm py-12">
          No traces match the current filter.
        </div>
      {:else}
        <div>
          <!-- Column header -->
          <div
            class="trace-grid sticky top-0 z-10 px-4 py-2 border-b border-line bg-subtle text-[11px] font-semibold uppercase tracking-wide text-fg-subtle"
          >
            <label
              class="cursor-pointer flex items-center"
              title={allFilteredSelected ? 'Clear selection' : 'Select all'}
            >
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onclick={(e) => e.stopPropagation()}
                onchange={() =>
                  allFilteredSelected
                    ? clearTraceSelection()
                    : selectAllTraces()}
                class="w-3.5 h-3.5 rounded border-line text-accent"
              />
            </label>
            {@render sortHeader('Service', 'service')}
            {@render sortHeader('Operation', 'name')}
            {@render sortHeader('Duration', 'duration', 'end')}
            {@render sortHeader('Spans', 'spans', 'end', 'trace-col-spans')}
            {@render sortHeader('Time', 'time', undefined, 'trace-col-time')}
            {@render sortHeader('Status', 'status')}
            <span></span>
          </div>

          {#each filtered as trace, index (trace.traceId)}
            {@render traceRow(trace, selectedIds.has(trace.traceId), index)}
          {/each}
        </div>
      {/if}
    </div>

    {#if showImport}
      <TraceImportModal
        onclose={() => (showImport = false)}
        onimport={async (file: File) => {
          try {
            const text = await readFileAsText(file);
            const result = parseImportedJson(text);
            if (result.success && result.traces.length > 0) {
              importTraces(result.traces);
              return {
                imported: result.traces.length,
                errors: [],
                warnings: result.warnings,
              };
            }
            return {
              imported: 0,
              errors: result.errors,
              warnings: result.warnings,
            };
          } catch (err) {
            return { imported: 0, errors: [String(err)], warnings: [] };
          }
        }}
      />
    {/if}
  </div>
{/if}
