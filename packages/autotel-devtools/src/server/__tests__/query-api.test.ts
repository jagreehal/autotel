/**
 * Wire contract for the query endpoint.
 *
 * The seam is the HTTP request/response, not the store: these tests post OTLP
 * in the way a real SDK does, then query it back the way the UI does. If the
 * ingest path, the store schema and the compiled SQL disagree with each other,
 * this is where it shows — a store unit test would pass regardless.
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

/** One OTLP span, shaped the way an SDK sends it. */
function otlpSpan(opts: {
  traceId: string;
  spanId: string;
  name: string;
  service: string;
  startMs: number;
  durationMs: number;
  status?: number;
  attributes?: Array<{ key: string; value: Record<string, unknown> }>;
}) {
  const startNano = BigInt(opts.startMs) * 1_000_000n;
  const endNano = startNano + BigInt(opts.durationMs) * 1_000_000n;
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: opts.service } },
          ],
        },
        scopeSpans: [
          {
            scope: {},
            spans: [
              {
                traceId: opts.traceId,
                spanId: opts.spanId,
                name: opts.name,
                kind: 2,
                startTimeUnixNano: startNano.toString(),
                endTimeUnixNano: endNano.toString(),
                status: { code: opts.status ?? 1 },
                attributes: opts.attributes ?? [],
              },
            ],
          },
        ],
      },
    ],
  };
}

async function postTraces(port: number, payload: unknown): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${port}/v1/traces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  expect(res.status).toBe(200);
}

interface QueryBody {
  query?: string;
  window?: { start: number; end: number };
  limit?: number;
  cursor?: string;
}

async function query(port: number, body: QueryBody) {
  const res = await fetch(`http://127.0.0.1:${port}/api/query/traces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as QueryResponse };
}

interface QueryResponse {
  traces?: Array<{ traceId: string; service: string; duration: number }>;
  nextCursor?: string | null;
  errors?: Array<{ message: string; range: { from: number; to: number } }>;
}

/** Seed three traces spanning two services, one of them slow and failing. */
async function seed(port: number) {
  const now = Date.now();
  await postTraces(
    port,
    otlpSpan({
      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
      spanId: '1111111111111111',
      name: 'GET /users',
      service: 'api',
      startMs: now - 3000,
      durationMs: 20,
    }),
  );
  await postTraces(
    port,
    otlpSpan({
      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2',
      spanId: '2222222222222222',
      name: 'POST /orders',
      service: 'api',
      startMs: now - 2000,
      durationMs: 900,
      status: 2,
      attributes: [
        { key: 'http.status_code', value: { intValue: 500 } },
        { key: 'user.id', value: { stringValue: 'u-42' } },
      ],
    }),
  );
  await postTraces(
    port,
    otlpSpan({
      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3',
      spanId: '3333333333333333',
      name: 'job.run',
      service: 'worker',
      startMs: now - 1000,
      durationMs: 30,
    }),
  );
  return now;
}

describe('POST /api/query/traces', () => {
  it('returns every ingested trace for an empty query', async () => {
    const port = await start();
    await seed(port);

    const { status, body } = await query(port, { query: '' });
    expect(status).toBe(200);
    expect(body.traces).toHaveLength(3);
  });

  it('filters by service', async () => {
    const port = await start();
    await seed(port);

    const { body } = await query(port, { query: 'service = worker' });
    expect(body.traces?.map((t) => t.service)).toEqual(['worker']);
  });

  it('filters by an attribute that was never declared as a column', async () => {
    const port = await start();
    await seed(port);

    const { body } = await query(port, { query: 'user.id = "u-42"' });
    expect(body.traces).toHaveLength(1);
    expect(body.traces?.[0].duration).toBeGreaterThan(500);
  });

  it('filters by duration', async () => {
    const port = await start();
    await seed(port);

    const { body } = await query(port, { query: 'duration > 500' });
    expect(body.traces).toHaveLength(1);
  });

  it('combines a text match with a comparison', async () => {
    const port = await start();
    await seed(port);

    const { body } = await query(port, {
      query: 'name CONTAINS orders AND duration > 100',
    });
    expect(body.traces).toHaveLength(1);
  });

  it('honours a time window', async () => {
    const port = await start();
    const now = await seed(port);

    const { body } = await query(port, {
      query: '',
      window: { start: now - 1500, end: now },
    });
    expect(body.traces).toHaveLength(1);
    expect(body.traces?.[0].service).toBe('worker');
  });

  it('pages with a cursor', async () => {
    const port = await start();
    await seed(port);

    const first = await query(port, { query: '', limit: 2 });
    expect(first.body.traces).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await query(port, {
      query: '',
      limit: 2,
      cursor: first.body.nextCursor ?? undefined,
    });
    expect(second.body.traces).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
  });

  it('reports a malformed query as 400 with positioned errors, not a 500', async () => {
    const port = await start();
    await seed(port);

    const { status, body } = await query(port, { query: 'service =' });
    expect(status).toBe(400);
    expect(body.errors?.length).toBeGreaterThan(0);
    expect(body.errors?.[0]).toHaveProperty('range.from');
  });

  it('does not execute injected SQL', async () => {
    const port = await start();
    await seed(port);

    const { body } = await query(port, {
      query: `service = "api'; DROP TABLE spans; --"`,
    });
    expect(body.traces).toEqual([]);

    // Everything must still be queryable afterwards.
    const after = await query(port, { query: '' });
    expect(after.body.traces).toHaveLength(3);
  });

  it('rejects a cross-origin query, like the other sensitive routes', async () => {
    const port = await start();
    await seed(port);

    const res = await fetch(`http://127.0.0.1:${port}/api/query/traces`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://evil.example.com',
      },
      body: JSON.stringify({ query: '' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/query/attributes?key=&pair= — experiment cohorts', () => {
  it('pairs each arm with its own experiment, so the viewer can offer them', async () => {
    const port = await start();
    const arm = (name: string, variant: string, spanId: string) =>
      otlpSpan({
        traceId: `t-${spanId}`,
        spanId,
        name: 'checkout',
        service: 'shop',
        startMs: Date.now(),
        durationMs: 10,
        attributes: [
          { key: 'experiment.name', value: { stringValue: name } },
          { key: 'experiment.variant', value: { stringValue: variant } },
        ],
      });

    await postTraces(port, arm('checkout-pricing', 'v1', 'a'));
    await postTraces(port, arm('checkout-pricing', 'v2', 'b'));
    await postTraces(port, arm('checkout-pricing', 'v2', 'c'));
    // A second experiment, whose arm must not be offered under the first.
    await postTraces(port, arm('search-ranking', 'reranked', 'd'));

    const res = await fetch(
      `http://127.0.0.1:${port}/api/query/attributes?key=experiment.name&pair=experiment.variant`,
    );
    const body = (await res.json()) as {
      pairs: Array<{ value: unknown; paired: unknown; count: number }>;
    };

    expect(res.status).toBe(200);
    expect(body.pairs).toEqual([
      { value: 'checkout-pricing', paired: 'v2', count: 2 },
      { value: 'checkout-pricing', paired: 'v1', count: 1 },
      { value: 'search-ranking', paired: 'reranked', count: 1 },
    ]);
  });

  it('answers the every-other-arm query the picker generates', async () => {
    const port = await start();
    const arm = (name: string, variant: string, spanId: string) =>
      otlpSpan({
        traceId: `t-${spanId}`,
        spanId,
        name: 'checkout',
        service: 'shop',
        startMs: Date.now(),
        durationMs: 10,
        attributes: [
          { key: 'experiment.name', value: { stringValue: name } },
          { key: 'experiment.variant', value: { stringValue: variant } },
        ],
      });

    await postTraces(port, arm('checkout-pricing', 'v1', 'a'));
    await postTraces(port, arm('checkout-pricing', 'v2', 'b'));
    await postTraces(port, arm('checkout-pricing', 'v3', 'c'));
    await postTraces(port, arm('search-ranking', 'v2', 'd'));

    // The baseline the picker writes when you leave the second side alone. It
    // has to exclude the arm under investigation and stay inside its own
    // experiment, or the contrast it measures is against itself.
    const { body } = await query(port, {
      query:
        'experiment.name = "checkout-pricing" AND experiment.variant != "v1"',
    });

    expect(body.traces?.map((t) => t.traceId).sort()).toEqual(['t-b', 't-c']);
  });

  it('still searches by value when no pair is asked for', async () => {
    const port = await start();
    await seed(port);

    const res = await fetch(
      `http://127.0.0.1:${port}/api/query/attributes?value=u-42`,
    );
    const body = (await res.json()) as {
      attributes: Array<{ key: string; value: unknown }>;
    };

    expect(res.status).toBe(200);
    expect(body.attributes).toContainEqual(
      expect.objectContaining({ key: 'user.id', value: 'u-42' }),
    );
  });
});
