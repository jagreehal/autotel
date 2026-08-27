/**
 * Shaping a series of points into what a distribution chart draws.
 *
 * Separate from `aggregate.ts`, which reduces points to numbers; these produce
 * geometry — stacked bands, quantile tracks, heatmap grids. Kept pure so the
 * alignment and normalisation rules, which fail quietly rather than loudly, are
 * testable without rendering.
 */

import { bucketBarsForPoint, quantileFromPoint } from './aggregate';
import type { MetricPoint } from '../../server/metric-streams';

/** One stacked band: the slice of the column this series occupies. */
export interface StackBand {
  timestamp: number;
  y0: number;
  y1: number;
}

/**
 * Stack series so each sits on the sum of those below it.
 *
 * Aligned on the **union of timestamps**, not on array position. Two series
 * that started at different moments have different sample times, and stacking
 * by index would attribute one series' value to another series' moment — a
 * chart that looks fine and is wrong.
 *
 * A timestamp a series did not sample becomes a zero-height band rather than a
 * gap, so the series above it are not pulled down through the hole.
 */
export function stackSeries(series: MetricPoint[][]): StackBand[][] {
  if (series.length === 0) return [];

  const timestamps = [
    ...new Set(series.flatMap((points) => points.map((p) => p.timestamp))),
  ].sort((a, b) => a - b);

  const byTimestamp = series.map(
    (points) => new Map(points.map((p) => [p.timestamp, p.value ?? 0])),
  );

  // Running total per timestamp, so each series knows where its base sits.
  const base = new Map<number, number>(timestamps.map((t) => [t, 0]));

  return byTimestamp.map((values) =>
    timestamps.map((timestamp) => {
      const y0 = base.get(timestamp) ?? 0;
      const raw = values.get(timestamp) ?? 0;
      // An up/down counter can go negative; a band whose top is below its base
      // renders as a fold rather than a gap, so clamp the height at zero.
      const height = Math.max(0, raw);
      const y1 = y0 + height;
      base.set(timestamp, y1);
      return { timestamp, y0, y1 };
    }),
  );
}

/** One quantile plotted over time. */
export interface QuantileTrack {
  quantile: number;
  points: Array<{ timestamp: number; value: number }>;
}

/**
 * Estimate each quantile at every point that has observations.
 *
 * A point with no observations is **skipped**, not plotted as zero: a zero p99
 * reads as "everything was instant", which is the opposite of "we have no data
 * for this moment". A malformed point is skipped for the same reason — see
 * `quantileFromBuckets`.
 *
 * Tracks come back in the order requested and always exist, even when empty,
 * so the legend keeps a stable set of rows rather than losing them when a
 * window happens to contain nothing.
 */
export function quantileSeries(
  points: MetricPoint[],
  quantiles: number[],
): QuantileTrack[] {
  return quantiles.map((quantile) => ({
    quantile,
    points: points.flatMap((point) => {
      const value = quantileFromPoint(point, quantile);
      return value === undefined ? [] : [{ timestamp: point.timestamp, value }];
    }),
  }));
}

export interface HeatmapCell {
  count: number;
  /** `count / max`, so colour is comparable across the grid. 0 when empty. */
  intensity: number;
}

export interface HeatmapColumn {
  timestamp: number;
  /** One per row, in row order. */
  cells: HeatmapCell[];
}

export interface HeatmapGrid {
  columns: HeatmapColumn[];
  /** Bucket rows, lowest first — rendered bottom-up. */
  rows: Array<{ label: string; from: number; to: number }>;
  /** Busiest single cell, for the legend scale. */
  max: number;
}

/**
 * Build a time × bucket grid from histogram points.
 *
 * Intensity is normalised against the **busiest cell**, because absolute counts
 * vary by orders of magnitude between windows: without normalising, one spike
 * flattens every other cell to the same shade and the chart stops saying
 * anything.
 *
 * Points whose bucket layout differs from the first are dropped. Two layouts
 * cannot share a row axis, and plotting them together would put different
 * ranges on the same row — a silently wrong distribution rather than a visible
 * gap.
 */
export function heatmapCells(points: MetricPoint[]): HeatmapGrid {
  const withBuckets = points.filter(
    (point) => bucketBarsForPoint(point).length > 0,
  );
  if (withBuckets.length === 0) return { columns: [], rows: [], max: 0 };

  const first = withBuckets[0];
  const firstBars = bucketBarsForPoint(first);
  const rows = firstBars.map((bar) => ({
    label: bar.label,
    from: bar.from,
    to: bar.to,
  }));
  if (rows.length === 0) return { columns: [], rows: [], max: 0 };

  const sameLayout = withBuckets.filter(
    (p) =>
      bucketBarsForPoint(p).length === firstBars.length &&
      bucketBarsForPoint(p).every(
        (bar, index) => bar.label === firstBars[index].label,
      ),
  );

  const max = Math.max(
    0,
    ...sameLayout.flatMap((point) =>
      bucketBarsForPoint(point).map((bar) => bar.count),
    ),
  );

  const columns = sameLayout
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((point) => ({
      timestamp: point.timestamp,
      cells: bucketBarsForPoint(point).map(({ count }) => ({
        count,
        // An all-zero histogram would divide by zero; every cell is genuinely
        // empty there, so zero intensity is the honest answer.
        intensity: max > 0 ? count / max : 0,
      })),
    }));

  return { columns, rows, max };
}
