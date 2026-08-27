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
    traceQuerySignal,
    traceStatusFilterSignal,
    traceMinDurationSignal,
    traceServiceFilterSignal,
    toggleTraceServiceFilter,
    clearTraceServiceFilter,
    connectionUrlSignal,
    windowedTracesSignal,
  } from '../store.svelte';
  import type { TraceSortKey, TraceStatusFilter } from '../store.svelte';
  import { serviceColor } from '../utils/serviceColor';
  import { TRACE_LIST_SHORTCUTS } from '../shortcuts';
  import { formatDuration, formatTimestamp } from '../utils';
  import { cn } from '../utils/cn';
  import { isInputFocused, activateOnKey } from '../utils/keyboard';
  import TraceImportModal from './TraceImportModal.svelte';
  import TraceDetailView from './TraceDetailView.svelte';
  import CopyButton from './CopyButton.svelte';
  import FacetFilter from './FacetFilter.svelte';
  import QueryBar from './QueryBar.svelte';
  import TimeWindowPicker from './TimeWindowPicker.svelte';
  import TailPill from './TailPill.svelte';
  import { createTraceQuery } from '../signalQuery.svelte';
  import { queryFields } from '../query-client';
  import { infiniteScroll } from '../utils/infiniteScroll';
  import { httpBaseFromWsUrl } from '../source-client';
  import type { Facet } from './facetFilter.types';
  import { useListKeyboardNav } from './listNav.svelte';
  import { matchesNeedle } from '../utils/textMatch';
  import {
    readFileAsText,
    parseImportedJson,
    downloadTracesAsJson,
  } from '../export-import';
  import type { TraceData } from '../types';

  function traceMatches(
    trace: TraceData,
    query: string,
    status: TraceStatusFilter,
    minDurationMs: number,
    services: Set<string>,
  ): boolean {
    if (status === 'error' && trace.status !== 'ERROR') return false;
    if (status === 'ok' && trace.status === 'ERROR') return false;
    if (minDurationMs > 0 && trace.duration < minDurationMs) return false;
    if (services.size > 0 && !services.has(trace.service || 'unknown'))
      return false;
    return matchesNeedle(query.toLowerCase(), [
      trace.service,
      trace.rootSpan?.name,
      trace.traceId,
      trace.correlationId,
      ...trace.spans.map((span) => span.name),
    ]);
  }

  const traces = $derived(sortedTracesSignal.value);
  const windowedTraces = $derived(windowedTracesSignal.value);
  const sort = $derived(traceSortSignal.value);
  const selectedTrace = $derived(selectedTraceSignal.value);
  const paused = $derived(pausedSignal.value);
  const pendingCount = $derived(pendingTraceCountSignal.value);
  const selectedIds = $derived(selectedTraceIdsSignal.value);
  const selectedCount = $derived(selectedTraceCountSignal.value);

  // Filters live in global signals so the full-page UI can reflect them in the
  // shareable URL. Derive locals for reading; write the signals on input.
  const query = $derived(traceQuerySignal.value);
  const statusFilter = $derived(traceStatusFilterSignal.value);
  const minDuration = $derived(traceMinDurationSignal.value);
  const serviceFilter = $derived(traceServiceFilterSignal.value);

  // Service facet options with live counts over the full trace list, so the
  // dropdown always shows every service even while a subset is selected.
  const serviceFacet = $derived.by<Facet>(() => {
    const counts = new Map<string, number>();
    for (const t of traces) {
      const s = t.service || 'unknown';
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return {
      key: 'service',
      label: 'Service',
      options: [...counts.entries()].map(([value, count]) => ({
        value,
        count,
      })),
      selected: serviceFilter,
      onToggle: toggleTraceServiceFilter,
    };
  });
  const showFacets = $derived(serviceFacet.options.length > 1);
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
          traceQuerySignal.value = '';
          traceQuery.setText('');
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

  // Server-side query controller. The store answers from the whole retained
  // history — far more than the live tail holds, and the only way to see
  // anything from before the process restarted.
  const traceQuery = createTraceQuery({
    client: {
      fetch: globalThis.fetch.bind(globalThis),
      baseUrl: queryBaseUrl,
    },
  });

  /**
   * Origin of the devtools server.
   *
   * Derived from the page in the full-page app and from the WS URL in the
   * embedded widget, which may be served from a different origin than the host
   * page it is embedded in.
   */
  function queryBaseUrl(): string {
    const wsUrl = connectionUrlSignal.value;
    return (
      (wsUrl ? httpBaseFromWsUrl(wsUrl) : null) ?? globalThis.location.origin
    );
  }

  $effect(() => () => traceQuery.dispose());

  // Load persisted history on mount, and retarget if an embedded widget learns
  // its server URL after this child component was created.
  let lastQueryOrigin = $state<string | null>(null);
  let queryFieldsList = $state<string[]>([]);
  $effect(() => {
    const origin = queryBaseUrl();
    if (origin === lastQueryOrigin) return;
    lastQueryOrigin = origin;
    void queryFields('traces', {
      fetch: globalThis.fetch.bind(globalThis),
      baseUrl: origin,
    }).then((fields) => (queryFieldsList = fields));
    if (!traceQuery.ready.value && traceQuerySignal.value) {
      traceQuery.setText(traceQuerySignal.value);
    } else {
      void traceQuery.refresh();
    }
  });

  // New traces arriving over the live stream: while live this refreshes the
  // list, while frozen it only increments the pill's count.
  let lastSeenCount = $state(0);
  $effect(() => {
    const count = traces.length;
    if (count > lastSeenCount) {
      traceQuery.arrived(count - lastSeenCount);
    }
    lastSeenCount = count;
  });

  // Selecting a row freezes the tail, so the list cannot reorder underneath the
  // trace someone has just opened.
  $effect(() => {
    traceQuery.setSelected(selectedTrace != null);
  });

  const serverResults = $derived(traceQuery.results.value);

  /**
   * The rows to render.
   *
   * The server owns the list whenever it has answered. The client-side filter
   * below remains the fallback for two cases the server cannot serve: traces
   * imported from a file (they exist only in the browser), and a devtools
   * server that is unreachable — where showing the live tail beats showing
   * nothing.
   */
  const filtered = $derived.by(() => {
    const serverReady =
      traceQuery.ready.value && traceQuery.failure.value === null;
    let source = windowedTraces;
    if (serverReady) {
      source =
        query.length > 0
          ? serverResults
          : mergeTraceRows(serverResults, windowedTraces);
    }
    // The window is applied by the shared `windowedTracesSignal`, so the
    // fallback only has the list-local filters left to apply.
    return source.filter((trace) =>
      traceMatches(
        trace,
        serverReady ? '' : query,
        statusFilter,
        minDuration,
        serviceFilter,
      ),
    );
  });

  function mergeTraceRows(
    stored: TraceData[],
    local: TraceData[],
  ): TraceData[] {
    const ids = new Set(stored.map((trace) => trace.traceId));
    return [...stored, ...local.filter((trace) => !ids.has(trace.traceId))];
  }

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
    const selected = filtered.filter((t) => selectedIds.has(t.traceId));
    if (selected.length > 0) downloadTracesAsJson(selected);
  }

  async function handleDeleteSelected() {
    const traceIds = [...selectedIds];
    if (
      traceIds.length === 0 ||
      !globalThis.confirm(
        `Delete ${traceIds.length} stored trace${traceIds.length === 1 ? '' : 's'}?`,
      )
    )
      return;
    try {
      await fetch(`${queryBaseUrl()}/api/traces`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ traceIds }),
      });
    } catch {
      // Imported traces and older receivers have no durable delete endpoint;
      // they still retain the established local-delete behaviour.
    } finally {
      const deletedIds = new Set(traceIds);
      traceQuery.removeRows((trace) => deletedIds.has(trace.traceId));
      deleteSelectedTraces();
    }
  }

  const isFiltered = $derived(
    query.length > 0 ||
      statusFilter !== 'all' ||
      minDuration > 0 ||
      serviceFilter.size > 0,
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
      // Offscreen rows are skipped by the browser rather than windowed by us,
      // so they stay real DOM for find-in-page and screen readers.
      'row-virtual',
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

    <!-- Service pill — click to toggle the service facet filter. -->
    <button
      type="button"
      onclick={(e) => {
        e.stopPropagation();
        toggleTraceServiceFilter(trace.service || 'unknown');
      }}
      class={cn(
        'text-[11px] font-medium px-2 py-0.5 rounded truncate text-left transition-shadow',
        serviceFilter.has(trace.service || 'unknown') &&
          'ring-1 ring-inset ring-accent',
      )}
      style="background-color: {sc.fill}; color: {sc.stroke};"
      title={`Filter by ${trace.service || 'unknown'}`}
    >
      {trace.service || 'unknown'}
    </button>

    <!-- Operation -->
    <div class="flex items-center gap-1.5 min-w-0">
      {#if isError}
        <AlertCircle size={13} class="text-danger flex-shrink-0" />
      {/if}
      <span class="truncate text-sm text-fg" title={trace.rootSpan.name}>
        {trace.rootSpan.name || 'unknown'}
      </span>
      {#if trace.partial}
        <span
          class="flex-shrink-0 px-1.5 py-0.5 rounded bg-warning-bg text-warning text-[10px] font-medium uppercase tracking-wide"
          title="Partial trace: the root span has not arrived, so this row shows the highest span received and a duration covering only that part."
        >
          partial
        </span>
      {/if}
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
              onclick={handleDeleteSelected}
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
        {#if filtered.length > 0}
          <button
            onclick={() => downloadTracesAsJson(filtered)}
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
      <QueryBar
        value={traceQuery.text.value}
        onInput={(v) => {
          traceQuery.setText(v);
          // Mirrored into the legacy signal so the shareable URL and the
          // client-side fallback filter both stay in step with what was typed.
          traceQuerySignal.value = v;
        }}
        onSubmit={() => traceQuery.submit()}
        serverErrors={traceQuery.errors.value}
        fields={queryFieldsList}
        bind:ref={searchRef}
        class="flex-1"
      />
      <TimeWindowPicker
        selection={traceQuery.window.value}
        onChange={(next) => traceQuery.setWindow(next)}
      />
      <TailPill
        count={traceQuery.pending}
        live={traceQuery.live}
        onResume={() => {
          traceQuerySignal.value = '';
          traceQuery.resume();
        }}
      />
      <select
        value={statusFilter}
        onchange={(event) =>
          (traceStatusFilterSignal.value = (
            event.currentTarget as HTMLSelectElement
          ).value as TraceStatusFilter)}
        class="text-xs border border-line rounded px-1.5 py-1 bg-surface text-fg-muted"
      >
        <option value="all">All</option>
        <option value="error">Errors</option>
        <option value="ok">OK</option>
      </select>
      {#if showFacets}
        <FacetFilter
          facets={[serviceFacet]}
          onClearAll={clearTraceServiceFilter}
        />
      {/if}
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
            (traceMinDurationSignal.value =
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
      {#if traceQuery.loading.value && !traceQuery.ready.value && traces.length === 0}
        <div class="text-center text-fg-subtle text-sm py-12">
          Loading traces…
        </div>
      {:else if filtered.length === 0 && !isFiltered}
        <div
          class="mx-auto flex max-w-2xl flex-col items-center gap-3 px-6 py-12 text-center text-sm text-fg-subtle"
        >
          <p class="font-medium text-fg">
            No traces yet — send telemetry to get started
          </p>
          <p class="max-w-lg text-xs text-fg-muted">
            Both standard OTLP transports are ready. Existing SDK defaults
            usually work unchanged.
          </p>
          <div class="grid w-full gap-2 text-left md:grid-cols-2">
            <div class="rounded-md border border-line bg-subtle p-3">
              <div
                class="mb-1 text-[11px] font-semibold uppercase tracking-wide"
              >
                OTLP/gRPC
              </div>
              <code class="break-all text-xs text-fg"
                >OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317</code
              >
            </div>
            <div class="rounded-md border border-line bg-subtle p-3">
              <div
                class="mb-1 text-[11px] font-semibold uppercase tracking-wide"
              >
                OTLP/HTTP
              </div>
              <code class="break-all text-xs text-fg"
                >OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318</code
              >
            </div>
          </div>
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

          <!-- Paging sentinel: reaching it fetches the next page from the
               store. Only meaningful when the server is the source; the
               client-side fallback has nothing further to fetch. -->
          {#if traceQuery.nextCursor.value}
            <div
              use:infiniteScroll={{
                onReach: () => traceQuery.loadMore(),
                disabled: traceQuery.loading.value,
              }}
              class="px-4 py-3 text-center text-xs text-fg-subtle"
            >
              {traceQuery.loading.value ? 'Loading…' : 'Scroll for more'}
            </div>
          {/if}
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
