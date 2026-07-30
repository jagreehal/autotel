import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { autotelMiddleware, useLogger } from './hono';

describe('hono adapter', () => {
  it('assigns the observed streaming response and emits after the body closes', async () => {
    const onEmit = vi.fn();
    let streamController: ReadableStreamDefaultController<Uint8Array>;
    let requestLog: ReturnType<typeof useLogger>;
    const app = new Hono();
    app.use('*', autotelMiddleware({ requestLoggerOptions: { onEmit } }));
    app.get('/stream', (c) => {
      requestLog = useLogger(c);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
        },
      });
      return new Response(body, {
        headers: { 'content-type': 'text/event-stream' },
      });
    });

    const response = await app.request('/stream');
    expect(response.body?.locked).toBe(false);
    expect(onEmit).not.toHaveBeenCalled();

    requestLog!.set({ stream: { chunks: 1 } });
    streamController!.enqueue(new TextEncoder().encode('data: one\n\n'));
    streamController!.close();
    await response.text();
    await new Promise((resolve) => setImmediate(resolve));

    expect(onEmit).toHaveBeenCalledTimes(1);
    expect(onEmit.mock.calls[0]?.[0].context).toMatchObject({
      stream: { chunks: 1 },
      'http.response.status_code': 200,
    });
  });
});
