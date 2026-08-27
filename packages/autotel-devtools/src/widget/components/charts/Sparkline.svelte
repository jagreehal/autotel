<script lang="ts">
  /**
   * A tiny inline line chart, for a metric row in the catalogue.
   *
   * No axes, no labels, no interaction — its whole job is to say "this one is
   * flat / spiking / trending" at a glance so you know which metric to open.
   * Anything more belongs in the full chart.
   */
  import { scaleLinear } from 'd3-scale';
  import { line as d3Line } from 'd3-shape';
  import type { MetricPoint } from '../../../server/metric-streams';
  import { cn } from '../../utils/cn';

  interface Props {
    points: MetricPoint[];
    width?: number;
    height?: number;
    /** Stroke colour; defaults to the accent token. */
    color?: string;
    class?: string;
    ariaLabel?: string;
  }
  let {
    points,
    width = 80,
    height = 20,
    color = 'var(--color-accent)',
    class: className,
    ariaLabel,
  }: Props = $props();

  const values = $derived(points.map((p) => p.value ?? 0));

  const path = $derived.by(() => {
    if (points.length < 2) return null;

    const xScale = scaleLinear()
      .domain([points[0].timestamp, points[points.length - 1].timestamp])
      .range([1, width - 1]);

    const min = Math.min(...values);
    const max = Math.max(...values);
    // A flat series has no range to scale into; centre it rather than dividing
    // by zero, which would collapse the line to NaN and draw nothing.
    const yScale = scaleLinear()
      .domain(min === max ? [min - 1, max + 1] : [min, max])
      // Inverted: SVG y grows downward, charts grow upward.
      .range([height - 1, 1]);

    return d3Line<MetricPoint>()
      .x((p) => xScale(p.timestamp))
      .y((p) => yScale(p.value ?? 0))(points);
  });
</script>

{#if path}
  <svg
    {width}
    {height}
    viewBox="0 0 {width} {height}"
    role="img"
    aria-label={ariaLabel ?? `Sparkline, ${points.length} points`}
    class={cn('overflow-visible', className)}
  >
    <path
      d={path}
      fill="none"
      stroke={color}
      stroke-width="1.5"
      stroke-linejoin="round"
      stroke-linecap="round"
    />
  </svg>
{:else}
  <!-- One point cannot make a line. Say so rather than drawing a misleading dot
       at an arbitrary position. -->
  <span
    class={cn('text-[10px] text-fg-subtle', className)}
    style="width:{width}px;height:{height}px"
  >
    —
  </span>
{/if}
