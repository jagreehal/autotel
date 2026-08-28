/**
 * Wire contract for the log query endpoint.
 *
 * Posts OTLP logs the way an SDK does and queries them back the way the Logs
 * tab will. The severity cases are the ones worth having end-to-end: OTLP sends
 * severity as a number and a text, and "error and above" is only expressible
 * against the number — so both have to survive ingest as separate columns.
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

const T0 = Date.now() - 60_000;
const nano = (ms: number) => String(BigInt(Math.round(ms)) * 1_000_000n);

async function postLogs(port: number, records: unknown[], service = 'api') {
  const res = await fetch(`http://127.0.0.1:${port}/v1/logs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: service } },
            ],
          },
          scopeLogs: [{ scope: {}, logRecords: records }],
        },
      ],
    }),
  });
  expect(res.status).toBe(200);
}

interface LogsResponse {
  logs?: Array<{
    body: unknown;
    severityText?: string;
    severityNumber?: number;
    traceId?: string;
  }>;
  nextCursor?: string | null;
  errors?: Array<{ message: string }>;
}

async function query(port: number, body: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}/api/query/logs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as LogsResponse };
}

async function seed(port: number) {
  await postLogs(port, [
    {
      timeUnixNano: nano(T0 + 1000),
      severityText: 'INFO',
      severityNumber: 9,
      body: { stringValue: 'user signed in' },
      attributes: [{ key: 'user.id', value: { stringValue: 'u1' } }],
    },
    {
      timeUnixNano: nano(T0 + 2000),
      severityText: 'ERROR',
      severityNumber: 17,
      body: { stringValue: 'payment failed' },
      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
    },
  ]);
  await postLogs(
    port,
    [
      {
        timeUnixNano: nano(T0 + 3000),
        severityText: 'DEBUG',
        severityNumber: 5,
        body: { stringValue: 'job queued' },
      },
    ],
    'worker',
  );
}

describe('POST /api/query/logs', () => {
  it('returns every ingested log for an empty query', async () => {
    const port = await start();
    await seed(port);
    const { body } = await query(port, { query: '' });
    expect(body.logs).toHaveLength(3);
  });

  it('filters by severity text', async () => {
    const port = await start();
    await seed(port);
    const { body } = await query(port, { query: 'severity = ERROR' });
    expect(body.logs).toHaveLength(1);
  });

  it('filters by numeric severity for "error and above"', async () => {
    // The text column cannot express this ordering; the numeric one can.
    const port = await start();
    await seed(port);
    const { body } = await query(port, { query: 'severity_number >= 17' });
    expect(body.logs?.map((l) => l.severityText)).toEqual(['ERROR']);
  });

  it('filters by service', async () => {
    const port = await start();
    await seed(port);
    const { body } = await query(port, { query: 'service = worker' });
    expect(body.logs).toHaveLength(1);
  });

  it('filters by a log attribute', async () => {
    const port = await start();
    await seed(port);
    const { body } = await query(port, { query: 'user.id = u1' });
    expect(body.logs).toHaveLength(1);
  });

  it('matches free text in the body', async () => {
    const port = await start();
    await seed(port);
    const { body } = await query(port, { query: 'payment' });
    expect(body.logs).toHaveLength(1);
  });

  it('finds the logs belonging to one trace', async () => {
    const port = await start();
    await seed(port);
    const { body } = await query(port, {
      query: 'trace_id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1"',
    });
    expect(body.logs).toHaveLength(1);
  });

  it('pages with a cursor', async () => {
    const port = await start();
    await seed(port);
    const first = await query(port, { query: '', limit: 2 });
    expect(first.body.logs).toHaveLength(2);

    const second = await query(port, {
      query: '',
      limit: 2,
      cursor: first.body.nextCursor ?? undefined,
    });
    expect(second.body.logs).toHaveLength(1);
  });

  it('reports a malformed query as 400 with positioned errors', async () => {
    const port = await start();
    const { status, body } = await query(port, { query: 'service =' });
    expect(status).toBe(400);
    expect(body.errors?.length).toBeGreaterThan(0);
  });

  it('rejects a cross-origin query', async () => {
    const port = await start();
    const res = await fetch(`http://127.0.0.1:${port}/api/query/logs`, {
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
