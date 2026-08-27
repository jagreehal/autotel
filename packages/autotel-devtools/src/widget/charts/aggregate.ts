/**
 * Metric aggregation.
 *
 * Pure functions turning stored data points into the numbers a chart draws.
 * Kept out of the components so the arithmetic that is easy to get quietly
 * wrong — counter resets, quantile interpolation, downsampling that hides a
 * spike — is testable on its own.
 */

import type {
  MetricPoint,
  MetricTemporality,
} from '../../server/metric-streams';

/**
 * Convert a series to change per second.
 *
 * A **cumulative** counter is a running total: plotted as-is it only ever goes
 * up, which says nothing about the rate of anything. It has to be differenced.
 * A **delta** counter already carries the change, but is still normalised by
 * its interval when that interval is known.
 *
 * Absent temporality is treated as delta, matching the SDKs that omit it.
 */
export function toRate(
  points: MetricPoint[],
  temporality: MetricTemporality | undefined,
): MetricPoint[] {
  if (temporality === undefined) return points;
  if (temporality === 'cumulative' && points.length < 2) return [];

  const out: MetricPoint[] = [];
  const firstIndex = temporality === 'cumulative' ? 1 : 0;
  for (let i = firstIndex; i < points.length; i++) {
    const previousPoint = points[i - 1];
    const previous = previousPoint?.value ?? 0;
    const current = points[i].value ?? 0;
    // A drop means the counter reset — a process restarted. The increment since
    // the reset is the current value itself; differencing across it would draw
    // a large negative spike, a shape the underlying quantity cannot have.
    let delta = current;
    if (temporality === 'cumulative' && current >= previous) {
      delta = current - previous;
    }
    const intervalStart = points[i].startTimestamp ?? previousPoint?.timestamp;
    const seconds =
      intervalStart !== undefined
        ? (points[i].timestamp - intervalStart) / 1000
        : 0;
    out.push({
      ...points[i],
      value: seconds > 0 ? delta / seconds : delta,
    });
  }
  return out;
}

/**
 * Estimate a quantile from histogram buckets.
 *
 * Interpolates linearly *within* the bucket the quantile falls in. Returning
 * the bucket's upper bound instead would quantise p99 onto whatever bounds the
 * instrument happened to be configured with, which makes two services with
 * different bucket layouts incomparable.
 *
 * Returns undefined when there are no observations, or when the point is
 * malformed — guessing at a malformed point produces a confident wrong number.
 */
export function quantileFromBuckets(
  bucketCounts: number[],
  explicitBounds: number[],
  quantile: number,
): number | undefined {
  // OTLP requires exactly one more bucket than bound: the final +Inf overflow.
  if (bucketCounts.length !== explicitBounds.length + 1) return undefined;

  const total = bucketCounts.reduce((sum, n) => sum + n, 0);
  if (total === 0) return undefined;

  const target = quantile * total;
  let cumulative = 0;

  for (let i = 0; i < bucketCounts.length; i++) {
    const count = bucketCounts[i];
    if (cumulative + count >= target) {
      const lower = i === 0 ? 0 : explicitBounds[i - 1];
      const upper =
        i < explicitBounds.length
          ? explicitBounds[i]
          : // The overflow bucket has no upper bound. The largest defensible
            // answer is the last bound actually known — Infinity is not a
            // number a chart or a p99 readout can use.
            explicitBounds[explicitBounds.length - 1];

      if (count === 0) return upper;
      const fraction = (target - cumulative) / count;
      return lower + (upper - lower) * fraction;
    }
    cumulative += count;
  }

  return explicitBounds[explicitBounds.length - 1];
}

export interface BucketBar {
  label: string;
  count: number;
  from: number;
  to: number;
}

/** Histogram buckets as labelled bars, for a distribution chart. */
export function bucketBars(
  bucketCounts: number[],
  explicitBounds: number[],
): BucketBar[] {
  if (bucketCounts.length !== explicitBounds.length + 1) return [];

  // A histogram with no bounds is one +Inf bucket: every observation, no shape.
  if (explicitBounds.length === 0) {
    return [
      { label: 'all', count: bucketCounts[0], from: -Infinity, to: Infinity },
    ];
  }

  return bucketCounts.map((count, i) => {
    const from = i === 0 ? -Infinity : explicitBounds[i - 1];
    const to = i < explicitBounds.length ? explicitBounds[i] : Infinity;
    const label =
      i === 0
        ? `≤${format(explicitBounds[0])}`
        : i === explicitBounds.length
          ? `>${format(explicitBounds[explicitBounds.length - 1])}`
          : `${format(explicitBounds[i - 1])}–${format(explicitBounds[i])}`;
    return { label, count, from, to };
  });
}

/** Preserve either OTLP histogram encoding as ordered distribution bars. */
export function bucketBarsForPoint(point: MetricPoint): BucketBar[] {
  if (point.bucketCounts && point.explicitBounds) {
    return bucketBars(point.bucketCounts, point.explicitBounds);
  }
  if (point.scale === undefined) return [];

  const base = 2 ** (2 ** -point.scale);
  const bars: BucketBar[] = [];
  appendExponentialBars(bars, point.negative, base, true);
  if (point.zeroCount !== undefined) {
    const threshold = point.zeroThreshold ?? 0;
    bars.push({
      label: threshold > 0 ? `−${format(threshold)}–${format(threshold)}` : '0',
      count: point.zeroCount,
      from: -threshold,
      to: threshold,
    });
  }
  appendExponentialBars(bars, point.positive, base, false);
  return bars.sort((left, right) => left.from - right.from);
}

function appendExponentialBars(
  target: BucketBar[],
  buckets: MetricPoint['positive'],
  base: number,
  negative: boolean,
): void {
  if (!buckets) return;
  for (let position = 0; position < buckets.bucketCounts.length; position++) {
    const index = buckets.offset + position;
    const lowerMagnitude = base ** index;
    const upperMagnitude = base ** (index + 1);
    const from = negative ? -upperMagnitude : lowerMagnitude;
    const to = negative ? -lowerMagnitude : upperMagnitude;
    target.push({
      label: `${format(from)}–${format(to)}`,
      count: buckets.bucketCounts[position],
      from,
      to,
    });
  }
}

/** Estimate a quantile directly from either histogram representation. */
export function quantileFromPoint(
  point: MetricPoint,
  quantile: number,
): number | undefined {
  if (point.bucketCounts && point.explicitBounds) {
    return quantileFromBuckets(
      point.bucketCounts,
      point.explicitBounds,
      quantile,
    );
  }
  const bars = bucketBarsForPoint(point);
  const total = bars.reduce((sum, bar) => sum + bar.count, 0);
  if (total === 0) return undefined;
  const target = quantile * total;
  let cumulative = 0;
  for (const bar of bars) {
    if (cumulative + bar.count >= target) {
      if (bar.count === 0) return bar.to;
      return (
        bar.from + ((target - cumulative) / bar.count) * (bar.to - bar.from)
      );
    }
    cumulative += bar.count;
  }
  return bars[bars.length - 1]?.to;
}

export type AggregateKind = 'sum' | 'avg' | 'min' | 'max' | 'last' | 'count';

/**
 * Reduce a series to one number, for a legend or a stat tile.
 *
 * Returns undefined for an empty series rather than 0: zero is a real
 * measurement, and a legend showing 0 for a series with no data states
 * something false.
 */
export function aggregatePoints(
  points: MetricPoint[],
  kind: AggregateKind,
): number | undefined {
  if (points.length === 0) return undefined;
  const values = points.map((p) => p.value ?? 0);

  switch (kind) {
    case 'sum':
      return values.reduce((sum, n) => sum + n, 0);
    case 'avg':
      return values.reduce((sum, n) => sum + n, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'last':
      return values[values.length - 1];
    case 'count':
      return points.length;
  }
}

/**
 * Round tick values spanning `[min, max]`.
 *
 * Uses the 1/2/5/10 progression, so the axis is labelled with numbers a person
 * reads rather than the raw domain divided by a tick count.
 */
export function niceTicks(min: number, max: number, count: number): number[] {
  // A flat domain has no range to divide; give it a single tick rather than
  // dividing by zero and producing NaNs across the axis.
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return [min];
  }

  const rawStep = (max - min) / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const niceStep =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) *
    magnitude;

  const start = Math.floor(min / niceStep) * niceStep;
  const end = Math.ceil(max / niceStep) * niceStep;

  const ticks: number[] = [];
  // Guard the loop on a computed count rather than accumulating, so floating
  // point cannot make it run long.
  const steps = Math.round((end - start) / niceStep);
  for (let i = 0; i <= steps; i++) ticks.push(start + i * niceStep);
  return ticks;
}

/**
 * Reduce a long series to at most `budget` points.
 *
 * Buckets the series by index and keeps each bucket's **extremes** rather than
 * its mean. Averaging is the obvious approach and the wrong one: it smooths
 * away the one spike the chart exists to show.
 *
 * The first and last points are always kept so the drawn span matches the
 * series' actual span.
 */
export function downsample(
  points: MetricPoint[],
  budget: number,
): MetricPoint[] {
  if (points.length <= budget || budget < 3) return points;

  // Two points per bucket (the min and the max), plus the retained endpoints.
  const bucketCount = Math.max(1, Math.floor((budget - 2) / 2));
  const bucketSize = points.length / bucketCount;

  const kept = new Map<number, MetricPoint>();
  kept.set(0, points[0]);
  kept.set(points.length - 1, points[points.length - 1]);

  for (let b = 0; b < bucketCount; b++) {
    const from = Math.floor(b * bucketSize);
    const to = Math.min(points.length, Math.floor((b + 1) * bucketSize));
    if (from >= to) continue;

    let minIndex = from;
    let maxIndex = from;
    for (let i = from; i < to; i++) {
      const value = points[i].value ?? 0;
      if (value < (points[minIndex].value ?? 0)) minIndex = i;
      if (value > (points[maxIndex].value ?? 0)) maxIndex = i;
    }
    kept.set(minIndex, points[minIndex]);
    kept.set(maxIndex, points[maxIndex]);
  }

  // Re-sort by original index so the line is drawn in time order.
  return [...kept.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, point]) => point);
}

/** Compact number formatting for axis and bucket labels. */
function format(value: number): string {
  if (!Number.isFinite(value)) return '∞';
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return String(Math.round(value * 100) / 100);
}
