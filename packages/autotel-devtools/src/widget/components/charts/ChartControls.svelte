<script lang="ts">
  /**
   * The controls above a metric chart: how to draw it, and how to summarise it.
   *
   * Which controls appear depends on the instrument, because most combinations
   * are meaningless rather than merely unusual:
   *
   *  - **Stacking** is offered only for additive quantities. Stacked latencies
   *    would sum to a number nobody measured.
   *  - **Rate** is offered only for counters. A gauge is already a level; a
   *    "rate of memory used" is not a thing.
   *  - **Distribution modes** (heatmap, percentiles) need buckets, so they only
   *    appear for histograms.
   *
   * Hiding a control you cannot use beats disabling it: a disabled button asks
   * the reader to work out why.
   */
  import { BarChart3, TrendingUp, Grid3x3, Layers } from '@lucide/svelte';
  import type { AggregateKind } from '../../charts/aggregate';
  import type { MetricKind } from '../../../server/metric-streams';
  import { cn } from '../../utils/cn';

  /** How the selected metric is drawn. */
  export type ChartMode = 'timeseries' | 'heatmap' | 'percentiles';

  interface Props {
    kind: MetricKind;
    mode: ChartMode;
    onMode: (mode: ChartMode) => void;
    aggregate: AggregateKind;
    onAggregate: (aggregate: AggregateKind) => void;
    stacked: boolean;
    onStacked: (stacked: boolean) => void;
    /** Whether cumulative counters are differenced into per-interval change. */
    rate: boolean;
    onRate: (rate: boolean) => void;
    class?: string;
  }
  let {
    kind,
    mode,
    onMode,
    aggregate,
    onAggregate,
    stacked,
    onStacked,
    rate,
    onRate,
    class: className,
  }: Props = $props();

  const isHistogram = $derived(
    kind === 'histogram' || kind === 'exponentialHistogram',
  );
  /** Sums and histogram counts add up; a gauge is a level, not a quantity. */
  const isAdditive = $derived(kind !== 'gauge');
  const isCounter = $derived(kind === 'sum');

  const MODES: Array<{ id: ChartMode; label: string; icon: typeof BarChart3 }> =
    [
      { id: 'timeseries', label: 'Time series', icon: TrendingUp },
      { id: 'percentiles', label: 'Percentiles', icon: BarChart3 },
      { id: 'heatmap', label: 'Heatmap', icon: Grid3x3 },
    ];

  const availableModes = $derived(
    isHistogram ? MODES : MODES.filter((m) => m.id === 'timeseries'),
  );

  const AGGREGATES: Array<{ id: AggregateKind; label: string }> = [
    { id: 'sum', label: 'Sum' },
    { id: 'avg', label: 'Avg' },
    { id: 'min', label: 'Min' },
    { id: 'max', label: 'Max' },
    { id: 'last', label: 'Last' },
    { id: 'count', label: 'Count' },
  ];
</script>

<div class={cn('flex items-center gap-3 flex-wrap', className)}>
  {#if availableModes.length > 1}
    <div
      class="flex rounded border border-line overflow-hidden"
      role="group"
      aria-label="Chart type"
    >
      {#each availableModes as option (option.id)}
        {@const Icon = option.icon}
        <button
          type="button"
          onclick={() => onMode(option.id)}
          aria-pressed={mode === option.id}
          title={option.label}
          class={cn(
            'flex items-center gap-1 px-2 py-1 text-[11px] transition-colors',
            'focus-visible:outline-none focus-visible:bg-hover',
            mode === option.id
              ? 'bg-selected text-fg font-medium'
              : 'text-fg-muted hover:bg-hover',
          )}
        >
          <Icon size={11} />
          {option.label}
        </button>
      {/each}
    </div>
  {/if}

  {#if mode === 'timeseries'}
    <label class="flex items-center gap-1 text-[11px] text-fg-muted">
      <span class="text-fg-subtle">Summarise</span>
      <select
        value={aggregate}
        onchange={(event) =>
          onAggregate(
            (event.currentTarget as HTMLSelectElement).value as AggregateKind,
          )}
        aria-label="Summary statistic"
        class="rounded border border-line bg-surface px-1.5 py-1 text-[11px] text-fg"
      >
        {#each AGGREGATES as option (option.id)}
          <option value={option.id}>{option.label}</option>
        {/each}
      </select>
    </label>

    {#if isCounter}
      <label
        class="flex items-center gap-1.5 text-[11px] text-fg-muted cursor-pointer"
        title="Show cumulative or delta counter change per second"
      >
        <input
          type="checkbox"
          checked={rate}
          onchange={(event) =>
            onRate((event.currentTarget as HTMLInputElement).checked)}
          class="w-3 h-3 rounded border-line"
        />
        Rate
      </label>
    {/if}

    {#if isAdditive}
      <label
        class="flex items-center gap-1.5 text-[11px] text-fg-muted cursor-pointer"
        title="Stack the series so each sits on the sum of those below"
      >
        <input
          type="checkbox"
          checked={stacked}
          onchange={(event) =>
            onStacked((event.currentTarget as HTMLInputElement).checked)}
          class="w-3 h-3 rounded border-line"
        />
        <Layers size={11} />
        Stack
      </label>
    {/if}
  {/if}
</div>
