import { describe, expect, it } from 'vitest';
import { reduceMetricPoints } from '../metric-reduction';
import type { MetricPoint } from '../metric-streams';

const point = (timestamp: number, value: number): MetricPoint => ({
  timestamp,
  value,
  attributes: {},
});

describe('server metric reduction', () => {
  it('bounds gauge payloads while preserving a narrow spike', () => {
    const points = Array.from({ length: 200_000 }, (_, index) =>
      point(index, index === 99_999 ? 10_000 : 1),
    );
    const reduced = reduceMetricPoints(points, 'gauge', 2_000);
    expect(reduced.length).toBeLessThanOrEqual(2_000);
    expect(Math.max(...reduced.map((item) => item.value ?? 0))).toBe(10_000);
  });

  it('merges compatible histogram buckets and caps exemplars', () => {
    const points = Array.from({ length: 100 }, (_, index): MetricPoint => ({
      timestamp: index,
      attributes: {},
      count: 3,
      sum: 6,
      min: 1,
      max: 3,
      explicitBounds: [1, 2],
      bucketCounts: [1, 1, 1],
      exemplars: [{ value: 3, timestamp: index, traceId: String(index) }],
    }));
    const reduced = reduceMetricPoints(points, 'histogram', 10, {
      maxExemplars: 4,
    });
    expect(reduced).toHaveLength(10);
    expect(reduced[0].count).toBe(30);
    expect(reduced[0].bucketCounts).toEqual([10, 10, 10]);
    expect(reduced.flatMap((item) => item.exemplars ?? [])).toHaveLength(4);
  });

  it('does not sum cumulative histogram snapshots while reducing them', () => {
    const points = Array.from({ length: 100 }, (_, index): MetricPoint => ({
      timestamp: index,
      attributes: {},
      count: index + 1,
      sum: (index + 1) * 2,
      explicitBounds: [1],
      bucketCounts: [index + 1, 0],
    }));

    const reduced = reduceMetricPoints(points, 'histogram', 10, {
      maxExemplars: 4,
      temporality: 'cumulative',
    });

    expect(reduced).toHaveLength(10);
    expect(reduced[0].count).toBe(10);
    expect(reduced[0].bucketCounts).toEqual([10, 0]);
    expect(reduced.at(-1)?.count).toBe(100);
  });
});
