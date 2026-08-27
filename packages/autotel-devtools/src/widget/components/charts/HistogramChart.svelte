<script lang="ts">
  /**
   * Bucket distribution for a histogram data point.
   *
   * Bars, not a line: a histogram's buckets are categories with widths, and
   * connecting their counts with a line implies a continuity between bucket
   * midpoints that the data does not have.
   *
   * The p50/p90/p99 readouts are interpolated within their bucket rather than
   * snapped to a bucket bound — see `quantileFromBuckets`.
   */
  import {
    bucketBarsForPoint,
    quantileFromPoint,
  } from '../../charts/aggregate';
  import type { MetricPoint } from '../../../server/metric-streams';
  import { cn } from '../../utils/cn';

  interface Props {
    point: MetricPoint;
    unit?: string;
    height?: number;
    class?: string;
  }
  let { point, unit, height = 160, class: className }: Props = $props();

  const bars = $derived(bucketBarsForPoint(point));
  const maxCount = $derived(Math.max(1, ...bars.map((b) => b.count)));
  const total = $derived(bars.reduce((sum, b) => sum + b.count, 0));

  const quantiles = $derived(
    [0.5, 0.9, 0.99].map((q) => ({
      label: `p${q * 100}`,
      value: quantileFromPoint(point, q),
    })),
  );

  function format(value: number | undefined): string {
    if (value === undefined) return '—';
    const rounded = Math.round(value * 100) / 100;
    return unit ? `${rounded}${unit}` : String(rounded);
  }

  /** Share of observations in this bucket, for the tooltip. */
  function share(count: number): string {
    if (total === 0) return '0%';
    return `${Math.round((count / total) * 100)}%`;
  }
</script>

{#if bars.length === 0}
  <div
    class={cn(
      'flex items-center justify-center text-xs text-fg-subtle border border-line rounded',
      className,
    )}
    style="height:{height}px"
  >
    No bucket data on this point
  </div>
{:else}
  <div class={cn('flex flex-col gap-2', className)}>
    <div
      class="flex items-end gap-1"
      style="height:{height}px"
      role="img"
      aria-label="Histogram, {bars.length} buckets, {total} observations"
    >
      {#each bars as bar (bar.label)}
        <div class="flex-1 flex flex-col items-center justify-end h-full gap-1">
          <span class="text-[10px] text-fg-subtle tabular-nums">
            {bar.count}
          </span>
          <div
            class="w-full rounded-t bg-accent/70 hover:bg-accent transition-colors"
            style="height:{(bar.count / maxCount) * 100}%"
            title="{bar.label}: {bar.count} ({share(bar.count)})"
          ></div>
          <span class="text-[10px] text-fg-subtle truncate w-full text-center">
            {bar.label}
          </span>
        </div>
      {/each}
    </div>

    <div
      class="flex items-center gap-4 text-[11px] text-fg-muted border-t border-line pt-2"
    >
      {#each quantiles as q (q.label)}
        <span>
          <span class="text-fg-subtle">{q.label}</span>
          <span class="font-mono text-fg">{format(q.value)}</span>
        </span>
      {/each}
      {#if point.count !== undefined}
        <span class="ml-auto">
          <span class="text-fg-subtle">count</span>
          <span class="font-mono text-fg">{point.count}</span>
        </span>
      {/if}
    </div>
  </div>
{/if}
