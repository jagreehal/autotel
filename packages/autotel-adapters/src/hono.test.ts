import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { SpanStatusCode } from 'autotel';
import { createTraceCollector } from 'autotel/testing';
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

  it('records the matched template as http.route and names the span after it', async () => {
    const collector = createTraceCollector();
    const onEmit = vi.fn();
    const app = new Hono();
    app.use('*', autotelMiddleware({ requestLoggerOptions: { onEmit } }));
    app.get('/api/v1/client/:id', (c) => c.text('ok'));

    await app.request('/api/v1/client/abc123secretid');
    await app.request('/missing');

    expect(onEmit.mock.calls[0]?.[0].context).toMatchObject({
      'http.route': '/api/v1/client/:id',
      'url.path': '/api/v1/client/abc123secretid',
    });
    expect(collector.expectSpan('GET /api/v1/client/:id')).toBeDefined();

    expect(onEmit.mock.calls[1]?.[0].context['http.route']).toBe('/*');
    expect(collector.expectSpan('GET /*')).toBeDefined();
  });

  it('uses mounted templates and preserves an explicit span name', async () => {
    const collector = createTraceCollector();
    const onEmit = vi.fn();
    const app = new Hono();
    const clients = new Hono();
    app.use(
      '*',
      autotelMiddleware({
        spanName: 'clients.request',
        requestLoggerOptions: { onEmit },
      }),
    );
    clients.get('/:id', (c) => {
      useLogger(c).set({ 'http.route': c.req.path });
      return c.text('ok');
    });
    app.route('/clients', clients);

    await app.request('/clients/secret-one');
    await app.request('/clients/secret-two');

    expect(onEmit).toHaveBeenCalledTimes(2);
    for (const [line] of onEmit.mock.calls) {
      expect(line.context['http.route']).toBe('/clients/:id');
    }
    expect(collector.getSpans().map((span) => span.name)).toEqual([
      'clients.request',
      'clients.request',
    ]);
  });

  it('keeps the endpoint template when middleware is registered at the same path', async () => {
    const onEmit = vi.fn();
    const app = new Hono();
    app.use(
      '/users/:id',
      autotelMiddleware({ requestLoggerOptions: { onEmit } }),
    );
    app.use('/users/:id', async (_c, next) => next());
    app.get('/users/:id', (c) => c.text('ok'));
    app.use(
      '/admin/*',
      autotelMiddleware({ requestLoggerOptions: { onEmit } }),
    );
    app.use('/admin/*', async (c) => c.text('no', 401));
    app.get('/admin/users/:id', (c) => c.text('ok'));

    await app.request('/users/42');
    await app.request('/admin/users/7');

    expect(onEmit.mock.calls[0]?.[0].context['http.route']).toBe('/users/:id');
    expect(onEmit.mock.calls[1]?.[0].context['http.route']).toBe(
      '/admin/users/:id',
    );
  });

  it('keeps the endpoint template when a catch-all is registered after it', async () => {
    const collector = createTraceCollector();
    const onEmit = vi.fn();
    const app = new Hono();
    app.use('*', autotelMiddleware({ requestLoggerOptions: { onEmit } }));
    app.get('/users/:id', (c) => c.text('ok'));
    app.get('/api/*', (c) => c.text('api fallback', 404));
    app.get('*', (c) => c.text('spa'));

    await app.request('/users/42');
    await app.request('/somewhere');

    expect(onEmit.mock.calls[0]?.[0].context['http.route']).toBe('/users/:id');
    expect(onEmit.mock.calls[1]?.[0].context['http.route']).toBe('/*');
    expect(collector.expectSpan('GET /users/:id')).toBeDefined();
  });

  it('records an all() endpoint, whatever its handler takes', async () => {
    const onEmit = vi.fn();
    const app = new Hono();
    app.use('*', autotelMiddleware({ requestLoggerOptions: { onEmit } }));
    app.all('/users/:id', async (c, _next) => c.text('ok'));

    const response = await app.request('/users/42');
    await app.request('/nowhere');

    expect(response.status).toBe(200);
    expect(onEmit.mock.calls[0]?.[0].context['http.route']).toBe('/users/:id');
    expect(onEmit.mock.calls[1]?.[0].context['http.route']).toBe('/*');
  });

  it('keeps an all() endpoint template when it answers 404 itself', async () => {
    const collector = createTraceCollector();
    const onEmit = vi.fn();
    const app = new Hono();
    app.use('*', autotelMiddleware({ requestLoggerOptions: { onEmit } }));
    app.all('/users/:id', (c) => c.text('User not found', 404));

    const response = await app.request('/users/123');

    expect(response.status).toBe(404);
    expect(onEmit.mock.calls[0]?.[0].context['http.route']).toBe('/users/:id');
    expect(collector.expectSpan('GET /users/:id')).toBeDefined();
  });

  it('records the final match when method-specific middleware comes first', async () => {
    const collector = createTraceCollector();
    const onEmit = vi.fn();
    const app = new Hono();
    app.use('*', autotelMiddleware({ requestLoggerOptions: { onEmit } }));
    app.get('/api/*', async (_c, next) => next());
    app.all('/api/users/:id', (c) => c.text('ok'));

    const response = await app.request('/api/users/123');

    expect(response.status).toBe(200);
    expect(onEmit.mock.calls[0]?.[0].context['http.route']).toBe(
      '/api/users/:id',
    );
    expect(collector.expectSpan('GET /api/users/:id')).toBeDefined();
  });

  it('marks the span ERROR on a 5xx, thrown or returned, and leaves a 4xx unset', async () => {
    const collector = createTraceCollector();
    const app = new Hono();
    app.use('*', autotelMiddleware());
    app.get('/returns-500', (c) => c.json({ ok: false }, 500));
    app.get('/throws', () => {
      throw new Error('payment provider down');
    });
    app.get('/missing', () => {
      throw new HTTPException(404, { message: 'no such order' });
    });
    app.get('/ok', (c) => c.text('ok'));

    expect((await app.request('/returns-500')).status).toBe(500);
    expect((await app.request('/throws')).status).toBe(500);
    expect((await app.request('/missing')).status).toBe(404);
    await app.request('/ok');

    expect(collector.expectSpan('GET /returns-500').status.code).toBe(
      SpanStatusCode.ERROR,
    );
    const thrown = collector.expectSpan('GET /throws');
    expect(thrown.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: 'payment provider down',
    });
    expect(thrown.attributes['autotel.log.level']).toBe('error');
    expect(thrown.events.filter((e) => e.name === 'log.error')).toHaveLength(1);
    expect(collector.expectSpan('GET /missing').status.code).not.toBe(
      SpanStatusCode.ERROR,
    );
    expect(collector.expectSpan('GET /ok').status.code).toBe(SpanStatusCode.OK);
  });

  it('marks a streamed 5xx ERROR before the body ends', async () => {
    const collector = createTraceCollector();
    const app = new Hono();
    app.use('*', autotelMiddleware());
    app.get('/events', () => {
      const body = new ReadableStream<Uint8Array>({ start() {} });
      return new Response(body, {
        status: 500,
        headers: { 'content-type': 'text/event-stream' },
      });
    });

    const response = await app.request('/events');

    expect(response.status).toBe(500);
    expect(collector.expectSpan('GET /events').status.code).toBe(
      SpanStatusCode.ERROR,
    );
  });

  it('marks a 5xx ERROR with autoEmit off, which skips only the snapshot', async () => {
    const collector = createTraceCollector();
    const onEmit = vi.fn();
    const app = new Hono();
    app.use(
      '*',
      autotelMiddleware({ autoEmit: false, requestLoggerOptions: { onEmit } }),
    );
    app.get('/returns-500', (c) => c.json({ ok: false }, 500));
    app.get('/throws', () => {
      throw new Error('ledger unavailable');
    });

    await app.request('/returns-500');
    await app.request('/throws');

    expect(onEmit).not.toHaveBeenCalled();
    expect(collector.expectSpan('GET /returns-500').status.code).toBe(
      SpanStatusCode.ERROR,
    );
    expect(collector.expectSpan('GET /throws').status).toEqual({
      code: SpanStatusCode.ERROR,
      message: 'ledger unavailable',
    });
  });

  it('marks a thrown error ERROR even after the handler emitted the snapshot', async () => {
    const collector = createTraceCollector();
    const app = new Hono();
    app.use('*', autotelMiddleware());
    app.get('/failure', (c) => {
      useLogger(c).emitNow();
      throw new Error('provider down');
    });

    expect((await app.request('/failure')).status).toBe(500);
    expect(collector.expectSpan('GET /failure').status).toEqual({
      code: SpanStatusCode.ERROR,
      message: 'provider down',
    });
  });
});
