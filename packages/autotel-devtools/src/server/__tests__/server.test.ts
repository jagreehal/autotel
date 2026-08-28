import { describe, it, expect, afterEach, vi } from 'vitest';
import { DevtoolsServer } from '../server';
import { makeTrace, makeSpan, makeErrorTrace } from './test-utils/stubs';
import WebSocket from 'ws';

describe('DevtoolsServer', () => {
  let server: DevtoolsServer | null = null;

  afterEach(async () => {
    if (server) await server.close();
    server = null;
  });

  describe('binding', () => {
    it('binds the host it was given rather than every interface', async () => {
      server = new DevtoolsServer({ port: 0, host: '127.0.0.1' });
      await vi.waitFor(() => expect(server!.port).toBeGreaterThan(0));

      // A caller who says `127.0.0.1` and gets a wildcard bind has published
      // their captured telemetry to the network without being told.
      const address = (
        server as unknown as {
          httpServer: { address(): { address: string } | null };
        }
      ).httpServer.address();
      expect(address?.address).toBe('127.0.0.1');
    });
  });

  describe('WebSocket connections', () => {
    it('starts and accepts WebSocket connections', async () => {
      server = new DevtoolsServer({ port: 0, host: '127.0.0.1' });
      // The bind is what we are waiting for, so wait for the bind: a fixed
      // delay is a guess about a machine under load.
      await vi.waitFor(() => expect(server!.port).toBeGreaterThan(0));
      const port = server!.port;

      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      await new Promise<void>((resolve) => ws.on('open', resolve));

      expect(server!.clientCount).toBe(1);
      ws.close();
    });

    it('rejects a live-stream subscription from a remote origin', async () => {
      server = new DevtoolsServer({ port: 0, host: '127.0.0.1' });
      // The bind is what we are waiting for, so wait for the bind: a fixed
      // delay is a guess about a machine under load.
      await vi.waitFor(() => expect(server!.port).toBeGreaterThan(0));
      const port = server!.port;

      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        origin: 'https://evil.com',
      });
      const rejected = await new Promise<boolean>((resolve) => {
        ws.on('open', () => resolve(false));
        ws.on('error', () => resolve(true));
        ws.on('unexpected-response', () => resolve(true));
      });

      expect(rejected).toBe(true);
      expect(server!.clientCount).toBe(0);
    });

    it('allows a live-stream subscription from a loopback origin', async () => {
      server = new DevtoolsServer({ port: 0, host: '127.0.0.1' });
      // The bind is what we are waiting for, so wait for the bind: a fixed
      // delay is a guess about a machine under load.
      await vi.waitFor(() => expect(server!.port).toBeGreaterThan(0));
      const port = server!.port;

      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        origin: 'http://localhost:3000',
      });
      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });

      expect(server!.clientCount).toBe(1);
      ws.close();
    });

    it('broadcasts trace data to connected clients', async () => {
      server = new DevtoolsServer({ port: 0, host: '127.0.0.1' });
      // The bind is what we are waiting for, so wait for the bind: a fixed
      // delay is a guess about a machine under load.
      await vi.waitFor(() => expect(server!.port).toBeGreaterThan(0));
      const port = server!.port;

      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      await new Promise<void>((resolve) => ws.on('open', resolve));

      const messagePromise = new Promise<any>((resolve) => {
        ws.on('message', (data) => resolve(JSON.parse(data.toString())));
      });

      server!.addTrace(makeTrace({ traceId: 't1' }));

      const msg = await messagePromise;
      expect(msg.traces).toHaveLength(1);
      expect(msg.traces[0].traceId).toBe('t1');

      ws.close();
    });

    it('sends history to late-connecting clients', async () => {
      server = new DevtoolsServer({ port: 0, host: '127.0.0.1' });
      await vi.waitFor(() => expect(server!.port).toBeGreaterThan(0));
      server!.addTrace(makeTrace({ traceId: 't1' }));

      const port = server!.port;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

      const messagePromise = new Promise<any>((resolve) => {
        ws.on('message', (data) => resolve(JSON.parse(data.toString())));
      });

      await new Promise<void>((resolve) => ws.on('open', resolve));

      const msg = await messagePromise;
      expect(msg.traces).toHaveLength(1);

      ws.close();
    });
  });

  describe('onData hook', () => {
    it('invokes onData with each ingest after broadcast', async () => {
      const seen: string[] = [];
      server = new DevtoolsServer({
        port: 0,
        onData: (d) => seen.push(...d.traces.map((t) => t.traceId)),
      });

      server!.addTrace(makeTrace({ traceId: 't1' }));
      server!.addTrace(makeTrace({ traceId: 't2' }));

      expect(seen).toEqual(['t1', 't2']);
    });

    it('keeps ingesting when an onData listener throws', async () => {
      server = new DevtoolsServer({
        port: 0,
        onData: () => {
          throw new Error('listener boom');
        },
      });

      expect(() =>
        server!.addTrace(makeTrace({ traceId: 't1' })),
      ).not.toThrow();
      expect(server!.getCurrentData().traces).toHaveLength(1);
    });
  });

  describe('trace management', () => {
    it('does not count a replayed error span twice', async () => {
      server = new DevtoolsServer({ port: 0, host: '127.0.0.1' });
      await vi.waitFor(() => expect(server!.port).toBeGreaterThan(0));
      const failed = makeErrorTrace('failed', 'boom');

      server.addTrace(failed);
      server.addTrace(failed);

      expect(server.getCurrentData().errors[0]?.count).toBe(1);
    });

    it('merges out-of-order spans into existing traces', async () => {
      server = new DevtoolsServer({ port: 0, host: '127.0.0.1' });
      await vi.waitFor(() => expect(server!.port).toBeGreaterThan(0));

      const traceId = 'trace1';

      server!.addTrace(
        makeTrace({
          traceId,
          spans: [makeSpan({ traceId, spanId: 'span1', name: 'root' })],
        }),
      );

      server!.addTrace(
        makeTrace({
          traceId,
          spans: [
            makeSpan({
              traceId,
              spanId: 'span2',
              name: 'child',
              parentSpanId: 'span1',
            }),
          ],
        }),
      );

      const data = server!.getCurrentData();
      expect(data.traces).toHaveLength(1);
      expect(data.traces[0].spans).toHaveLength(2);
    });

    it('recovers the root span when a downstream batch arrives first', async () => {
      server = new DevtoolsServer({ port: 0, host: '127.0.0.1' });
      await vi.waitFor(() => expect(server!.port).toBeGreaterThan(0));

      const traceId = 'trace-root-recovery';

      // A downstream service exports its (child) span before the root service.
      // The batch looks like a fragment on arrival, so it is flagged partial.
      server!.addTrace(
        makeTrace({
          traceId,
          service: 'shop-auth',
          partial: true,
          rootSpan: makeSpan({
            traceId,
            spanId: 'auth',
            name: 'POST /validate',
            parentSpanId: 'api',
          }),
          spans: [
            makeSpan({
              traceId,
              spanId: 'auth',
              name: 'POST /validate',
              parentSpanId: 'api',
            }),
          ],
        }),
      );

      // The parentless root span lands in a later batch.
      server!.addTrace(
        makeTrace({
          traceId,
          service: 'shop-api',
          rootSpan: makeSpan({
            traceId,
            spanId: 'api',
            name: 'POST /api/checkout',
            attributes: { 'service.name': 'shop-api' },
          }),
          spans: [
            makeSpan({
              traceId,
              spanId: 'api',
              name: 'POST /api/checkout',
              attributes: { 'service.name': 'shop-api' },
            }),
          ],
        }),
      );

      const data = server!.getCurrentData();
      expect(data.traces[0].spans).toHaveLength(2);
      expect(data.traces[0].rootSpan.spanId).toBe('api');
      expect(data.traces[0].service).toBe('shop-api');
      // The trace is whole once the root lands: partial must clear, or every
      // complete trace whose children arrive first stays mislabelled forever.
      expect(data.traces[0].partial).toBeUndefined();
    });

    it('keeps a merged trace partial while its root is still missing', async () => {
      server = new DevtoolsServer({ port: 0, host: '127.0.0.1' });
      await vi.waitFor(() => expect(server!.port).toBeGreaterThan(0));

      const traceId = 'trace-still-partial';
      const fragment = (spanId: string, parentSpanId: string) =>
        makeTrace({
          traceId,
          partial: true,
          rootSpan: makeSpan({ traceId, spanId, parentSpanId }),
          spans: [makeSpan({ traceId, spanId, parentSpanId })],
        });

      // Two sampled children of a parent that was dropped.
      server!.addTrace(fragment('child-a', 'dropped'));
      server!.addTrace(fragment('child-b', 'dropped'));

      const data = server!.getCurrentData();
      expect(data.traces[0].spans).toHaveLength(2);
      expect(data.traces[0].partial).toBe(true);
    });

    it('updates trace status when error spans are added', async () => {
      server = new DevtoolsServer({ port: 0, host: '127.0.0.1' });
      await vi.waitFor(() => expect(server!.port).toBeGreaterThan(0));

      const traceId = 'trace1';

      server!.addTrace(
        makeTrace({
          traceId,
          status: 'OK',
          spans: [makeSpan({ traceId, spanId: 'span1', name: 'root' })],
        }),
      );

      server!.addTrace(
        makeTrace({
          traceId,
          status: 'ERROR',
          spans: [
            makeSpan({
              traceId,
              spanId: 'span2',
              name: 'child',
              status: { code: 'ERROR', message: 'failed' },
            }),
          ],
        }),
      );

      const data = server!.getCurrentData();
      expect(data.traces[0].status).toBe('ERROR');
    });
  });
});
