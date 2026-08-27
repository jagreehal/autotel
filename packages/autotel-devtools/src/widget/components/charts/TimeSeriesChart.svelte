<script lang="ts">
  /**
   * Multi-series time chart.
   *
   * Three things here are deliberate:
   *
   *  - **Transforms are owned by the parent.** This chart draws the values it
   *    receives so a raw cumulative mode cannot be silently converted twice.
   *  - **Exemplars are clickable.** They are the link from a spike to the trace
   *    that produced it, which is the whole argument for having traces and
   *    metrics in one tool. Drawn last so they sit above the lines.
   *  - **Long series are downsampled keeping extremes**, never averaged, so the
   *    outlier you opened the chart to find survives.
   */
  import { scaleLinear } from 'd3-scale';
  import { line as d3Line, area as d3Area } from 'd3-shape';
  import type { MetricSeries } from '../../../server/store/store';
  import { niceTicks, downsample } from '../../charts/aggregate';
  import { stackSeries } from '../../charts/shape';
  import { serviceColor } from '../../utils/serviceColor';
  import { cn } from '../../utils/cn';

  interface Props {
    series: MetricSeries[];
    width?: number;
    height?: number;
    /** Draw a filled area under each line. Off for multi-series, which occludes. */
    area?: boolean;
    /**
     * Stack the series so each sits on the sum of those below it.
     *
     * Only meaningful for additive quantities — request counts stack, latencies
     * do not, because the sum of two latencies is not a latency anyone
     * measured. The caller decides; the chart just draws it.
     */
    stacked?: boolean;
    /** Series ids to draw; others are dimmed. Empty means draw everything. */
    isolated?: Set<string>;
    /** Called when an exemplar dot is activated. */
    onExemplar?: (traceId: string, spanId?: string) => void;
    class?: string;
  }
  let {
    series,
    width = 640,
    height = 220,
    area = false,
    stacked = false,
    isolated,
    onExemplar,
    class: className,
  }: Props = $props();

  const MARGIN = { top: 8, right: 12, bottom: 22, left: 44 };
  const plotWidth = $derived(Math.max(1, width - MARGIN.left - MARGIN.right));
  const plotHeight = $derived(Math.max(1, height - MARGIN.top - MARGIN.bottom));

  /** Long runs are downsampled without changing their values. */
  const prepared = $derived(
    series.map((s) => ({
      ...s,
      points: downsample(s.points, 400),
    })),
  );

  const visible = $derived(
    prepared.filter((s) => !isolated?.size || isolated.has(s.seriesId)),
  );

  /**
   * Stacked bands, when stacking is on.
   *
   * Aligned on the union of timestamps rather than by array position — two
   * series sampled at different moments would otherwise have one's value
   * attributed to the other's moment. See `stackSeries`.
   */
  const bands = $derived(
    stacked ? stackSeries(visible.map((s) => s.points)) : null,
  );

  const domain = $derived.by(() => {
    const points = visible.flatMap((s) => s.points);
    if (points.length === 0) return null;

    const times = points.map((p) => p.timestamp);
    // Stacked charts must scale to the top of the stack, not to the tallest
    // single series, or the upper bands run off the plot.
    const values = bands
      ? bands.flatMap((band) => band.map((b) => b.y1))
      : points.map((p) => p.value ?? 0);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const minValue = Math.min(0, ...values);
    const maxValue = Math.max(...values);

    return {
      minTime,
      // A single timestamp has no width; widen it so the scale is invertible.
      maxTime: maxTime === minTime ? minTime + 1 : maxTime,
      minValue,
      maxValue: maxValue === minValue ? minValue + 1 : maxValue,
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
      ? scaleLinear()
          .domain([domain.minValue, domain.maxValue])
          // Inverted: SVG y grows downward.
          .range([plotHeight, 0])
      : null,
  );

  const yTicks = $derived(
    domain ? niceTicks(domain.minValue, domain.maxValue, 4) : [],
  );
  const xTicks = $derived(
    domain ? niceTicks(domain.minTime, domain.maxTime, 4) : [],
  );

  function pathFor(points: MetricSeries['points']): string | null {
    if (!xScale || !yScale || points.length === 0) return null;
    if (points.length === 1) return null;
    return d3Line<(typeof points)[number]>()
      .x((p) => xScale(p.timestamp))
      .y((p) => yScale(p.value ?? 0))(points);
  }

  function areaFor(points: MetricSeries['points']): string | null {
    if (!xScale || !yScale || points.length < 2) return null;
    return d3Area<(typeof points)[number]>()
      .x((p) => xScale(p.timestamp))
      .y0(yScale(Math.max(0, domain?.minValue ?? 0)))
      .y1((p) => yScale(p.value ?? 0))(points);
  }

  /**
   * Series colour, keyed by its identity so it stays the same across redraws —
   * a line that changes colour when the window moves is unreadable.
   *
   * `serviceColor` returns a fill/stroke pair; a line wants the stroke.
   */
  function colorFor(s: MetricSeries): string {
    return serviceColor(s.seriesId).stroke;
  }

  function formatTime(ms: number): string {
    return new Date(ms).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function formatValue(value: number): string {
    if (Math.abs(value) >= 1000) {
      return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }
    return String(Math.round(value * 1000) / 1000);
  }

  /** One stacked band as an area path. */
  function bandPath(
    band: Array<{ timestamp: number; y0: number; y1: number }>,
  ) {
    if (!xScale || !yScale || band.length < 2) return null;
    return d3Area<(typeof band)[number]>()
      .x((b) => xScale(b.timestamp))
      .y0((b) => yScale(b.y0))
      .y1((b) => yScale(b.y1))(band);
  }

  /** Every exemplar across the visible series, positioned for drawing. */
  const exemplars = $derived.by(() => {
    if (!xScale || !yScale) return [];
    return visible.flatMap((s) =>
      s.points.flatMap((p) =>
        (p.exemplars ?? [])
          .filter((ex) => ex.traceId)
          .map((ex) => ({
            key: `${s.seriesId}:${ex.timestamp}:${ex.traceId}`,
            x: xScale(ex.timestamp || p.timestamp),
            y: yScale(ex.value),
            traceId: ex.traceId as string,
            spanId: ex.spanId,
            value: ex.value,
          })),
      ),
    );
  });
</script>

{#if !domain}
  <div
    class={cn(
      'flex items-center justify-center text-xs text-fg-subtle border border-line rounded',
      className,
    )}
    style="height:{height}px"
  >
    No data in this window
  </div>
{:else}
  <svg
    {width}
    {height}
    viewBox="0 0 {width} {height}"
    role="img"
    aria-label="Time series chart, {visible.length} series"
    class={cn('overflow-visible', className)}
  >
    <g transform="translate({MARGIN.left},{MARGIN.top})">
      <!-- Horizontal gridlines, drawn first so data sits above them. -->
      {#each yTicks as tick (tick)}
        {@const y = yScale ? yScale(tick) : 0}
        {#if y >= 0 && y <= plotHeight}
          <line
            x1="0"
            x2={plotWidth}
            y1={y}
            y2={y}
            stroke="var(--color-line-subtle)"
            stroke-width="1"
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

      {#if bands}
        {#each visible as s, index (s.seriesId)}
          {@const d = bandPath(bands[index])}
          {#if d}
            <path
              {d}
              fill={colorFor(s)}
              opacity="0.75"
              stroke="var(--color-surface)"
              stroke-width="0.5"
              data-testid="stack-band"
            />
          {/if}
        {/each}
      {:else}
        {#each visible as s (s.seriesId)}
          {@const d = pathFor(s.points)}
          {#if area}
            {@const a = areaFor(s.points)}
            {#if a}
              <path d={a} fill={colorFor(s)} opacity="0.15" />
            {/if}
          {/if}
          {#if d}
            <path
              {d}
              fill="none"
              stroke={colorFor(s)}
              stroke-width="1.5"
              stroke-linejoin="round"
            />
          {:else if s.points.length === 1}
            <!-- One point is not a line, but it is still a measurement: mark it
               rather than dropping the series silently. -->
            <circle
              cx={xScale ? xScale(s.points[0].timestamp) : 0}
              cy={yScale ? yScale(s.points[0].value ?? 0) : 0}
              r="2.5"
              fill={colorFor(s)}
            />
          {/if}
        {/each}
      {/if}

      <!-- Exemplars last, so they sit above the lines they annotate. -->
      {#each exemplars as ex (ex.key)}
        <circle
          cx={ex.x}
          cy={ex.y}
          r="3.5"
          fill="var(--color-warning)"
          stroke="var(--color-surface)"
          stroke-width="1"
          role="button"
          tabindex="0"
          aria-label="Open trace {ex.traceId} ({formatValue(ex.value)})"
          class="cursor-pointer"
          onclick={() => onExemplar?.(ex.traceId, ex.spanId)}
          onkeydown={(event: KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onExemplar?.(ex.traceId, ex.spanId);
            }
          }}
        />
      {/each}
    </g>
  </svg>
{/if}
