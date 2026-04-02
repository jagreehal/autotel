import { describe, it, expect, afterEach } from 'vitest';
import { DevtoolsServer } from '../server';
import { makeTrace, makeSpan } from './test-utils/stubs';
import WebSocket from 'ws';

describe('DevtoolsServer', () => {
  let server: DevtoolsServer | null = null;

  afterEach(async () => {
    if (server) await server.close();
    server = null;
  });

  describe('WebSocket connections', () => {
    it('starts and accepts WebSocket connections', async () => {
      server = new DevtoolsServer({ port: 0 });
      await new Promise((r) => setTimeout(r, 100));
      const port = server!.port;

      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      await new Promise<void>((resolve) => ws.on('open', resolve));

      expect(server!.clientCount).toBe(1);
      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });

    it('broadcasts trace data to connected clients', async () => {
      server = new DevtoolsServer({ port: 0 });
      await new Promise((r) => setTimeout(r, 100));
      const port = server!.port;

      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      await new Promise<void>((resolve) => ws.on('open', resolve));

      const messagePromise = new Promise<any>((resolve) => {
        ws.on('message', (data) => resolve(JSON.parse(data.toString())));
      });

      server!.addTrace(makeTrace({ traceId: 't1' }));

      const msg = await messagePromise;
      expect(msg.traces).toHaveLength(1);
      expect(msg.traces[0].traceId).toBe('t1');

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });

    it('sends history to late-connecting clients', async () => {
      server = new DevtoolsServer({ port: 0 });
      await new Promise((r) => setTimeout(r, 100));
      server!.addTrace(makeTrace({ traceId: 't1' }));

      const port = server!.port;
      const ws = new WebSocket(`ws://localhost:${port}/ws`);

      const messagePromise = new Promise<any>((resolve) => {
        ws.on('message', (data) => resolve(JSON.parse(data.toString())));
      });

      await new Promise<void>((resolve) => ws.on('open', resolve));

      const msg = await messagePromise;
      expect(msg.traces).toHaveLength(1);

      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });
  });

  describe('trace management', () => {
    it('merges out-of-order spans into existing traces', async () => {
      server = new DevtoolsServer({ port: 0 });
      await new Promise((r) => setTimeout(r, 100));

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

    it('updates trace status when error spans are added', async () => {
      server = new DevtoolsServer({ port: 0 });
      await new Promise((r) => setTimeout(r, 100));

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
