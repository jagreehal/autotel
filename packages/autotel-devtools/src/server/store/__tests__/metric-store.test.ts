/**
 * Metric storage contract.
 *
 * The concept that carries the weight is **series identity**: one chart line is
 * one `(name, kind, unit, service, scope, point attributes)` combination. Get it
 * wrong in one direction and every series collapses into one meaningless line;
 * wrong in the other and one logical series splits into a new line on every
 * export. Most of these tests are about that boundary.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DevtoolsStore } from '../store';
import type { MetricStreamRecord } from '../../metric-streams';

let dir: string;
let store: DevtoolsStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'autotel-metrics-'));
  store = new DevtoolsStore({ path: join(dir, 'metrics.db') });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const T0 = 1_700_000_000_000;

function stream(over: Partial<MetricStreamRecord> = {}): MetricStreamRecord {
  return {
    name: 'http.requests',
    unit: '1',
    kind: 'sum',
    temporality: 'delta',
    monotonic: true,
    service: 'api',
    scope: { name: 'test' },
    resource: {},
    points: [{ timestamp: T0, attributes: {}, value: 1 }],
    ...over,
  };
}

describe('series identity', () => {
  it('keeps points with the same identity on one series', () => {
    store.ingestMetrics([
      stream({ points: [{ timestamp: T0, attributes: {}, value: 1 }] }),
      stream({ points: [{ timestamp: T0 + 1000, attributes: {}, value: 2 }] }),
    ]);

    const series = store.queryMetricSeries({ name: 'http.requests' });
    expect(series).toHaveLength(1);
    expect(series[0].points).toHaveLength(2);
  });

  it('splits series that differ by point attributes', () => {
    // Two chart lines: GET and POST.
    store.ingestMetrics([
      stream({
        points: [
          { timestamp: T0, attributes: { 'http.method': 'GET' }, value: 1 },
          { timestamp: T0, attributes: { 'http.method': 'POST' }, value: 2 },
        ],
      }),
    ]);

    const series = store.queryMetricSeries({ name: 'http.requests' });
    expect(series).toHaveLength(2);
  });

  it('is stable against attribute ordering', () => {
    // The same attributes in a different order are the same series — an
    // exporter is under no obligation to keep key order stable between batches.
    store.ingestMetrics([
      stream({
        points: [{ timestamp: T0, attributes: { a: '1', b: '2' }, value: 1 }],
      }),
      stream({
        points: [
          { timestamp: T0 + 1, attributes: { b: '2', a: '1' }, value: 2 },
        ],
      }),
    ]);

    expect(store.queryMetricSeries({ name: 'http.requests' })).toHaveLength(1);
  });

  it('splits series that differ by service', () => {
    store.ingestMetrics([
      stream({ service: 'api' }),
      stream({ service: 'worker' }),
    ]);
    expect(store.queryMetricSeries({ name: 'http.requests' })).toHaveLength(2);
  });

  it('splits series that differ by scope', () => {
    store.ingestMetrics([
      stream({ scope: { name: 'a' } }),
      stream({ scope: { name: 'b' } }),
    ]);
    expect(store.queryMetricSeries({ name: 'http.requests' })).toHaveLength(2);
  });

  it('splits series that differ by resource attributes', () => {
    store.ingestMetrics([
      stream({ resource: { 'host.name': 'one' } }),
      stream({ resource: { 'host.name': 'two' } }),
    ]);
    const series = store.queryMetricSeries({ name: 'http.requests' });
    expect(series).toHaveLength(2);
    expect(series.map((item) => item.resource['host.name']).sort()).toEqual([
      'one',
      'two',
    ]);
  });

  it('does not merge different metric names', () => {
    store.ingestMetrics([stream({ name: 'a' }), stream({ name: 'b' })]);
    expect(
      store
        .listMetricNames()
        .map((m) => m.name)
        .sort(),
    ).toEqual(['a', 'b']);
  });
});

describe('point storage', () => {
  it('is idempotent on a replayed point', () => {
    const s = stream();
    store.ingestMetrics([s]);
    store.ingestMetrics([s]);
    expect(
      store.queryMetricSeries({ name: 'http.requests' })[0].points,
    ).toHaveLength(1);
  });

  it('round-trips histogram buckets and bounds', () => {
    store.ingestMetrics([
      stream({
        name: 'http.duration',
        kind: 'histogram',
        points: [
          {
            timestamp: T0,
            attributes: {},
            count: 7,
            sum: 1234.5,
            min: 3,
            max: 900,
            bucketCounts: [1, 4, 2],
            explicitBounds: [10, 100],
          },
        ],
      }),
    ]);

    const [series] = store.queryMetricSeries({ name: 'http.duration' });
    expect(series.points[0].bucketCounts).toEqual([1, 4, 2]);
    expect(series.points[0].explicitBounds).toEqual([10, 100]);
    expect(series.points[0].sum).toBe(1234.5);
  });

  it('round-trips exponential histogram buckets', () => {
    store.ingestMetrics([
      stream({
        name: 'rpc.duration',
        kind: 'exponentialHistogram',
        points: [
          {
            timestamp: T0,
            attributes: {},
            count: 7,
            scale: 2,
            zeroCount: 1,
            zeroThreshold: 0.01,
            positive: { offset: -2, bucketCounts: [2, 3] },
            negative: { offset: 1, bucketCounts: [1] },
          },
        ],
      }),
    ]);

    const [series] = store.queryMetricSeries({ name: 'rpc.duration' });
    expect(series.points[0]).toMatchObject({
      scale: 2,
      zeroCount: 1,
      zeroThreshold: 0.01,
      positive: { offset: -2, bucketCounts: [2, 3] },
      negative: { offset: 1, bucketCounts: [1] },
    });
  });

  it('round-trips exemplars, which is what links a spike to its trace', () => {
    store.ingestMetrics([
      stream({
        points: [
          {
            timestamp: T0,
            attributes: {},
            value: 1,
            exemplars: [
              { value: 903.2, timestamp: T0, traceId: 'abc', spanId: 'def' },
            ],
          },
        ],
      }),
    ]);

    const [series] = store.queryMetricSeries({ name: 'http.requests' });
    expect(series.points[0].exemplars).toEqual([
      { value: 903.2, timestamp: T0, traceId: 'abc', spanId: 'def' },
    ]);
  });

  it('returns points oldest-first, which is the order a chart draws them in', () => {
    store.ingestMetrics([
      stream({
        points: [
          { timestamp: T0 + 2000, attributes: {}, value: 3 },
          { timestamp: T0, attributes: {}, value: 1 },
          { timestamp: T0 + 1000, attributes: {}, value: 2 },
        ],
      }),
    ]);

    const [series] = store.queryMetricSeries({ name: 'http.requests' });
    expect(series.points.map((p) => p.value)).toEqual([1, 2, 3]);
  });

  it('survives a close and reopen', () => {
    const path = join(dir, 'persist.db');
    const first = new DevtoolsStore({ path });
    first.ingestMetrics([stream()]);
    first.close();

    const second = new DevtoolsStore({ path });
    expect(second.queryMetricSeries({ name: 'http.requests' })).toHaveLength(1);
    second.close();
  });

  it('migrates pre-resource series without splitting future points', () => {
    const path = join(dir, 'legacy-metrics.db');
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE metric_series (
        series_id TEXT PRIMARY KEY, name TEXT NOT NULL, unit TEXT,
        description TEXT, kind TEXT NOT NULL, temporality TEXT,
        monotonic INTEGER, service TEXT NOT NULL, scope_name TEXT,
        scope_version TEXT, attributes TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE metric_points (
        series_id TEXT NOT NULL, timestamp INTEGER NOT NULL,
        start_timestamp INTEGER, value REAL, count REAL, sum REAL, min REAL,
        max REAL, bucket_counts TEXT, explicit_bounds TEXT, quantiles TEXT,
        exemplars TEXT, PRIMARY KEY (series_id, timestamp)
      );
      INSERT INTO metric_series VALUES (
        'legacy', 'http.requests', '1', NULL, 'sum', 'delta', 1,
        'api', 'test', NULL, '{}'
      );
      INSERT INTO metric_points (series_id, timestamp, value)
      VALUES ('legacy', ${T0}, 1);
    `);
    legacy.close();

    const migrated = new DevtoolsStore({ path });
    migrated.ingestMetrics([
      stream({
        resource: { 'service.name': 'api' },
        points: [{ timestamp: T0 + 1, attributes: {}, value: 2 }],
      }),
    ]);
    const series = migrated.queryMetricSeries({ name: 'http.requests' });
    expect(series).toHaveLength(1);
    expect(series[0].points).toHaveLength(2);
    expect(series[0].resource).toEqual({ 'service.name': 'api' });
    migrated.close();
  });
});

describe('querying', () => {
  beforeEach(() => {
    store.ingestMetrics([
      stream({
        points: [
          { timestamp: T0, attributes: { 'http.method': 'GET' }, value: 1 },
          {
            timestamp: T0 + 5000,
            attributes: { 'http.method': 'GET' },
            value: 2,
          },
          {
            timestamp: T0 + 10_000,
            attributes: { 'http.method': 'GET' },
            value: 3,
          },
        ],
      }),
      stream({
        name: 'other.metric',
        points: [{ timestamp: T0, attributes: {}, value: 9 }],
      }),
    ]);
  });

  it('returns only the requested metric', () => {
    const series = store.queryMetricSeries({ name: 'http.requests' });
    expect(series.every((s) => s.name === 'http.requests')).toBe(true);
  });

  it('clips points to a time window', () => {
    const [series] = store.queryMetricSeries({
      name: 'http.requests',
      window: { start: T0 + 1000, end: T0 + 6000 },
    });
    expect(series.points.map((p) => p.value)).toEqual([2]);
  });

  it('omits a series with no points in the window rather than returning an empty line', () => {
    const series = store.queryMetricSeries({
      name: 'http.requests',
      window: { start: T0 - 10_000, end: T0 - 5000 },
    });
    expect(series).toEqual([]);
  });

  it('lists metric names with their kind and unit for the catalogue', () => {
    const names = store.listMetricNames();
    const requests = names.find((n) => n.name === 'http.requests');
    expect(requests).toMatchObject({ kind: 'sum', unit: '1' });
  });

  it('reports how many series each metric has, so the list can say so', () => {
    const requests = store
      .listMetricNames()
      .find((n) => n.name === 'http.requests');
    expect(requests?.seriesCount).toBe(1);
  });

  it('exposes the series-identifying attributes for the legend', () => {
    const [series] = store.queryMetricSeries({ name: 'http.requests' });
    expect(series.attributes).toEqual({ 'http.method': 'GET' });
  });
});

describe('retention', () => {
  it('drops the oldest points past the cap', () => {
    const capped = new DevtoolsStore({
      path: join(dir, 'capped.db'),
      maxMetricPoints: 3,
    });
    capped.ingestMetrics([
      stream({
        points: Array.from({ length: 6 }, (_, i) => ({
          timestamp: T0 + i * 1000,
          attributes: {},
          value: i,
        })),
      }),
    ]);
    capped.enforceRetention();

    const [series] = capped.queryMetricSeries({ name: 'http.requests' });
    expect(series.points.map((p) => p.value)).toEqual([3, 4, 5]);
    capped.close();
  });

  it('clear removes metrics as well as traces', () => {
    store.ingestMetrics([stream()]);
    store.clear();
    expect(store.listMetricNames()).toEqual([]);
  });
});
