<script lang="ts">
  /**
   * Latency percentiles over time, drawn as nested bands.
   *
   * Bands rather than three separate lines: p50 ≤ p90 ≤ p99 always, so the
   * space between them *is* the spread. A widening band means the tail is
   * pulling away from the median — which is the thing you actually want to
   * see, and which three overlapping lines make you infer.
   *
   * Quantiles are interpolated within their bucket rather than snapped to a
   * bound (see `quantileFromBuckets`), so two services with different bucket
   * layouts stay comparable.
   */
  import { scaleLinear } from 'd3-scale';
  import { area as d3Area, line as d3Line } from 'd3-shape';
  import { quantileSeries } from '../../charts/shape';
  import { niceTicks } from '../../charts/aggregate';
  import type { MetricPoint } from '../../../server/metric-streams';
  import { cn } from '../../utils/cn';

  interface Props {
    points: MetricPoint[];
    /** Ascending. Drawn widest-first so narrower bands sit on top. */
    quantiles?: number[];
    width?: number;
    height?: number;
    unit?: string;
    class?: string;
  }
  let {
    points,
    quantiles = [0.5, 0.9, 0.99],
    width = 640,
    height = 220,
    unit,
    class: className,
  }: Props = $props();

  const MARGIN = { top: 8, right: 12, bottom: 22, left: 48 };
  const plotWidth = $derived(Math.max(1, width - MARGIN.left - MARGIN.right));
  const plotHeight = $derived(Math.max(1, height - MARGIN.top - MARGIN.bottom));

  const sorted = $derived([...quantiles].sort((a, b) => a - b));
  const tracks = $derived(quantileSeries(points, sorted));

  const domain = $derived.by(() => {
    const all = tracks.flatMap((t) => t.points);
    if (all.length === 0) return null;
    const times = all.map((p) => p.timestamp);
    const values = all.map((p) => p.value);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const maxValue = Math.max(...values);
    return {
      minTime,
      // One sample has no width; widen it so the scale stays invertible.
      maxTime: maxTime === minTime ? minTime + 1 : maxTime,
      maxValue: maxValue === 0 ? 1 : maxValue,
    };
  });

  const xScale = $derived(
    domain
      ? scaleLinear()
          .domain([domain.minTime, domain.maxTime])
          .range([0, plotWidth])
      : null,
  );
  const yScale = $derived(
    domain
      ? // Zero-based: a percentile chart that does not start at zero
        // exaggerates a small absolute change into a dramatic one.
        scaleLinear().domain([0, domain.maxValue]).range([plotHeight, 0])
      : null,
  );

  const yTicks = $derived(domain ? niceTicks(0, domain.maxValue, 4) : []);
  const xTicks = $derived(
    domain ? niceTicks(domain.minTime, domain.maxTime, 4) : [],
  );

  type TrackPoint = { timestamp: number; value: number };

  function bandPath(track: (typeof tracks)[number]): string | null {
    if (!xScale || !yScale || track.points.length < 2) return null;
    return d3Area<TrackPoint>()
      .x((p) => xScale(p.timestamp))
      .y0(plotHeight)
      .y1((p) => yScale(p.value))(track.points);
  }

  function linePath(track: (typeof tracks)[number]): string | null {
    if (!xScale || !yScale || track.points.length < 2) return null;
    return d3Line<TrackPoint>()
      .x((p) => xScale(p.timestamp))
      .y((p) => yScale(p.value))(track.points);
  }

  /** Higher quantiles are fainter, so the median reads as the solid core. */
  function opacityFor(index: number): number {
    return 0.3 - index * 0.08;
  }

  function label(quantile: number): string {
    return `p${Math.round(quantile * 100)}`;
  }

  function formatTime(ms: number): string {
    return new Date(ms).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatValue(value: number): string {
    const rounded = Math.round(value * 10) / 10;
    return unit ? `${rounded}${unit}` : String(rounded);
  }

  /** Latest value per track, for the legend. */
  const latest = $derived(
    tracks.map((track) => ({
      quantile: track.quantile,
      value: track.points[track.points.length - 1]?.value,
    })),
  );
</script>

{#if !domain}
  <div
    class={cn(
      'flex items-center justify-center text-xs text-fg-subtle border border-line rounded',
      className,
    )}
    style="height:{height}px"
  >
    No bucketed data in this window
  </div>
{:else}
  <div class={cn('flex flex-col gap-2', className)}>
    <svg
      {width}
      {height}
      viewBox="0 0 {width} {height}"
      role="img"
      aria-label="Percentile bands: {sorted.map(label).join(', ')}"
      class="overflow-visible"
    >
      <g transform="translate({MARGIN.left},{MARGIN.top})">
        {#each yTicks as tick (tick)}
          {@const y = yScale ? yScale(tick) : 0}
          {#if y >= 0 && y <= plotHeight}
            <line
              x1="0"
              x2={plotWidth}
              y1={y}
              y2={y}
              stroke="var(--color-line-subtle)"
            />
            <text
              x="-6"
              {y}
              text-anchor="end"
              dominant-baseline="middle"
              class="fill-[var(--color-fg-subtle)] text-[10px]"
            >
              {formatValue(tick)}
            </text>
          {/if}
        {/each}

        {#each xTicks as tick (tick)}
          {@const x = xScale ? xScale(tick) : 0}
          {#if x >= 0 && x <= plotWidth}
            <text
              {x}
              y={plotHeight + 14}
              text-anchor="middle"
              class="fill-[var(--color-fg-subtle)] text-[10px]"
            >
              {formatTime(tick)}
            </text>
          {/if}
        {/each}

        <!-- Widest band first, so the narrower ones layer on top of it. -->
        {#each [...tracks].reverse() as track, reversedIndex (track.quantile)}
          {@const fill = bandPath(track)}
          {#if fill}
            <path
              d={fill}
              fill="var(--color-accent)"
              opacity={opacityFor(tracks.length - 1 - reversedIndex)}
              data-testid="band-{label(track.quantile)}"
            />
          {/if}
        {/each}

        {#each tracks as track (track.quantile)}
          {@const stroke = linePath(track)}
          {#if stroke}
            <path
              d={stroke}
              fill="none"
              stroke="var(--color-accent)"
              stroke-width="1.25"
              data-testid="line-{label(track.quantile)}"
            />
          {/if}
        {/each}
      </g>
    </svg>

    <div class="flex items-center gap-4 text-[11px] border-t border-line pt-2">
      {#each latest as entry (entry.quantile)}
        <span>
          <span class="text-fg-subtle">{label(entry.quantile)}</span>
          <span class="font-mono text-fg ml-1">
            {entry.value === undefined ? '—' : formatValue(entry.value)}
          </span>
        </span>
      {/each}
    </div>
  </div>
{/if}
