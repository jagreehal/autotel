<script lang="ts">
  /**
   * Metrics tab.
   *
   * Reads real OTel metric streams from the store rather than the
   * autotel-shaped `event | funnel | outcome | value` model this view used to
   * render — a model nothing ever produced, which is why the tab could only
   * ever say "no metrics yet".
   *
   * Left: the catalogue, one row per metric with a sparkline so you can see
   * which one is worth opening. Right: the selected metric's series, drawn as a
   * time chart, or as a bucket distribution when the instrument is a histogram.
   */
  import { BarChart, RefreshCw, Trash2 } from '@lucide/svelte';
  import {
    listMetrics,
    fetchMetricSeries,
    deleteMetric,
  } from '../metrics-client';
  import type {
    MetricCatalogEntry,
    MetricSeries,
  } from '../../server/store/store';
  import { httpBaseFromWsUrl } from '../source-client';
  import {
    connectionUrlSignal,
    setSelectedTrace,
    setSelectedTab,
    requestDeepLink,
    timeWindowSignal,
  } from '../store.svelte';
  import {
    resolveWindow,
    toQueryWindow,
    type WindowSelection,
  } from '../timeWindow';
  import TimeWindowPicker from './TimeWindowPicker.svelte';
  import SearchInput from './SearchInput.svelte';
  import Sparkline from './charts/Sparkline.svelte';
  import TimeSeriesChart from './charts/TimeSeriesChart.svelte';
  import HistogramChart from './charts/HistogramChart.svelte';
  import HistogramHeatmap from './charts/HistogramHeatmap.svelte';
  import QuantileAreaChart from './charts/QuantileAreaChart.svelte';
  import ChartControls, { type ChartMode } from './charts/ChartControls.svelte';
  import { serviceColor } from '../utils/serviceColor';
  import {
    aggregatePoints,
    toRate,
    type AggregateKind,
  } from '../charts/aggregate';
  import { cn } from '../utils/cn';

  function baseUrl(): string {
    const wsUrl = connectionUrlSignal.value;
    return (
      (wsUrl ? httpBaseFromWsUrl(wsUrl) : null) ?? globalThis.location.origin
    );
  }

  let catalogue = $state<MetricCatalogEntry[]>([]);
  let selectedName = $state<string | null>(null);
  let series = $state<MetricSeries[]>([]);
  let failure = $state<string | null>(null);
  let loading = $state(false);
  let filter = $state('');
  // The shared window, so switching tabs does not silently change the range.
  const windowSelection = $derived(timeWindowSignal.value);
  /** Series ids to draw; empty draws all. Clicking a legend row isolates one. */
  let isolated = $state<Set<string>>(new Set());
  let mode = $state<ChartMode>('timeseries');
  let aggregate = $state<AggregateKind>('sum');
  let stacked = $state(false);
  /** Difference cumulative counters into per-interval change. On by default:
   *  a running total plotted as-is only ever rises and says nothing. */
  let rate = $state(true);

  const deps = () => ({
    fetch: globalThis.fetch.bind(globalThis),
    baseUrl: baseUrl(),
  });

  async function loadCatalogue(query = filter) {
    const result = await listMetrics(deps(), query);
    if (result.status === 'ok') {
      catalogue = result.data;
      failure = null;
      // Open the first metric so the tab lands on something rather than on an
      // empty pane the user has to click to fill.
      if (!selectedName && catalogue.length > 0) select(catalogue[0].name);
    } else if (result.status === 'error') {
      failure = result.message;
    }
  }

  async function loadSeries(name: string) {
    loading = true;
    const resolved = resolveWindow(timeWindowSignal.value, Date.now());
    const result = await fetchMetricSeries(
      { name, window: toQueryWindow(resolved) },
      deps(),
    );
    // A superseded request leaves the state to the newer one.
    if (result.status === 'aborted') return;
    loading = false;
    if (result.status === 'ok') {
      series = result.data;
      failure = null;
    } else {
      failure = result.message;
    }
  }

  function select(name: string) {
    selectedName = name;
    isolated = new Set();
    // Reset the view options: they are chosen for the instrument, and carrying
    // a heatmap selection onto a counter would land on an impossible mode.
    mode = 'timeseries';
    aggregate = 'sum';
    stacked = false;
    void loadSeries(name);
  }

  function refresh() {
    void loadCatalogue();
    if (selectedName) void loadSeries(selectedName);
  }

  function changeWindow(next: WindowSelection) {
    timeWindowSignal.value = next;
    if (selectedName) void loadSeries(selectedName);
  }

  /** Open the trace an exemplar points at, on the Traces tab. */
  function openExemplar(traceId: string, spanId?: string) {
    setSelectedTrace(traceId);
    requestDeepLink(traceId, spanId);
    setSelectedTab('traces');
  }

  function toggleIsolate(seriesId: string) {
    const next = new Set(isolated);
    if (next.has(seriesId)) next.delete(seriesId);
    else next.add(seriesId);
    isolated = next;
  }

  async function removeSelectedMetric() {
    if (!selectedName) return;
    if (
      !globalThis.confirm(`Delete every stored series for “${selectedName}”?`)
    )
      return;
    const removed = selectedName;
    const result = await deleteMetric(removed, deps());
    if (result.status !== 'ok') {
      if (result.status === 'error') failure = result.message;
      return;
    }
    selectedName = null;
    series = [];
    await loadCatalogue('');
  }

  $effect(() => {
    const query = filter;
    const id = setTimeout(() => void loadCatalogue(query), 200);
    return () => clearTimeout(id);
  });

  const selected = $derived(catalogue.find((m) => m.name === selectedName));
  const isHistogram = $derived(
    selected?.kind === 'histogram' || selected?.kind === 'exponentialHistogram',
  );

  /**
   * Series with the rate transform applied, if it is on.
   *
   * Done once here rather than inside each chart so the chart, the legend and
   * the sparkline all describe the same numbers — a legend total that does not
   * match the line above it is worse than no legend.
   */
  const plotted = $derived(
    series.map((s) => ({
      ...s,
      points: rate ? toRate(s.points, s.temporality) : s.points,
    })),
  );

  /** Every point of the selected metric, for the distribution charts. */
  const distributionPoints = $derived(
    series.flatMap((s) => s.points).sort((a, b) => a.timestamp - b.timestamp),
  );

  const visibleCatalogue = $derived(catalogue);

  /** A legend row per series: colour, label, and its summary value. */
  const legend = $derived(
    series.map((s) => ({
      id: s.seriesId,
      color: serviceColor(s.seriesId).stroke,
      label: seriesLabel(s),
      // Sum for counters, last value for gauges — a gauge's total is meaningless.
      // A gauge's total is meaningless, so it ignores the chosen statistic and
      // always reports its latest level.
      value: aggregatePoints(
        rate ? toRate(s.points, s.temporality) : s.points,
        s.kind === 'gauge' ? 'last' : aggregate,
      ),
    })),
  );

  function seriesLabel(item: (typeof series)[number]): string {
    const pointAttributes = Object.entries(item.attributes);
    const resourceAttributes = Object.entries(item.resource ?? {}).filter(
      ([key]) => key !== 'service.name',
    );
    return (
      [...pointAttributes, ...resourceAttributes]
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' ') || item.service
    );
  }

  function formatValue(value: number | undefined, unit?: string): string {
    if (value === undefined) return '—';
    const rounded = Math.round(value * 100) / 100;
    const text = rounded.toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
    const displayUnit = unit && unit !== '1' ? ` ${unit}` : '';
    return `${text}${displayUnit}${rate && selected?.kind === 'sum' ? '/s' : ''}`;
  }
</script>

<div class="flex flex-col h-full">
  <div
    class="flex items-center justify-between px-4 py-2 border-b border-line gap-2"
  >
    <h3 class="text-sm font-semibold flex items-center gap-2 text-fg shrink-0">
      <BarChart size={16} />
      Metrics
    </h3>
    <TimeWindowPicker selection={windowSelection} onChange={changeWindow} />
    <div class="flex items-center gap-1">
      {#if selectedName}
        <button
          type="button"
          onclick={removeSelectedMetric}
          title="Delete this metric stream"
          aria-label="Delete selected metric"
          class="p-1.5 hover:bg-danger-bg rounded transition-colors text-fg-subtle hover:text-danger"
        >
          <Trash2 size={14} />
        </button>
      {/if}
      <button
        type="button"
        onclick={refresh}
        title="Refresh"
        aria-label="Refresh metrics"
        class="p-1.5 hover:bg-hover rounded transition-colors text-fg-subtle"
      >
        <RefreshCw size={14} class={loading ? 'animate-spin' : ''} />
      </button>
    </div>
  </div>

  {#if failure}
    <div
      role="alert"
      class="m-4 rounded border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger"
    >
      {failure}
    </div>
  {/if}

  {#if catalogue.length === 0}
    <div class="flex-1 flex items-center justify-center text-sm text-fg-subtle">
      No metrics received yet. Point an OTLP exporter at this server.
    </div>
  {:else}
    <div class="flex-1 flex min-h-0">
      <!-- Catalogue -->
      <div class="w-72 shrink-0 border-r border-line flex flex-col min-h-0">
        <div class="p-2 border-b border-line">
          <SearchInput
            value={filter}
            onValue={(v) => (filter = v)}
            placeholder="Filter metrics…"
            ariaLabel="Filter metrics"
          />
        </div>
        <div class="flex-1 overflow-auto" role="listbox" aria-label="Metrics">
          {#each visibleCatalogue as metric (metric.name + metric.kind)}
            <button
              type="button"
              role="option"
              aria-selected={metric.name === selectedName}
              onclick={() => select(metric.name)}
              class={cn(
                'w-full text-left px-3 py-2 border-b border-line-subtle hover:bg-hover',
                'focus-visible:outline-none focus-visible:bg-hover',
                metric.name === selectedName && 'bg-selected',
              )}
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-medium text-fg truncate">
                  {metric.name}
                </span>
                {#if metric.name === selectedName && series.length > 0}
                  <Sparkline
                    points={rate
                      ? toRate(series[0].points, series[0].temporality)
                      : series[0].points}
                    width={48}
                    height={14}
                    ariaLabel="{metric.name} trend"
                  />
                {/if}
              </div>
              <div
                class="mt-0.5 flex items-center gap-2 text-[10px] text-fg-subtle"
              >
                <span class="uppercase tracking-wide">{metric.kind}</span>
                {#if metric.unit && metric.unit !== '1'}<span
                    >{metric.unit}</span
                  >{/if}
                <span>
                  {metric.seriesCount}
                  {metric.seriesCount === 1 ? 'series' : 'series'}
                </span>
              </div>
            </button>
          {/each}
          {#if visibleCatalogue.length === 0}
            <div class="p-3 text-xs text-fg-subtle">
              No metric matches that filter.
            </div>
          {/if}
        </div>
      </div>

      <!-- Chart -->
      <div class="flex-1 min-w-0 overflow-auto p-4">
        {#if !selected}
          <div class="text-sm text-fg-subtle">Select a metric.</div>
        {:else}
          <div class="mb-3">
            <h4 class="text-sm font-semibold text-fg">{selected.name}</h4>
            {#if selected.description}
              <p class="text-xs text-fg-muted mt-0.5">{selected.description}</p>
            {/if}
          </div>

          <ChartControls
            kind={selected.kind}
            {mode}
            onMode={(next) => (mode = next)}
            {aggregate}
            onAggregate={(next) => (aggregate = next)}
            {stacked}
            onStacked={(next) => (stacked = next)}
            {rate}
            onRate={(next) => (rate = next)}
            class="mb-3"
          />

          {#if series.length === 0}
            <div class="text-xs text-fg-subtle">
              No data for this metric in the selected window.
            </div>
          {:else if mode === 'heatmap'}
            <HistogramHeatmap
              points={distributionPoints}
              unit={selected.unit}
            />
          {:else if mode === 'percentiles'}
            <QuantileAreaChart
              points={distributionPoints}
              unit={selected.unit}
            />
          {:else if isHistogram}
            <!-- A histogram's time series is its bucket distribution at the
                 latest point; the shape over time lives in the other modes. -->
            <HistogramChart
              point={distributionPoints[distributionPoints.length - 1]}
              unit={selected.unit}
            />
          {:else}
            <TimeSeriesChart
              series={plotted}
              {isolated}
              {stacked}
              area={plotted.length === 1 && !stacked}
              onExemplar={openExemplar}
            />
          {/if}

          {#if series.length > 0 && mode === 'timeseries'}
            <!-- Legend: click a row to isolate that series. -->
            <div
              class="mt-3 border-t border-line pt-2 space-y-1"
              role="group"
              aria-label="Series"
            >
              {#each legend as row (row.id)}
                <button
                  type="button"
                  onclick={() => toggleIsolate(row.id)}
                  aria-pressed={isolated.has(row.id)}
                  class={cn(
                    'w-full flex items-center gap-2 px-1 py-0.5 rounded text-[11px] hover:bg-hover',
                    'focus-visible:outline-none focus-visible:bg-hover',
                    isolated.size > 0 && !isolated.has(row.id) && 'opacity-40',
                  )}
                >
                  <span
                    class="w-2.5 h-2.5 rounded-sm shrink-0"
                    style="background:{row.color}"
                  ></span>
                  <span class="truncate text-fg-muted font-mono"
                    >{row.label}</span
                  >
                  <span class="ml-auto font-mono text-fg tabular-nums">
                    {formatValue(row.value, selected.unit)}
                  </span>
                </button>
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</div>
