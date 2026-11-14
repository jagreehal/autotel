import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { DevtoolsServer } from '../server/server';
import { attachDevtoolsRoutes } from '../server/http';
import { clearTraces, findSpans, matchesSpan, waitForSpan, type SpanData } from './index';

const TRACE = 'a'.repeat(32);

function payload(traceId: string, name: string, service = 'orders') {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: service } },
          ],
        },
        scopeSpans: [
          {
            spans: [
              {
                traceId,
                spanId: `${name.length}`.padStart(16, '1'),
                name,
                kind: 2,
                startTimeUnixNano: '1000000000',
                endTimeUnixNano: '2000000000',
                attributes: [
                  { key: 'db.system', value: { stringValue: 'postgresql' } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('autotel-devtools/testing', () => {
  let server: Server | null = null;
  let devtools: DevtoolsServer | null = null;

  afterEach(async () => {
    if (devtools) await devtools.close();
    server = null;
    devtools = null;
  });

  async function start(): Promise<string> {
    const port = await new Promise<number>((resolve) => {
      server = createServer();
      devtools = new DevtoolsServer({ server });
      attachDevtoolsRoutes(server, devtools);
      server.listen(0, '127.0.0.1', () =>
        resolve((server!.address() as { port: number }).port),
      );
    });
    return `http://127.0.0.1:${port}`;
  }

  function send(endpoint: string, body: unknown) {
    return fetch(`${endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('waits for a span another process exports later', async () => {
    const endpoint = await start();
    setTimeout(() => void send(endpoint, payload(TRACE, 'INSERT orders')), 150);
    const span = await waitForSpan(
      {
        traceId: TRACE,
        service: 'orders',
        name: /INSERT/,
        attributes: { 'db.system': 'postgresql' },
      },
      { endpoint, intervalMs: 20 },
    );
    expect(span.name).toBe('INSERT orders');
  });

  it('times out naming what the trace received instead', async () => {
    const endpoint = await start();
    await send(endpoint, payload(TRACE, 'SELECT orders'));
    await expect(
      waitForSpan(
        { traceId: TRACE, name: 'INSERT orders' },
        { endpoint, timeoutMs: 50, intervalMs: 10 },
      ),
    ).rejects.toThrow(/received 1 span\(s\):\n {2}orders: SELECT orders/);
  });

  it('points at a dropped traceparent when only other traces arrived', async () => {
    const endpoint = await start();
    await send(endpoint, payload('b'.repeat(32), 'INSERT orders'));
    await expect(
      waitForSpan(
        { traceId: TRACE, name: 'INSERT orders' },
        { endpoint, timeoutMs: 20, intervalMs: 10 },
      ),
    ).rejects.toThrow(/did a hop drop traceparent\?/);
  });

  it('clears between tests', async () => {
    const endpoint = await start();
    await send(endpoint, payload(TRACE, 'x'));
    expect(await findSpans({ traceId: TRACE }, { endpoint })).toHaveLength(1);
    await clearTraces({ endpoint });
    expect(await findSpans({}, { endpoint })).toHaveLength(0);
  });

  it('gives up at the deadline when the receiver never answers', async () => {
    const stalled = createServer(() => {
      // Accepts the request and never responds.
    });
    const port = await new Promise<number>((resolve) =>
      stalled.listen(0, '127.0.0.1', () =>
        resolve((stalled.address() as { port: number }).port),
      ),
    );
    const started = Date.now();
    try {
      await expect(
        waitForSpan(
          { name: 'x' },
          { endpoint: `http://127.0.0.1:${port}`, timeoutMs: 200 },
        ),
      ).rejects.toThrow(/did not answer within the deadline/);
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      stalled.closeAllConnections();
      await new Promise<void>((r) => stalled.close(() => r()));
    }
  });
});

describe('cancellation', () => {
  let server: Server | null = null;
  let devtools: DevtoolsServer | null = null;

  afterEach(async () => {
    if (devtools) await devtools.close();
    server = null;
    devtools = null;
  });

  async function start(): Promise<string> {
    const port = await new Promise<number>((resolve) => {
      server = createServer();
      devtools = new DevtoolsServer({ server });
      attachDevtoolsRoutes(server, devtools);
      server.listen(0, '127.0.0.1', () =>
        resolve((server!.address() as { port: number }).port),
      );
    });
    return `http://127.0.0.1:${port}`;
  }

  it("rejects with the caller's reason when the signal is already aborted", async () => {
    const endpoint = await start();
    const reason = new Error('test cancelled');
    const signal = AbortSignal.abort(reason);
    await expect(waitForSpan({ name: 'x' }, { endpoint, signal })).rejects.toBe(reason);
    await expect(clearTraces({ endpoint, signal })).rejects.toBe(reason);
  });

  it('stops waiting between polls as soon as the caller aborts', async () => {
    const endpoint = await start();
    const controller = new AbortController();
    const reason = new Error('stop');
    setTimeout(() => controller.abort(reason), 50);
    const started = Date.now();
    await expect(
      waitForSpan(
        { name: 'never' },
        { endpoint, signal: controller.signal, timeoutMs: 5000, intervalMs: 1000 },
      ),
    ).rejects.toBe(reason);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('leaves the receiver untouched when clearTraces is cancelled', async () => {
    const endpoint = await start();
    await fetch(`${endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload(TRACE, 'kept')),
    });
    await expect(
      clearTraces({ endpoint, signal: AbortSignal.abort(new Error('no')) }),
    ).rejects.toThrow('no');
    expect(await findSpans({ traceId: TRACE }, { endpoint })).toHaveLength(1);
  });
});

describe('matchesSpan', () => {
  const span = {
    traceId: 'a'.repeat(32),
    spanId: '1'.repeat(16),
    name: 'INSERT orders',
    attributes: { 'db.tables': ['orders', 'lines'] },
  } as unknown as SpanData;

  it('matches with a global regex every time, not every other time', () => {
    const name = /INSERT/g;
    expect([1, 2, 3].map(() => matchesSpan(span, { name }))).toEqual([true, true, true]);
  });

  it('matches array attributes by their entries', () => {
    expect(matchesSpan(span, { attributes: { 'db.tables': ['orders', 'lines'] } })).toBe(true);
    expect(matchesSpan(span, { attributes: { 'db.tables': ['orders'] } })).toBe(false);
  });
});
