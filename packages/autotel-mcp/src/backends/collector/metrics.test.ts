import { describe, expect, it } from 'vitest';
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
});
