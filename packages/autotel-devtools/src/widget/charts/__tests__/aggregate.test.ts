/**
 * @vitest-environment jsdom
 *
 * Metric aggregation contract.
 *
 * This is where metric charts are usually wrong, and the errors are quiet ones —
 * a chart still draws, it just tells you something untrue:
 *
 *  - Plotting a **cumulative** counter as-is draws a line that only ever goes
 *    up, which says nothing about traffic. It has to be differenced into a rate.
 *  - Differencing across a **counter reset** (a process restart, where the value
 *    drops to zero) produces a large negative spike that never happened.
 *  - Estimating a quantile from histogram buckets has to interpolate *within*
 *    the bucket; returning the bucket's upper bound quantises p99 onto whatever
 *    bounds the instrument happened to configure.
 */

import { describe, it, expect } from 'vitest';
import {
  toRate,
  quantileFromBuckets,
  bucketBars,
  bucketBarsForPoint,
  quantileFromPoint,
  aggregatePoints,
  niceTicks,
  downsample,
} from '../aggregate';
import type { MetricPoint } from '../../../server/metric-streams';

const T0 = 1_700_000_000_000;

function point(offsetMs: number, value: number): MetricPoint {
  return { timestamp: T0 + offsetMs, attributes: {}, value };
}

describe('toRate — cumulative counters', () => {
  it('differences a cumulative counter into per-interval change', () => {
    const rate = toRate(
      [point(0, 10), point(1000, 15), point(2000, 40)],
      'cumulative',
    );
    expect(rate.map((p) => p.value)).toEqual([5, 25]);
  });

  it('normalises counter change to one second', () => {
    const rate = toRate([point(0, 10), point(2000, 20)], 'cumulative');
    expect(rate[0].value).toBe(5);
  });

  it('drops the first point, which has nothing to difference against', () => {
    const rate = toRate([point(0, 10), point(1000, 15)], 'cumulative');
    expect(rate).toHaveLength(1);
    expect(rate[0].timestamp).toBe(T0 + 1000);
  });

  it('treats a value drop as a counter reset, not a negative rate', () => {
    // A process restart resets the counter. The honest reading of the point
    // after a reset is its own value — the increment since zero — never a
    // negative spike, which is a shape the underlying quantity cannot have.
    const rate = toRate(
      [point(0, 100), point(1000, 120), point(2000, 5), point(3000, 9)],
      'cumulative',
    );
    expect(rate.map((p) => p.value)).toEqual([20, 5, 4]);
    expect(rate.every((p) => (p.value ?? 0) >= 0)).toBe(true);
  });

  it('leaves delta points alone — they are already the change', () => {
    const points = [point(0, 3), point(1000, 4)];
    expect(toRate(points, 'delta').map((p) => p.value)).toEqual([3, 4]);
  });

  it('treats absent temporality as delta, matching the SDKs that omit it', () => {
    const points = [point(0, 3), point(1000, 4)];
    expect(toRate(points, undefined).map((p) => p.value)).toEqual([3, 4]);
  });

  it('returns nothing for a single cumulative point rather than inventing one', () => {
    expect(toRate([point(0, 10)], 'cumulative')).toEqual([]);
  });

  it('handles an empty series', () => {
    expect(toRate([], 'cumulative')).toEqual([]);
  });
});

describe('quantileFromBuckets', () => {
  // 10 observations: 2 in (-inf,10], 5 in (10,100], 3 in (100,inf).
  const bucketCounts = [2, 5, 3];
  const explicitBounds = [10, 100];

  it('interpolates within the bucket rather than snapping to its bound', () => {
    // p50 is the 5th observation, which falls inside the middle bucket — so the
    // answer must lie strictly between the bucket's bounds.
    const p50 = quantileFromBuckets(bucketCounts, explicitBounds, 0.5);
    expect(p50).toBeGreaterThan(10);
    expect(p50).toBeLessThan(100);
  });

  it('returns a value inside the first bucket for a low quantile', () => {
    const p10 = quantileFromBuckets(bucketCounts, explicitBounds, 0.1);
    expect(p10).toBeLessThanOrEqual(10);
  });

  it('falls back to the last finite bound when the quantile lands in +Inf', () => {
    // The overflow bucket has no upper bound; the largest defensible answer is
    // the last bound we actually know, not Infinity, which no chart can draw.
    const p99 = quantileFromBuckets(bucketCounts, explicitBounds, 0.99);
    expect(Number.isFinite(p99)).toBe(true);
    expect(p99).toBeGreaterThanOrEqual(100);
  });

  it('returns undefined when there are no observations', () => {
    expect(quantileFromBuckets([0, 0, 0], explicitBounds, 0.5)).toBeUndefined();
  });

  it('returns undefined for mismatched buckets and bounds', () => {
    // Buckets must be exactly one longer than bounds; anything else is a
    // malformed point, and guessing at it would produce a confident wrong number.
    expect(quantileFromBuckets([1, 2], [10, 100], 0.5)).toBeUndefined();
  });

  it('is monotonic across increasing quantiles', () => {
    const quantiles = [0.1, 0.25, 0.5, 0.75, 0.9].map((q) =>
      quantileFromBuckets(bucketCounts, explicitBounds, q),
    );
    for (let i = 1; i < quantiles.length; i++) {
      expect(quantiles[i]!).toBeGreaterThanOrEqual(quantiles[i - 1]!);
    }
  });
});

describe('bucketBars', () => {
  it('labels each bar with its range', () => {
    const bars = bucketBars([2, 5, 3], [10, 100]);
    expect(bars.map((b) => b.label)).toEqual(['≤10', '10–100', '>100']);
    expect(bars.map((b) => b.count)).toEqual([2, 5, 3]);
  });

  it('builds ordered bars for an exponential histogram', () => {
    const bars = bucketBarsForPoint({
      timestamp: T0,
      attributes: {},
      scale: 0,
      zeroCount: 2,
      zeroThreshold: 0,
      negative: { offset: 0, bucketCounts: [3, 1] },
      positive: { offset: 0, bucketCounts: [4, 2] },
    });
    expect(bars.map((bar) => bar.count)).toEqual([1, 3, 2, 4, 2]);
    expect(
      bars.every(
        (bar, index) => index === 0 || bar.from >= bars[index - 1].from,
      ),
    ).toBe(true);
  });

  it('estimates exponential histogram quantiles without discarding buckets', () => {
    const value = quantileFromPoint(
      {
        timestamp: T0,
        attributes: {},
        scale: 1,
        zeroCount: 0,
        positive: { offset: 0, bucketCounts: [5, 5] },
      },
      0.9,
    );
    expect(value).toBeTypeOf('number');
    expect(Number.isFinite(value)).toBe(true);
  });

  it('returns nothing for a malformed point', () => {
    expect(bucketBars([1, 2], [10, 100])).toEqual([]);
  });

  it('handles a histogram with a single +Inf bucket', () => {
    expect(bucketBars([7], [])).toEqual([
      { label: 'all', count: 7, from: -Infinity, to: Infinity },
    ]);
  });
});

describe('aggregatePoints', () => {
  const points = [point(0, 10), point(1000, 20), point(2000, 30)];

  it.each([
    ['sum', 60],
    ['avg', 20],
    ['min', 10],
    ['max', 30],
    ['last', 30],
    ['count', 3],
  ] as const)('computes %s', (kind, expected) => {
    expect(aggregatePoints(points, kind)).toBe(expected);
  });

  it('returns undefined for an empty series rather than zero', () => {
    // Zero is a real measurement; "no data" is not, and a chart legend that
    // shows 0 for an absent series is stating something false.
    expect(aggregatePoints([], 'sum')).toBeUndefined();
    expect(aggregatePoints([], 'avg')).toBeUndefined();
  });
});

describe('niceTicks', () => {
  it('produces round numbers spanning the domain', () => {
    const ticks = niceTicks(0, 97, 5);
    expect(ticks[0]).toBeLessThanOrEqual(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(97);
    expect(ticks.every((t) => Number.isFinite(t))).toBe(true);
  });

  it('handles a flat domain without dividing by zero', () => {
    const ticks = niceTicks(5, 5, 4);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((t) => Number.isFinite(t))).toBe(true);
  });

  it('handles a domain of exactly zero', () => {
    expect(niceTicks(0, 0, 4).every((t) => Number.isFinite(t))).toBe(true);
  });
});

describe('downsample', () => {
  it('leaves a series shorter than the budget untouched', () => {
    const points = Array.from({ length: 10 }, (_, i) => point(i * 1000, i));
    expect(downsample(points, 100)).toHaveLength(10);
  });

  it('reduces a long series to roughly the budget', () => {
    const points = Array.from({ length: 5000 }, (_, i) => point(i * 1000, i));
    const reduced = downsample(points, 200);
    expect(reduced.length).toBeLessThanOrEqual(200);
    expect(reduced.length).toBeGreaterThan(0);
  });

  it('keeps the first and last points, so the span does not shrink', () => {
    const points = Array.from({ length: 5000 }, (_, i) => point(i * 1000, i));
    const reduced = downsample(points, 100);
    expect(reduced[0].timestamp).toBe(points[0].timestamp);
    expect(reduced[reduced.length - 1].timestamp).toBe(
      points[points.length - 1].timestamp,
    );
  });

  it('keeps the extremes, so a spike is never averaged away', () => {
    // Downsampling that hides the outlier defeats the purpose of the chart.
    const points = Array.from({ length: 1000 }, (_, i) => point(i * 1000, 1));
    points[500] = point(500 * 1000, 9999);

    const reduced = downsample(points, 50);
    expect(Math.max(...reduced.map((p) => p.value ?? 0))).toBe(9999);
  });
});
