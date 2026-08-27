<script lang="ts">
  /**
   * Distribution over time: buckets on the y axis, time on the x, count as
   * colour.
   *
   * What this shows that a quantile line cannot: whether latency is *bimodal*.
   * A p99 line says "some requests were slow"; a heatmap shows two bands and
   * tells you there are two populations — a cache hit and a cache miss, say —
   * rather than one distribution with a tail.
   *
   * Intensity is normalised against the busiest cell (see `heatmapCells`), so
   * the shading is comparable across the grid rather than being flattened by a
   * single spike.
   */
  import { heatmapCells } from '../../charts/shape';
  import type { MetricPoint } from '../../../server/metric-streams';
  import { cn } from '../../utils/cn';

  interface Props {
    points: MetricPoint[];
    /** Row height in px. Columns size themselves to the container. */
    rowHeight?: number;
    unit?: string;
    onCell?: (timestamp: number, row: number) => void;
    class?: string;
  }
  let {
    points,
    rowHeight = 22,
    unit,
    onCell,
    class: className,
  }: Props = $props();

  const grid = $derived(heatmapCells(points));

  function formatTime(ms: number): string {
    return new Date(ms).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  /**
   * Cell background.
   *
   * A single hue varying in opacity rather than a rainbow ramp: a multi-hue
   * scale implies categories, and these cells differ only in magnitude.
   */
  function cellStyle(intensity: number): string {
    if (intensity === 0) return 'background: var(--color-subtle)';
    // Floor the alpha so a non-empty cell is always visible — a count of 1
    // beside a spike of 10,000 must not be indistinguishable from empty.
    const alpha = 0.12 + intensity * 0.88;
    return `background: color-mix(in oklch, var(--color-accent) ${alpha * 100}%, transparent)`;
  }
</script>

{#if grid.columns.length === 0}
  <div
    class={cn(
      'flex items-center justify-center text-xs text-fg-subtle border border-line rounded p-6',
      className,
    )}
  >
    No bucketed data in this window
  </div>
{:else}
  <div class={cn('flex flex-col gap-1', className)}>
    <div
      class="flex"
      role="img"
      aria-label="Distribution heatmap, {grid.rows.length} buckets over {grid
        .columns.length} intervals, busiest cell {grid.max}"
    >
      <!-- Row labels. Reversed so the largest bucket sits at the top, which is
           how a distribution is read. -->
      <div class="shrink-0 pr-2 text-right">
        {#each [...grid.rows].reverse() as row (row.label)}
          <div
            class="text-[10px] text-fg-subtle flex items-center justify-end"
            style="height:{rowHeight}px"
          >
            {row.label}{#if unit}<span class="ml-0.5">{unit}</span>{/if}
          </div>
        {/each}
      </div>

      <div class="flex-1 min-w-0 overflow-x-auto">
        <div class="flex gap-px h-full">
          {#each grid.columns as column (column.timestamp)}
            <div class="flex-1 min-w-[8px] flex flex-col gap-px">
              {#each [...column.cells].reverse() as cell, reversedIndex (reversedIndex)}
                {@const rowIndex = column.cells.length - 1 - reversedIndex}
                <button
                  type="button"
                  style="height:{rowHeight}px; {cellStyle(cell.intensity)}"
                  class="w-full rounded-[1px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  title="{grid.rows[rowIndex].label}{unit ?? ''} at {formatTime(
                    column.timestamp,
                  )}: {cell.count}"
                  aria-label="{grid.rows[rowIndex].label} at {formatTime(
                    column.timestamp,
                  )}: {cell.count} observations"
                  onclick={() => onCell?.(column.timestamp, rowIndex)}
                ></button>
              {/each}
            </div>
          {/each}
        </div>
      </div>
    </div>

    <div class="flex items-center gap-2 text-[10px] text-fg-subtle pl-2">
      <span>{formatTime(grid.columns[0].timestamp)}</span>
      <span class="flex-1 border-t border-line-subtle"></span>
      <span>
        {formatTime(grid.columns[grid.columns.length - 1].timestamp)}
      </span>
      <span class="ml-2">busiest {grid.max}</span>
    </div>
  </div>
{/if}
