/**
 * @vitest-environment jsdom
 *
 * Shaping functions for the distribution charts.
 *
 * These turn a series of histogram points into the three things a chart can
 * draw: a stack, a set of quantile tracks, and a heatmap grid. Each has one
 * failure mode that is quiet rather than loud:
 *
 *  - **Stacking** must align series on a shared set of timestamps. Stacking by
 *    array index instead silently attributes one series' value to another
 *    series' moment as soon as two series have different sample times, which is
 *    normal when they started at different moments.
 *  - **Quantile tracks** must skip a point with no observations rather than
 *    plotting it as zero — a zero p99 reads as "everything was instant".
 *  - **Heatmap cells** must normalise against the busiest cell, or a single
 *    spike makes every other cell the same shade and the chart says nothing.
 */

import { describe, it, expect } from 'vitest';
import { stackSeries, quantileSeries, heatmapCells } from '../shape';
import type { MetricPoint } from '../../../server/metric-streams';

const T0 = 1_700_000_000_000;

function point(offsetMs: number, value: number): MetricPoint {
  return { timestamp: T0 + offsetMs, attributes: {}, value };
}

function histPoint(
  offsetMs: number,
  bucketCounts: number[],
  explicitBounds: number[],
): MetricPoint {
  return {
    timestamp: T0 + offsetMs,
    attributes: {},
    count: bucketCounts.reduce((sum, n) => sum + n, 0),
    bucketCounts,
    explicitBounds,
  };
}

describe('stackSeries', () => {
  it('returns nothing for no series', () => {
    expect(stackSeries([])).toEqual([]);
  });

  it('leaves a single series with a zero baseline', () => {
    const [stacked] = stackSeries([[point(0, 5), point(1000, 7)]]);
    expect(stacked.map((b) => [b.y0, b.y1])).toEqual([
      [0, 5],
      [0, 7],
    ]);
  });

  it('stacks a second series on top of the first', () => {
    const [first, second] = stackSeries([[point(0, 5)], [point(0, 3)]]);
    expect(first[0]).toMatchObject({ y0: 0, y1: 5 });
    expect(second[0]).toMatchObject({ y0: 5, y1: 8 });
  });

  it('aligns on timestamps, not array position', () => {
    // The series were sampled at different moments. Stacking by index would
    // put b's 100 on top of a's value at t=0, which is a different moment.
    const [a, b] = stackSeries([
      [point(0, 1), point(1000, 2)],
      [point(1000, 100)],
    ]);

    expect(a.map((band) => band.timestamp)).toEqual([T0, T0 + 1000]);
    // b contributes only at t=1000, sitting on a's value *there*.
    const at1000 = b.find((band) => band.timestamp === T0 + 1000);
    expect(at1000).toMatchObject({ y0: 2, y1: 102 });
  });

  it('treats a timestamp a series did not sample as a zero-height band', () => {
    // A gap must not shift the series above it down — the stack has to stay
    // continuous across the union of timestamps.
    const [, b] = stackSeries([
      [point(0, 4), point(1000, 4)],
      [point(1000, 1)],
    ]);
    const at0 = b.find((band) => band.timestamp === T0);
    expect(at0).toMatchObject({ y0: 4, y1: 4 });
  });

  it('emits every series over the union of timestamps', () => {
    const stacked = stackSeries([[point(0, 1)], [point(1000, 1)]]);
    for (const series of stacked) expect(series).toHaveLength(2);
  });

  it('orders bands oldest first, as a chart draws them', () => {
    const [series] = stackSeries([[point(2000, 1), point(0, 2)]]);
    expect(series.map((b) => b.timestamp)).toEqual([T0, T0 + 2000]);
  });

  it('handles a negative value without inverting the band', () => {
    // Up/down counters exist; a band whose top is below its base would render
    // as a fold rather than a gap.
    const [series] = stackSeries([[point(0, -3)]]);
    expect(series[0].y1).toBeGreaterThanOrEqual(series[0].y0);
  });
});

describe('quantileSeries', () => {
  const bounds = [10, 100];
  const points = [
    histPoint(0, [2, 5, 3], bounds),
    histPoint(1000, [8, 1, 1], bounds),
  ];

  it('produces one track per requested quantile', () => {
    const tracks = quantileSeries(points, [0.5, 0.99]);
    expect(tracks.map((t) => t.quantile)).toEqual([0.5, 0.99]);
  });

  it('produces one point per input point', () => {
    const [p50] = quantileSeries(points, [0.5]);
    expect(p50.points.map((p) => p.timestamp)).toEqual([T0, T0 + 1000]);
  });

  it('tracks the distribution shifting over time', () => {
    // The second point is dominated by the fast bucket, so its p50 must be
    // lower than the first's.
    const [p50] = quantileSeries(points, [0.5]);
    expect(p50.points[1].value).toBeLessThan(p50.points[0].value);
  });

  it('skips a point with no observations rather than plotting zero', () => {
    // A zero p99 reads as "everything was instant", which is the opposite of
    // "we have no data for this moment".
    const [p99] = quantileSeries(
      [histPoint(0, [0, 0, 0], bounds), histPoint(1000, [1, 1, 1], bounds)],
      [0.99],
    );
    expect(p99.points.map((p) => p.timestamp)).toEqual([T0 + 1000]);
  });

  it('skips a malformed point rather than guessing at it', () => {
    const bad: MetricPoint = {
      timestamp: T0,
      attributes: {},
      bucketCounts: [1, 2],
      explicitBounds: [10, 100],
    };
    expect(quantileSeries([bad], [0.5])[0].points).toEqual([]);
  });

  it('returns empty tracks for no points, not no tracks', () => {
    // The legend still has to show p50/p90/p99 with nothing plotted, rather
    // than the rows vanishing.
    const tracks = quantileSeries([], [0.5, 0.9]);
    expect(tracks).toHaveLength(2);
    expect(tracks.every((t) => t.points.length === 0)).toBe(true);
  });

  it('keeps tracks ordered as requested, so the legend order is stable', () => {
    const tracks = quantileSeries(points, [0.99, 0.5, 0.9]);
    expect(tracks.map((t) => t.quantile)).toEqual([0.99, 0.5, 0.9]);
  });
});

describe('heatmapCells', () => {
  const bounds = [10, 100];
  const points = [
    histPoint(0, [1, 0, 0], bounds),
    histPoint(1000, [0, 4, 0], bounds),
  ];

  it('produces a column per point and a row per bucket', () => {
    const grid = heatmapCells(points);
    expect(grid.columns).toHaveLength(2);
    expect(grid.rows).toHaveLength(3);
  });

  it('labels the rows by bucket range', () => {
    expect(heatmapCells(points).rows.map((r) => r.label)).toEqual([
      '≤10',
      '10–100',
      '>100',
    ]);
  });

  it('normalises intensity against the busiest cell', () => {
    // Without normalising, one spike makes every other cell the same shade and
    // the chart stops saying anything.
    const grid = heatmapCells(points);
    const busiest = grid.columns[1].cells[1];
    expect(busiest.intensity).toBe(1);
    expect(grid.columns[0].cells[0].intensity).toBeCloseTo(0.25);
  });

  it('gives an empty cell zero intensity, distinct from a faint one', () => {
    const grid = heatmapCells(points);
    expect(grid.columns[0].cells[1]).toMatchObject({ count: 0, intensity: 0 });
  });

  it('returns an empty grid for no points', () => {
    expect(heatmapCells([])).toEqual({ columns: [], rows: [], max: 0 });
  });

  it('returns an empty grid when no point carries buckets', () => {
    expect(heatmapCells([point(0, 5)]).columns).toEqual([]);
  });

  it('reports the busiest count, for the legend scale', () => {
    expect(heatmapCells(points).max).toBe(4);
  });

  it('handles an all-zero histogram without dividing by zero', () => {
    const grid = heatmapCells([histPoint(0, [0, 0, 0], bounds)]);
    expect(
      grid.columns[0].cells.every((cell) => Number.isFinite(cell.intensity)),
    ).toBe(true);
  });

  it('ignores a point whose bucket layout differs from the first', () => {
    // Two layouts cannot share a row axis; plotting them together would put
    // different ranges on the same row and silently misreport the distribution.
    const grid = heatmapCells([
      histPoint(0, [1, 0, 0], bounds),
      histPoint(1000, [1, 1, 1, 1], [1, 10, 100]),
    ]);
    expect(grid.columns).toHaveLength(1);
  });
});
