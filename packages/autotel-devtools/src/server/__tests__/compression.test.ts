/**
 * Compression on the read surface.
 *
 * A trace payload is mostly repeated keys and near-identical strings, which is
 * the shape gzip is best at. Measured on a 4,891-span trace: 2,078 KiB raw
 * against 41 KiB gzipped. The seam is the HTTP response, so these tests assert
 * what a browser actually receives.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { WebSocket } from 'ws';
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

/** One trace of `spanCount` spans, shaped the way an SDK sends it. */
function otlpTrace(spanCount: number) {
  const base = BigInt(Date.now() - 60_000) * 1_000_000n;
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'checkout-api' } },
          ],
        },
        scopeSpans: [
          {
            scope: {
              name: '@opentelemetry/instrumentation-http',
              version: '0.57.0',
            },
            spans: Array.from({ length: spanCount }, (_, i) => ({
              traceId: 'aa'.repeat(16),
              spanId: i.toString(16).padStart(16, '0'),
              parentSpanId: i === 0 ? undefined : '0'.repeat(16),
              name: `operation-${i % 20}`,
              kind: 2,
              startTimeUnixNano: (base + BigInt(i)).toString(),
              endTimeUnixNano: (base + BigInt(i) + 12_000_000n).toString(),
              status: { code: 1 },
              attributes: [
                { key: 'http.request.method', value: { stringValue: 'GET' } },
                { key: 'url.path', value: { stringValue: '/api/checkout' } },
              ],
            })),
          },
        ],
      },
    ],
  };
}

async function ingest(port: number, spanCount: number): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${port}/v1/traces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(otlpTrace(spanCount)),
  });
  expect(res.status).toBe(200);
}

/**
 * A raw request, because `fetch` decompresses transparently and so cannot see
 * what actually crossed the socket, which is the entire point here.
 */
function post(
  port: number,
  path: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string>,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('read-surface compression', () => {
  it('gzips a query response for a client that accepts it', async () => {
    const port = await start();
    await ingest(port, 500);

    const res = await post(
      port,
      '/api/query/traces',
      JSON.stringify({ query: '' }),
      {
        'accept-encoding': 'gzip',
      },
    );

    expect(res.headers['content-encoding']).toBe('gzip');
    const decoded = JSON.parse(gunzipSync(res.body).toString('utf8'));
    expect(decoded.traces[0].spans).toHaveLength(500);
    // The saving is the reason the branch exists, so pin it.
    expect(res.body.byteLength * 5).toBeLessThan(
      Buffer.byteLength(JSON.stringify(decoded), 'utf8'),
    );
  });

  it('sends plain JSON to a client that does not accept gzip', async () => {
    const port = await start();
    await ingest(port, 500);

    const res = await post(
      port,
      '/api/query/traces',
      JSON.stringify({ query: '' }),
      {
        'accept-encoding': 'identity',
      },
    );

    expect(res.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(res.body.toString('utf8')).traces[0].spans).toHaveLength(
      500,
    );
  });

  it('leaves a small response alone, where gzip would only add overhead', async () => {
    const port = await start();

    const res = await post(
      port,
      '/api/query/traces',
      JSON.stringify({ query: '' }),
      {
        'accept-encoding': 'gzip',
      },
    );

    expect(res.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(res.body.toString('utf8')).traces).toEqual([]);
  });
});

describe('live-tail compression', () => {
  it('negotiates permessage-deflate, so streamed traces are compressed too', async () => {
    const port = await start();

    const extensions = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        perMessageDeflate: true,
      });
      ws.on('open', () => {
        const negotiated = String(ws.extensions);
        ws.close();
        resolve(negotiated);
      });
      ws.on('error', reject);
    });

    expect(extensions).toContain('permessage-deflate');
  });
});

describe('trace payload shape', () => {
  // The rule: the server answers in full and streams compact. Anything you can
  // curl carries a whole span, so no HTTP consumer has to know a codec exists.
  it('answers a query with complete spans', async () => {
    const port = await start();
    await ingest(port, 5);

    const res = await post(
      port,
      '/api/query/traces',
      JSON.stringify({ query: '' }),
      { 'accept-encoding': 'identity' },
    );

    const trace = JSON.parse(res.body.toString('utf8')).traces[0];
    expect(trace.endTime).toBeGreaterThan(0);
    expect(trace.spans.every((s: { endTime: number }) => s.endTime > 0)).toBe(
      true,
    );
  });

  it('answers the /v1/traces read-back with complete spans', async () => {
    const port = await start();
    await ingest(port, 5);

    const body = await (
      await fetch(`http://127.0.0.1:${port}/v1/traces`)
    ).json();

    expect(body.traces[0].spans[0].endTime).toBeGreaterThan(0);
  });

  it('omits it from the live tail too', async () => {
    const port = await start();

    const message = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        perMessageDeflate: false,
      });
      ws.on('open', () => void ingest(port, 5));
      ws.on('message', (raw: Buffer) => {
        const text = raw.toString('utf8');
        // The first frame is the history replay, which is empty here.
        if (!text.includes('"spans"')) return;
        ws.close();
        resolve(text);
      });
      ws.on('error', reject);
    });

    expect(message).toContain('"duration"');
    expect(message).not.toContain('endTime');
  });
});
