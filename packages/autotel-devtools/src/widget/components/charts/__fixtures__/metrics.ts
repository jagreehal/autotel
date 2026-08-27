/**
 * Metric fixtures for chart stories and tests.
 *
 * Built as real `MetricSeries` values rather than hand-written SVG expectations,
 * so a story and its test exercise the same code path a live series would.
 */

import type { MetricSeries } from '../../../../server/store/store';
import type { MetricPoint } from '../../../../server/metric-streams';

export const T0 = 1_700_000_000_000;

export function points(values: number[], stepMs = 15_000): MetricPoint[] {
  return values.map((value, i) => ({
    timestamp: T0 + i * stepMs,
    attributes: {},
    value,
  }));
}

export function series(over: Partial<MetricSeries> = {}): MetricSeries {
  return {
    seriesId: 'series-1',
    name: 'http.requests',
    unit: '1',
    kind: 'sum',
    temporality: 'delta',
    service: 'api',
    resource: { 'service.name': 'api' },
    attributes: { 'http.method': 'GET' },
    points: points([4, 9, 6, 14, 11, 18, 12, 20]),
    ...over,
  };
}

/** Two series, as a chart with a legend would show. */
export const twoSeries: MetricSeries[] = [
  series({ seriesId: 's-get', attributes: { 'http.method': 'GET' } }),
  series({
    seriesId: 's-post',
    attributes: { 'http.method': 'POST' },
    points: points([1, 2, 2, 5, 3, 6, 4, 7]),
  }),
];

/** A cumulative counter that resets partway, as a restarted process produces. */
export const cumulativeWithReset: MetricSeries[] = [
  series({
    seriesId: 's-cumulative',
    temporality: 'cumulative',
    points: points([10, 25, 44, 70, 3, 12, 25, 41]),
  }),
];

/** A series carrying exemplars, which link a spike to its trace. */
export const withExemplars: MetricSeries[] = [
  series({
    seriesId: 's-exemplar',
    points: points([4, 9, 6, 40, 11, 18, 12, 20]).map((p, i) =>
      i === 3
        ? {
            ...p,
            exemplars: [
              {
                value: 40,
                timestamp: p.timestamp,
                traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
                spanId: '1111111111111111',
              },
            ],
          }
        : p,
    ),
  }),
];

/** A histogram point with buckets, for the distribution chart. */
export const histogramSeries: MetricSeries[] = [
  series({
    seriesId: 's-histogram',
    name: 'http.server.duration',
    unit: 'ms',
    kind: 'histogram',
    attributes: {},
    points: [
      {
        timestamp: T0,
        attributes: {},
        count: 120,
        sum: 8400,
        min: 2,
        max: 1900,
        bucketCounts: [40, 55, 20, 5],
        explicitBounds: [10, 100, 1000],
      },
    ],
  }),
];
