import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { describe, expect, it } from 'vitest';
import { readStateTransitions } from '../../modules/state-transitions';
import type { MetricSeries } from '../../types';
import type { TelemetryBackend } from '../telemetry';
import { CollectorStore } from './store';
import { parseMetrics } from './receiver';

const LANE_PAYLOAD = {
  resourceMetrics: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'kent-mcp-homework' } },
        ],
      },
      scopeMetrics: [
        {
          metrics: [
            {
              name: 'mcp.protocol.lane.requests',
              sum: {
                dataPoints: [
                  {
                    timeUnixNano: '1000000000',
                    asInt: '15',
                    attributes: [
                      { key: 'lane', value: { stringValue: 'legacy' } },
                    ],
                  },
                  {
                    timeUnixNano: '1000000000',
                    asInt: '6',
                    attributes: [
                      { key: 'lane', value: { stringValue: 'modern' } },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
};

describe('metric dimensions survive ingest and query', () => {
  it('splits one metric into a series per data-point attribute set', () => {
    const series = parseMetrics(LANE_PAYLOAD);

    expect(series).toHaveLength(2);
    expect(series.map((s) => s.attributes?.lane).sort()).toEqual([
      'legacy',
      'modern',
    ]);
    // Resource attributes still ride along on every series.
    expect(series[0]?.attributes?.['service.name']).toBe('kent-mcp-homework');
  });

  it('lists each lane as its own series instead of merging them', async () => {
    const store = new CollectorStore({ maxTraces: 10, retentionMs: 60_000 });
    await store.init();
    await store.insertMetrics(parseMetrics(LANE_PAYLOAD));

    const result = await store.listMetrics({
      metricName: 'mcp.protocol.lane.requests',
    });

    expect(result.totalCount).toBe(2);
    const byLane = Object.fromEntries(
      result.items.map((s) => [s.attributes?.lane, s.points[0]?.value]),
    );
    expect(byLane).toEqual({ legacy: 15, modern: 6 });
  });

  it('drops points outside the requested lookback window', async () => {
    const store = new CollectorStore({ maxTraces: 10, retentionMs: 60_000 });
    await store.init();
    const now = Date.now();
    await store.insertMetrics([
      {
        metricName: 'mcp.protocol.lane.requests',
        attributes: { lane: 'legacy' },
        points: [
          { timestampUnixMs: now - 120 * 60_000, value: 1 },
          { timestampUnixMs: now - 60_000, value: 2 },
        ],
      },
    ]);

    const recent = await store.listMetrics({
      metricName: 'mcp.protocol.lane.requests',
      lookbackMinutes: 60,
    });
    expect(recent.items[0]?.points.map((p) => p.value)).toEqual([2]);

    const all = await store.listMetrics({
      metricName: 'mcp.protocol.lane.requests',
    });
    expect(all.items[0]?.points).toHaveLength(2);
  });

  describe.each([
    ['exponential histogram', 'exponentialHistogram'],
    ['summary', 'summary'],
  ])('%s data points', (_, kind) => {
    it('reports the mean, as a histogram does', () => {
      const [series] = parseMetrics({
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'latency',
                    [kind]: {
                      dataPoints: [
                        { timeUnixNano: '1000000', sum: 3, count: '4' },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      });

      expect(series?.metricName).toBe('latency');
      expect(series?.points[0]?.value).toBe(0.75);
    });
  });

  describe('histogram data points', () => {
    const histogram = (point: { sum?: number; count?: string | number }) =>
      parseMetrics({
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'http.server.request.duration',
                    histogram: {
                      dataPoints: [{ timeUnixNano: '1000000', ...point }],
                    },
                  },
                ],
              },
            ],
          },
        ],
      })[0]?.points[0]?.value;

    it('reports the mean, since a histogram has no single value', () => {
      expect(histogram({ sum: 3, count: 4 })).toBe(0.75);
    });

    it('reads count as OTLP/JSON sends it, a decimal string', () => {
      expect(histogram({ sum: 3, count: '4' })).toBe(0.75);
    });

    it('is 0 with no observations, not NaN', () => {
      expect(histogram({ sum: 0, count: 0 })).toBe(0);
      expect(histogram({ count: '0' })).toBe(0);
    });

    it('is 0 when the optional sum is absent, as it can be for negative measurements', () => {
      expect(histogram({ count: 4 })).toBe(0);
    });
  });
});

describe('metric temporality survives ingest and query', () => {
  const counter = (
    value: number,
    timeMs: number,
    aggregationTemporality: number | string,
  ) => ({
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'orders' } },
          ],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'autotel.state.transitions',
                sum: {
                  aggregationTemporality,
                  dataPoints: [
                    {
                      timeUnixNano: String(timeMs * 1_000_000),
                      asInt: String(value),
                      attributes: [
                        ['state.entity', 'order'],
                        ['state.field', 'status'],
                        ['state.from', 'open'],
                        ['state.to', 'paid'],
                      ].map(([key, stringValue]) => ({
                        key,
                        value: { stringValue },
                      })),
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  });

  async function count(store: CollectorStore): Promise<number | undefined> {
    const document = await readStateTransitions(
      // SAFETY: readStateTransitions reaches only the store methods a backend shares.
      store as unknown as TelemetryBackend,
      { lookbackMinutes: 60 },
    );
    return document.transitions[0]?.count;
  }

  const minutesAgo = (minutes: number) => Date.now() - minutes * 60_000;

  it.each([
    ['the OTLP number', 1],
    ['the protobuf enum name', 'AGGREGATION_TEMPORALITY_DELTA'],
  ])('sums delta points sent as %s', async (_name, delta) => {
    const store = new CollectorStore({ maxTraces: 10, retentionMs: 3_600_000 });
    await store.init();
    await store.insertMetrics(parseMetrics(counter(2, minutesAgo(2), delta)));
    await store.insertMetrics(parseMetrics(counter(2, minutesAgo(1), delta)));

    expect(await count(store)).toBe(4);
  });

  it('keeps the temporality of an exponential histogram', () => {
    const [series] = parseMetrics({
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: 'latency',
                  exponentialHistogram: {
                    aggregationTemporality: 1,
                    dataPoints: [
                      { timeUnixNano: '1000000', sum: 3, count: '4' },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(series?.temporality).toBe('delta');
  });

  const startedAt = (series: MetricSeries[], startTimeUnixMs: number) =>
    series.map((one) => ({
      ...one,
      points: one.points.map((p) => ({ ...p, startTimeUnixMs })),
    }));

  it('counts up from the first point of a series older than the window', async () => {
    const store = new CollectorStore({ maxTraces: 10, retentionMs: 3_600_000 });
    await store.init();
    const started = minutesAgo(600);
    for (const [value, minutes] of [
      [5000, 3],
      [5001, 2],
      [5003, 1],
    ] as const) {
      await store.insertMetrics(
        startedAt(
          parseMetrics(counter(value, minutesAgo(minutes), 2)),
          started,
        ),
      );
    }

    expect(await count(store)).toBe(3);
  });

  it('counts the first point of a series that began in the window', async () => {
    const store = new CollectorStore({ maxTraces: 10, retentionMs: 3_600_000 });
    await store.init();
    await store.insertMetrics(
      startedAt(parseMetrics(counter(1, minutesAgo(1), 2)), minutesAgo(2)),
    );

    expect(await count(store)).toBe(1);
  });

  it('applies the series limit to series, keeping the newest points', async () => {
    const store = new CollectorStore({ maxTraces: 10, retentionMs: 3_600_000 });
    await store.init();
    for (let minutes = 30; minutes > 0; minutes--) {
      await store.insertMetrics(
        parseMetrics(counter(30 - minutes, minutesAgo(minutes), 2)),
      );
    }

    const series = await store.getMetricSeries('autotel.state.transitions', {
      limit: 5,
    });
    expect(series).toHaveLength(1);
    expect(series[0]?.points).toHaveLength(30);
    expect(series[0]?.points.at(-1)?.value).toBe(29);
  });

  it('still reads cumulative points as a running total', async () => {
    const store = new CollectorStore({ maxTraces: 10, retentionMs: 3_600_000 });
    await store.init();
    await store.insertMetrics(parseMetrics(counter(2, minutesAgo(2), 2)));
    await store.insertMetrics(parseMetrics(counter(4, minutesAgo(1), 2)));

    expect(await count(store)).toBe(4);
  });

  it('reports temporality from both read paths', async () => {
    const store = new CollectorStore({ maxTraces: 10, retentionMs: 3_600_000 });
    await store.init();
    await store.insertMetrics(parseMetrics(counter(2, minutesAgo(1), 1)));

    const [series] = await store.getMetricSeries('autotel.state.transitions');
    const { items } = await store.listMetrics({});
    expect(series?.temporality).toBe('delta');
    expect(items[0]?.temporality).toBe('delta');
  });

  it('keeps delta points apart from a cumulative series of the same name', async () => {
    const store = new CollectorStore({ maxTraces: 10, retentionMs: 3_600_000 });
    await store.init();
    await store.insertMetrics(parseMetrics(counter(5, minutesAgo(3), 2)));
    await store.insertMetrics(parseMetrics(counter(2, minutesAgo(2), 1)));

    const { items, totalCount } = await store.listMetrics({});
    expect(items).toHaveLength(2);
    expect(totalCount).toBe(2);
    expect(await count(store)).toBe(7);
  });

  it('upgrades a --persist file, continuing its cumulative series', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'autotel-mcp-'));
    const url = `file:${path.join(dir, 'collector.db')}`;
    try {
      const old = createClient({ url });
      await old.execute(`CREATE TABLE metric_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metric_name TEXT NOT NULL,
        unit TEXT,
        timestamp_unix_ms INTEGER NOT NULL,
        value REAL NOT NULL,
        attributes TEXT NOT NULL DEFAULT '{}'
      )`);
      const [before] = parseMetrics(counter(10, minutesAgo(2), 2));
      await old.execute({
        sql: `INSERT INTO metric_points (metric_name, timestamp_unix_ms, value, attributes)
              VALUES (?, ?, ?, ?)`,
        args: [
          before!.metricName,
          before!.points[0]!.timestampUnixMs,
          10,
          JSON.stringify(before!.attributes),
        ],
      });
      old.close();

      const store = new CollectorStore({
        url,
        maxTraces: 10,
        retentionMs: 3_600_000,
      });
      await store.init();
      await store.init();
      await store.insertMetrics(parseMetrics(counter(12, minutesAgo(1), 2)));

      // One series: 10 is all new, then 12 gains 2. Split, it would be 22.
      expect(await count(store)).toBe(12);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
