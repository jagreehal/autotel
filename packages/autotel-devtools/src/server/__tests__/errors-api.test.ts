/**
 * Wire contract for the error query endpoint.
 *
 * Errors used to be aggregated once on ingest and broadcast as full state, so
 * the Errors tab could only ever describe the live tail — the last hundred
 * traces — and had no way to answer "what was failing an hour ago".
 *
 * The aggregator is a pure fold over traces, so it is re-run over whatever the
 * store returns for the requested window and query. That means the grouping,
 * fingerprinting and sampling rules are exactly the ones the live path uses;
 * there is no second implementation to drift.
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
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
}

const nano = (ms: number) => String(BigInt(Math.round(ms)) * 1_000_000n);

async function postFailingSpan(
  port: number,
  opts: {
    traceId: string;
    spanId: string;
    startMs: number;
    message: string;
    service?: string;
    type?: string;
  },
): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${port}/v1/traces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resourceSpans: [
        {
          resource: {
            attributes: [
              {
                key: 'service.name',
                value: { stringValue: opts.service ?? 'api' },
              },
            ],
          },
          scopeSpans: [
            {
              scope: {},
              spans: [
                {
                  traceId: opts.traceId,
                  spanId: opts.spanId,
                  name: 'POST /checkout',
                  kind: 2,
                  startTimeUnixNano: nano(opts.startMs),
                  endTimeUnixNano: nano(opts.startMs + 5),
                  status: { code: 2, message: opts.message },
                  attributes: [
                    {
                      key: 'exception.type',
                      value: { stringValue: opts.type ?? 'TypeError' },
                    },
                    {
                      key: 'exception.message',
                      value: { stringValue: opts.message },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
  });
  expect(res.status).toBe(200);
}

interface ErrorsResponse {
  errors?: Array<{
    fingerprint: string;
    message: string;
    count: number;
    service?: string;
  }>;
  errors_?: never;
}

async function query(port: number, body: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}/api/query/errors`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as ErrorsResponse };
}

const T0 = Date.now() - 10 * 60_000;

async function seed(port: number) {
  await postFailingSpan(port, {
    traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
    spanId: '1111111111111111',
    startMs: T0,
    message: 'card declined',
  });
  await postFailingSpan(port, {
    traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2',
    spanId: '2222222222222222',
    startMs: T0 + 60_000,
    message: 'card declined',
  });
  await postFailingSpan(port, {
    traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3',
    spanId: '3333333333333333',
    startMs: T0 + 120_000,
    message: 'gateway timeout',
    service: 'worker',
    type: 'TimeoutError',
  });
}

describe('POST /api/query/errors', () => {
  it('groups repeated failures into one entry with a count', async () => {
    const port = await start();
    await seed(port);

    const { body } = await query(port, { query: '' });
    const declined = body.errors?.find((e) => e.message.includes('declined'));
    expect(declined?.count).toBe(2);
  });

  it('keeps distinct failures apart', async () => {
    const port = await start();
    await seed(port);

    const { body } = await query(port, { query: '' });
    expect(body.errors).toHaveLength(2);
  });

  it('restricts to a time window, which the live aggregator could not', async () => {
    const port = await start();
    await seed(port);

    const { body } = await query(port, {
      window: { start: T0 + 90_000, end: T0 + 200_000 },
    });
    expect(body.errors?.map((e) => e.message)).toEqual(['gateway timeout']);
  });

  it('accepts a query, so errors can be narrowed like anything else', async () => {
    const port = await start();
    await seed(port);

    const { body } = await query(port, { query: 'service = worker' });
    expect(body.errors).toHaveLength(1);
  });

  it('returns nothing when the window excludes every failure', async () => {
    const port = await start();
    await seed(port);

    const { body } = await query(port, {
      window: { start: T0 - 60 * 60_000, end: T0 - 30 * 60_000 },
    });
    expect(body.errors).toEqual([]);
  });

  it('reports a malformed query as 400 with positioned errors', async () => {
    const port = await start();
    const { status, body } = await query(port, { query: 'service =' });
    expect(status).toBe(400);
    expect((body as { errors: unknown[] }).errors.length).toBeGreaterThan(0);
  });

  it('rejects a cross-origin read', async () => {
    const port = await start();
    const res = await fetch(`http://127.0.0.1:${port}/api/query/errors`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://evil.example.com',
      },
      body: JSON.stringify({ query: '' }),
    });
    expect(res.status).toBe(403);
  });

  it('names the affected traces, so a group can be opened', async () => {
    const port = await start();
    await seed(port);

    const res = await fetch(`http://127.0.0.1:${port}/api/query/errors`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '' }),
    });
    const body = (await res.json()) as {
      errors: Array<{ affectedTraces: string[] }>;
    };
    expect(body.errors[0].affectedTraces.length).toBeGreaterThan(0);
  });
});
