/**
 * Cohort comparison over the wire.
 *
 * The seam is the HTTP request, because the value of this endpoint is the
 * ranking a person reads, not the arithmetic underneath it — that already has
 * its own tests in `autotel/analysis`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { DevtoolsServer } from '../server';
import { attachDevtoolsRoutes } from '../http';

let server: Server | null = null;
let devtools: DevtoolsServer | null = null;

afterEach(async () => {
  if (devtools) await devtools.close();
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

/** `count` spans, all identical apart from the provider and how slow they are. */
function otlp(opts: {
  count: number;
  provider: string;
  durationMs: number;
  from: number;
}) {
  const base = BigInt(Date.now() - 60_000) * 1_000_000n;
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'checkout' } },
          ],
        },
        scopeSpans: [
          {
            scope: {},
            spans: Array.from({ length: opts.count }, (_, i) => ({
              traceId: (opts.from + i).toString(16).padStart(32, '0'),
              spanId: (opts.from + i).toString(16).padStart(16, '0'),
              name: 'checkout',
              kind: 2,
              startTimeUnixNano: base.toString(),
              endTimeUnixNano: (
                base +
                BigInt(opts.durationMs) * 1_000_000n
              ).toString(),
              status: { code: 1 },
              attributes: [
                {
                  key: 'payment.provider',
                  value: { stringValue: opts.provider },
                },
              ],
            })),
          },
        ],
      },
    ],
  };
}

async function ingest(port: number, payload: unknown): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${port}/v1/traces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  expect(res.status).toBe(200);
}

async function compare(port: number, body: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}/api/analysis/compare`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe('POST /api/analysis/compare', () => {
  it('names the attribute that separates the slow requests from the rest', async () => {
    const port = await start();
    // 30 fast on stripe, 20 slow on legacy: the provider is the whole story.
    await ingest(
      port,
      otlp({ count: 30, provider: 'stripe', durationMs: 20, from: 1 }),
    );
    await ingest(
      port,
      otlp({ count: 20, provider: 'legacy', durationMs: 900, from: 100 }),
    );

    const { status, body } = await compare(port, {
      outlier: { query: 'duration > 500' },
      baseline: { query: 'duration <= 500' },
    });

    expect(status).toBe(200);
    const top = body.differences[0];
    expect(top.field).toBe('payment.provider');
    expect(top.value).toBe('legacy');
    expect(top.outlierFraction).toBe(1);
    expect(top.baselineFraction).toBe(0);
  });

  it('reports an unparseable query as a 400, not an empty comparison', async () => {
    const port = await start();
    await ingest(
      port,
      otlp({ count: 5, provider: 'stripe', durationMs: 20, from: 1 }),
    );

    const { status, body } = await compare(port, {
      outlier: { query: 'duration > >' },
      baseline: { query: '' },
    });

    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  it('says so when a side of the comparison is empty', async () => {
    const port = await start();
    await ingest(
      port,
      otlp({ count: 5, provider: 'stripe', durationMs: 20, from: 1 }),
    );

    const { status, body } = await compare(port, {
      outlier: { query: 'duration > 100000' },
      baseline: { query: '' },
    });

    // A fraction over zero events carries no information, and "no differences"
    // would read as "these populations are alike".
    expect(status).toBe(200);
    expect(body.differences).toEqual([]);
    expect(body.outlierCount).toBe(0);
  });
});
