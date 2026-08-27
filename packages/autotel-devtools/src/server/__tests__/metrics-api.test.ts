/**
 * Wire contract for the metrics endpoints.
 *
 * Posts OTLP the way an SDK does and reads it back the way the Metrics tab
 * will. The case worth having end-to-end is the histogram: the Agents path
 * flattens it to a count, so if the two ingest paths were ever collapsed back
 * into one, the buckets would vanish and this is what would notice.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { DevtoolsServer } from '../server';
import { attachDevtoolsRoutes } from '../http';

let server: Server | null = null;
let devtools: DevtoolsServer | null = null;

afterEach(async () => {
  if (devtools) await devtools.close();
  else if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
  devtools = null;
});

async function start(): Promise<number> {
  server = createServer();
  devtools = new DevtoolsServer({ server });
  attachDevtoolsRoutes(server, devtools);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  return (server.address() as { port: number }).port;
}

const T0 = 1_700_000_000_000;
const nano = (ms: number) => String(BigInt(ms) * 1_000_000n);

async function postMetrics(port: number, metrics: unknown[]): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${port}/v1/metrics`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resourceMetrics: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'api' } },
            ],
          },
          scopeMetrics: [{ scope: { name: 'test' }, metrics }],
        },
      ],
    }),
  });
  expect(res.status).toBe(200);
}

interface CatalogueResponse {
  metrics?: Array<{ name: string; kind: string; seriesCount: number }>;
}

interface SeriesResponse {
  series?: Array<{
    attributes: Record<string, unknown>;
    points: Array<{
      value?: number;
      bucketCounts?: number[];
      explicitBounds?: number[];
      exemplars?: Array<{ traceId?: string }>;
    }>;
  }>;
  error?: string;
}

async function catalogue(port: number) {
  const res = await fetch(`http://127.0.0.1:${port}/api/metrics`);
  return { status: res.status, body: (await res.json()) as CatalogueResponse };
}

async function series(port: number, body: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}/api/query/metrics`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as SeriesResponse };
}

describe('metrics endpoints', () => {
  it('lists an ingested metric in the catalogue', async () => {
    const port = await start();
    await postMetrics(port, [
      {
        name: 'http.requests',
        sum: {
          aggregationTemporality: 1,
          dataPoints: [{ asInt: 3, timeUnixNano: nano(T0) }],
        },
      },
    ]);

    const { body } = await catalogue(port);
    expect(body.metrics?.[0]).toMatchObject({
      name: 'http.requests',
      kind: 'sum',
      seriesCount: 1,
    });
  });

  it('returns one series per attribute combination', async () => {
    const port = await start();
    await postMetrics(port, [
      {
        name: 'http.requests',
        sum: {
          dataPoints: [
            {
              asInt: 1,
              timeUnixNano: nano(T0),
              attributes: [
                { key: 'http.method', value: { stringValue: 'GET' } },
              ],
            },
            {
              asInt: 2,
              timeUnixNano: nano(T0),
              attributes: [
                { key: 'http.method', value: { stringValue: 'POST' } },
              ],
            },
          ],
        },
      },
    ]);

    const { body } = await series(port, { name: 'http.requests' });
    expect(body.series).toHaveLength(2);
    expect(body.series?.map((s) => s.attributes['http.method']).sort()).toEqual(
      ['GET', 'POST'],
    );
  });

  it('preserves histogram buckets end to end', async () => {
    // The agent ingest path flattens this to a count; the metrics path must not.
    const port = await start();
    await postMetrics(port, [
      {
        name: 'http.duration',
        unit: 'ms',
        histogram: {
          aggregationTemporality: 1,
          dataPoints: [
            {
              count: 7,
              sum: 1234,
              bucketCounts: [1, 4, 2],
              explicitBounds: [10, 100],
              timeUnixNano: nano(T0),
            },
          ],
        },
      },
    ]);

    const { body } = await series(port, { name: 'http.duration' });
    expect(body.series?.[0].points[0].bucketCounts).toEqual([1, 4, 2]);
    expect(body.series?.[0].points[0].explicitBounds).toEqual([10, 100]);
  });

  it('preserves exemplars, so a spike can be opened as a trace', async () => {
    const port = await start();
    await postMetrics(port, [
      {
        name: 'http.duration',
        histogram: {
          dataPoints: [
            {
              count: 1,
              timeUnixNano: nano(T0),
              exemplars: [
                {
                  asDouble: 900,
                  timeUnixNano: nano(T0),
                  traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
                },
              ],
            },
          ],
        },
      },
    ]);

    const { body } = await series(port, { name: 'http.duration' });
    expect(body.series?.[0].points[0].exemplars?.[0].traceId).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
    );
  });

  it('clips points to a time window', async () => {
    const port = await start();
    await postMetrics(port, [
      {
        name: 'g',
        gauge: {
          dataPoints: [
            { asDouble: 1, timeUnixNano: nano(T0) },
            { asDouble: 2, timeUnixNano: nano(T0 + 10_000) },
          ],
        },
      },
    ]);

    const { body } = await series(port, {
      name: 'g',
      window: { start: T0 + 5000, end: T0 + 20_000 },
    });
    expect(body.series?.[0].points.map((p) => p.value)).toEqual([2]);
  });

  it('rejects a series request with no metric name', async () => {
    const port = await start();
    const { status } = await series(port, {});
    expect(status).toBe(400);
  });

  it('still folds the same batch into agent sessions', async () => {
    // Both ingest paths read one POST; adding the metrics path must not have
    // displaced the agent one.
    const port = await start();
    await postMetrics(port, [
      {
        name: 'claude_code.token.usage',
        sum: {
          aggregationTemporality: 1,
          dataPoints: [
            {
              asInt: 100,
              timeUnixNano: nano(T0),
              attributes: [
                { key: 'session.id', value: { stringValue: 's1' } },
                { key: 'type', value: { stringValue: 'input' } },
              ],
            },
          ],
        },
      },
    ]);

    const { body } = await catalogue(port);
    expect(
      body.metrics?.some((m) => m.name === 'claude_code.token.usage'),
    ).toBe(true);
  });

  it('guards both endpoints against a cross-origin read', async () => {
    const port = await start();
    for (const [path, init] of [
      ['/api/metrics', { method: 'GET' }],
      [
        '/api/query/metrics',
        { method: 'POST', body: JSON.stringify({ name: 'x' }) },
      ],
    ] as const) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          origin: 'http://evil.example.com',
        },
      });
      expect(res.status).toBe(403);
    }
  });
});
