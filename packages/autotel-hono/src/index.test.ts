import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { stream, streamSSE } from 'hono/streaming';
import { otel } from './index';
import type { Attributes, Context, Span, SpanOptions, Tracer } from 'autotel';
import { SpanKind, propagation, context, otelTrace } from 'autotel';
import type { HttpMetricsConfig } from './metrics';

/** The span methods the middleware calls. */
type MockSpan = ReturnType<typeof createMockSpan>;

/** What the fake tracer recorded about the span it was asked to start. */
interface SpanCollector {
  span: MockSpan;
  options: SpanOptions | undefined;
  parentContext?: Context;
}

/** What the fake meter recorded. */
interface RecordCollector {
  durationRecords: Array<{ duration: number; attrs: Attributes }>;
  activeAdds: Array<{ delta: number; attrs: Attributes }>;
}

function createMockSpan() {
  return {
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    updateName: vi.fn(),
    end: vi.fn(),
  };
}

/** A fresh pair of collectors, one per test. */
function createCollectors() {
  const spanCollector: SpanCollector = {
    span: createMockSpan(),
    options: undefined,
  };
  const recordCollector: RecordCollector = {
    durationRecords: [],
    activeAdds: [],
  };
  return { spanCollector, recordCollector };
}

function createMockTracer(spanCollector: SpanCollector): Tracer {
  // SAFETY: the middleware calls startActiveSpan and nothing else on a tracer,
  // and on the span it is handed only the five methods createMockSpan provides.
  return {
    startActiveSpan: vi.fn(
      (
        _name: string,
        options: SpanOptions,
        parentContext: Context,
        callback: (span: Span) => Promise<Response>,
      ) => {
        const span = createMockSpan();
        spanCollector.span = span;
        spanCollector.options = options;
        spanCollector.parentContext = parentContext;
        return callback(span as unknown as Span);
      },
    ),
  } as unknown as Tracer;
}

function createMockMeter(
  recordCollector: RecordCollector,
): HttpMetricsConfig['meter'] {
  // SAFETY: the middleware creates one histogram and one up-down counter, and
  // calls record/add on them; nothing else of a Meter is reached.
  return {
    createHistogram: vi.fn(() => ({
      record: vi.fn((duration: number, attrs: Attributes) => {
        recordCollector.durationRecords.push({ duration, attrs });
      }),
    })),
    createUpDownCounter: vi.fn(() => ({
      add: vi.fn((delta: number, attrs: Attributes) => {
        recordCollector.activeAdds.push({ delta, attrs });
      }),
    })),
  } as unknown as HttpMetricsConfig['meter'];
}

/**
 * `app.request`, then drain the body the way a server does: the span ends once
 * the response has been sent. Reads a clone, so the caller can still read `res`.
 */
async function send(
  app: Hono,
  ...args: Parameters<Hono['request']>
): Promise<Response> {
  const res = await app.request(...args);
  await res.clone().arrayBuffer();
  return res;
}

describe('otel middleware', () => {
  it('creates a span and sets method, url, route, status', async () => {
    const { spanCollector, recordCollector } = createCollectors();
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);

    const app = new Hono()
      .use(otel({ tracer, meter }))
      .get('/hello', (c) => c.text('ok'));

    const res = await send(app, 'http://localhost/hello', { method: 'GET' });
    expect(res.status).toBe(200);

    expect(spanCollector.options).toMatchObject({
      kind: SpanKind.SERVER,
      attributes: expect.objectContaining({
        'http.request.method': 'GET',
        'url.full': 'http://localhost/hello',
      }),
    });
    expect(spanCollector.span.setAttribute).toHaveBeenCalledWith(
      'http.response.status_code',
      200,
    );
    expect(spanCollector.span.setAttribute).toHaveBeenCalledWith(
      'http.route',
      '/hello',
    );
    expect(spanCollector.span.updateName).toHaveBeenCalledWith('GET /hello');
    expect(spanCollector.span.end).toHaveBeenCalled();

    expect(
      recordCollector.activeAdds.filter((a) => a.delta === 1),
    ).toHaveLength(1);
    expect(
      recordCollector.activeAdds.filter((a) => a.delta === -1),
    ).toHaveLength(1);
    expect(recordCollector.durationRecords).toHaveLength(1);
    expect(recordCollector.durationRecords[0]!.duration).toBeGreaterThanOrEqual(
      0,
    );
    expect(
      recordCollector.durationRecords[0]!.attrs['http.response.status_code'],
    ).toBe(200);
  });

  it('sets serviceName and serviceVersion on span and metrics', async () => {
    const { spanCollector } = createCollectors();
    const { recordCollector } = createCollectors();
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);

    const app = new Hono()
      .use(
        otel({ tracer, meter, serviceName: 'my-api', serviceVersion: '1.2.3' }),
      )
      .get('/v1/foo', (c) => c.json({}));

    await send(app, 'http://localhost/v1/foo', { method: 'GET' });

    expect(spanCollector.options).toMatchObject({
      attributes: expect.objectContaining({
        'service.name': 'my-api',
        'service.version': '1.2.3',
      }),
    });
    expect(recordCollector.durationRecords).toHaveLength(1);
    expect(recordCollector.durationRecords[0]!.attrs['service.name']).toBe(
      'my-api',
    );
    expect(recordCollector.durationRecords[0]!.attrs['service.version']).toBe(
      '1.2.3',
    );
  });

  it('captures request and response headers when configured', async () => {
    const { spanCollector } = createCollectors();
    const { recordCollector } = createCollectors();
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);

    const app = new Hono()
      .use(
        otel({
          tracer,
          meter,
          captureRequestHeaders: ['x-request-id', 'content-type'],
          captureResponseHeaders: ['content-type'],
        }),
      )
      .get('/r', (c) => {
        c.header('Content-Type', 'application/json');
        return c.json({});
      });

    await send(app, 'http://localhost/r', {
      method: 'GET',
      headers: {
        'x-request-id': 'req-123',
        'content-type': 'application/json',
      },
    });

    expect(spanCollector.span.setAttribute).toHaveBeenCalledWith(
      'http.request.header.x-request-id',
      'req-123',
    );
    expect(spanCollector.span.setAttribute).toHaveBeenCalledWith(
      'http.request.header.content-type',
      'application/json',
    );
    expect(spanCollector.span.setAttribute).toHaveBeenCalledWith(
      'http.response.header.content-type',
      'application/json',
    );
  });

  it('sets ERROR status and records exception when handler throws', async () => {
    const { spanCollector } = createCollectors();
    const { recordCollector } = createCollectors();
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);

    const app = new Hono().use(otel({ tracer, meter })).get('/err', () => {
      throw new Error('boom');
    });

    // Hono logs unhandled errors to console.error by default. The test
    // intentionally throws to verify span behavior — silence the framework
    // log so the test output stays clean.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await send(app, 'http://localhost/err', { method: 'GET' });
    expect(res.status).toBe(500);
    errSpy.mockRestore();

    expect(spanCollector.span.setStatus).toHaveBeenCalledWith({ code: 2 }); // SpanStatusCode.ERROR
    expect(spanCollector.span.recordException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'boom' }),
    );
    expect(spanCollector.span.end).toHaveBeenCalled();
  });

  it('does not throw when recordException receives non-Error (robustness)', async () => {
    const { spanCollector } = createCollectors();
    const { recordCollector } = createCollectors();
    const baseSpan = createMockSpan();
    baseSpan.recordException = vi.fn((_e: unknown) => {
      throw new Error('recordException fails on non-Error');
    });
    // SAFETY: as in createMockTracer - only startActiveSpan is reached on the
    // tracer, and only the five methods createMockSpan provides on the span.
    const tracerWithFragileSpan = {
      startActiveSpan: vi.fn(
        (
          _name: string,
          options: SpanOptions,
          _context: Context,
          callback: (span: Span) => Promise<Response>,
        ) => {
          spanCollector.span = baseSpan;
          spanCollector.options = options;
          return callback(baseSpan as unknown as Span);
        },
      ),
    } as unknown as Tracer;
    const meter = createMockMeter(recordCollector);

    const app = new Hono()
      .use(otel({ tracer: tracerWithFragileSpan, meter }))
      .get('/bad', () => {
        // A route can throw anything; the middleware must survive a non-Error.

        throw 'string throw';
      });

    // Hono surfaces the string throw via console.error; silence for the test.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      send(app, 'http://localhost/bad', { method: 'GET' }),
    ).rejects.toBe('string throw');
    expect(baseSpan.end).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('when disableTracing is true, does not create span but still records metrics', async () => {
    const { recordCollector } = createCollectors();
    const meter = createMockMeter(recordCollector);

    const app = new Hono()
      .use(otel({ disableTracing: true, meter }))
      .get('/no-span', (c) => c.text('ok'));

    const res = await send(app, 'http://localhost/no-span', {
      method: 'GET',
    });
    expect(res.status).toBe(200);
    expect(
      recordCollector.activeAdds.filter((a) => a.delta === 1),
    ).toHaveLength(1);
    expect(
      recordCollector.activeAdds.filter((a) => a.delta === -1),
    ).toHaveLength(1);
    expect(recordCollector.durationRecords).toHaveLength(1);
  });

  it('when disableTracing is true, should not call propagation.extract', async () => {
    const extractSpy = vi
      .spyOn(propagation, 'extract')
      .mockImplementation(() => {
        throw new Error('extract should not run when tracing is disabled');
      });

    try {
      const { recordCollector } = createCollectors();
      const meter = createMockMeter(recordCollector);

      const app = new Hono()
        .use(otel({ disableTracing: true, meter }))
        .get('/disable-tracing', (c) => c.text('ok'));

      const res = await send(app, 'http://localhost/disable-tracing', {
        method: 'GET',
      });
      expect(res.status).toBe(200);
      expect(extractSpy).not.toHaveBeenCalled();
    } finally {
      extractSpy.mockRestore();
    }
  });

  it('uses spanNameFactory when provided', async () => {
    const { spanCollector } = createCollectors();
    const { recordCollector } = createCollectors();
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);

    const app = new Hono()
      .use(
        otel({
          tracer,
          meter,
          spanNameFactory: (c) => `HTTP ${c.req.method} ${c.req.path}`,
        }),
      )
      .get('/custom-name', (c) => c.text('ok'));

    await send(app, 'http://localhost/custom-name', { method: 'GET' });

    expect(spanCollector.options).toMatchObject({
      attributes: expect.any(Object),
    });
    expect(spanCollector.span.updateName).toHaveBeenCalledWith(
      'HTTP GET /custom-name',
    );
  });

  it('sets correct span name and route for subapp route', async () => {
    const { spanCollector } = createCollectors();
    const { recordCollector } = createCollectors();
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);

    const subapp = new Hono().get('/hello', (c) => c.text('from subapp'));
    const app = new Hono()
      .use(otel({ tracer, meter }))
      .route('/subapp', subapp);

    await send(app, 'http://localhost/subapp/hello', { method: 'GET' });

    expect(spanCollector.span.updateName).toHaveBeenCalledWith(
      'GET /subapp/hello',
    );
    expect(spanCollector.span.setAttribute).toHaveBeenCalledWith(
      'http.route',
      '/subapp/hello',
    );
  });

  it('handles header names case-insensitively (request and response)', async () => {
    const { spanCollector } = createCollectors();
    const { recordCollector } = createCollectors();
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);

    const app = new Hono()
      .use(
        otel({
          tracer,
          meter,
          captureRequestHeaders: ['Accept-Language', 'x-custom-header'],
          captureResponseHeaders: ['Cache-Control', 'x-response-header'],
        }),
      )
      .get('/case', (c) => {
        c.header('Cache-Control', 'no-cache');
        c.header('X-Response-Header', 'response-value');
        return c.text('ok');
      });

    await send(app, 'http://localhost/case', {
      method: 'GET',
      headers: {
        'Accept-Language': 'en-US',
        'X-Custom-Header': 'custom-value',
      },
    });

    expect(spanCollector.span.setAttribute).toHaveBeenCalledWith(
      'http.request.header.accept-language',
      'en-US',
    );
    expect(spanCollector.span.setAttribute).toHaveBeenCalledWith(
      'http.request.header.x-custom-header',
      'custom-value',
    );
    expect(spanCollector.span.setAttribute).toHaveBeenCalledWith(
      'http.response.header.cache-control',
      'no-cache',
    );
    expect(spanCollector.span.setAttribute).toHaveBeenCalledWith(
      'http.response.header.x-response-header',
      'response-value',
    );
  });

  it('does not capture headers not in the allow list', async () => {
    const { spanCollector } = createCollectors();
    const { recordCollector } = createCollectors();
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);

    const app = new Hono()
      .use(
        otel({
          tracer,
          meter,
          captureRequestHeaders: ['Content-Type'],
          captureResponseHeaders: ['Content-Type'],
        }),
      )
      .get('/foo', (c) => {
        c.header('X-Secret', 'must-not-appear');
        return c.text('ok');
      });

    await send(app, 'http://localhost/foo', {
      headers: { Authorization: 'Bearer secret', 'Content-Type': 'text/plain' },
    });

    const setAttributeCalls = spanCollector.span.setAttribute.mock.calls;
    const attrKeys = setAttributeCalls.map(([k]) => k);
    expect(attrKeys).not.toContain('http.request.header.authorization');
    expect(attrKeys).not.toContain('http.response.header.x-secret');
  });

  it('uses getTime for span startTime and end when provided', async () => {
    const { spanCollector, recordCollector } = createCollectors();
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);
    const customTime = 12_345;

    const app = new Hono()
      .use(otel({ tracer, meter, getTime: () => customTime }))
      .get('/time', (c) => c.text('ok'));

    await send(app, 'http://localhost/time', { method: 'GET' });

    expect(spanCollector.options).toMatchObject({ startTime: customTime });
    expect(spanCollector.span.end).toHaveBeenCalledWith(customTime);
  });

  it('marks span error for 5xx response without thrown exception', async () => {
    const { spanCollector } = createCollectors();
    const { recordCollector } = createCollectors();
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);

    const app = new Hono()
      .use(otel({ tracer, meter }))
      .get('/boom', () => new Response('fail', { status: 503 }));

    await send(app, 'http://localhost/boom', { method: 'GET' });

    expect(spanCollector.span.setAttribute).toHaveBeenCalledWith(
      'http.response.status_code',
      503,
    );
    expect(spanCollector.span.setStatus).toHaveBeenCalledWith({ code: 2 });
  });

  it('does not crash without meter or tracer (uses global providers)', async () => {
    const app = new Hono().use(otel({})).get('/no-config', (c) => c.text('ok'));
    const res = await send(app, 'http://localhost/no-config', {
      method: 'GET',
    });
    expect(res.status).toBe(200);
  });

  it('records duration metrics for subapp routes', async () => {
    const { recordCollector } = createCollectors();
    const meter = createMockMeter(recordCollector);

    const subapp = new Hono().get('/nested', (c) => c.text('nested'));
    const app = new Hono().use(otel({ meter })).route('/api', subapp);

    await send(app, 'http://localhost/api/nested', { method: 'GET' });

    const durationForRoute = recordCollector.durationRecords.find(
      (r) => r.attrs['http.route'] === '/api/nested',
    );
    expect(durationForRoute).toBeDefined();
    expect(durationForRoute!.attrs['http.request.method']).toBe('GET');
  });

  it('records metrics for different HTTP methods and status codes', async () => {
    const { recordCollector } = createCollectors();
    const meter = createMockMeter(recordCollector);

    const app = new Hono()
      .use(otel({ meter }))
      .get('/success', (c) => c.text('ok'))
      .post('/created', (c) => c.text('created', 201))
      .get('/not-found', (c) => c.text('not found', 404));

    await send(app, 'http://localhost/success');
    await send(app, 'http://localhost/success');
    await send(app, 'http://localhost/created', { method: 'POST' });
    await send(app, 'http://localhost/not-found');

    const routes = recordCollector.durationRecords.map(
      (r) => r.attrs['http.route'],
    );
    expect(routes).toContain('/success');
    expect(routes).toContain('/created');
    expect(routes).toContain('/not-found');
    const methods = recordCollector.durationRecords.map(
      (r) => r.attrs['http.request.method'],
    );
    expect(methods).toContain('GET');
    expect(methods).toContain('POST');
  });

  it('active requests increment and decrement use identical attributes', async () => {
    const { recordCollector } = createCollectors();
    const meter = createMockMeter(recordCollector);

    const app = new Hono()
      .use(otel({ meter }))
      .get('/attrs', (c) => c.text('ok'));
    await send(app, 'http://localhost/attrs', { method: 'GET' });

    expect(recordCollector.activeAdds).toHaveLength(2);
    expect(recordCollector.activeAdds[0]!.delta).toBe(1);
    expect(recordCollector.activeAdds[1]!.delta).toBe(-1);
    expect(recordCollector.activeAdds[0]!.attrs).toEqual(
      recordCollector.activeAdds[1]!.attrs,
    );
    expect(recordCollector.activeAdds[0]!.attrs['http.request.method']).toBe(
      'GET',
    );
  });

  it('does not track active requests when captureActiveRequests is false', async () => {
    const { recordCollector } = createCollectors();
    const meter = createMockMeter(recordCollector);

    const app = new Hono()
      .use(otel({ meter, captureActiveRequests: false }))
      .get('/no-active', (c) => c.text('ok'));

    await send(app, 'http://localhost/no-active', { method: 'GET' });

    expect(recordCollector.activeAdds).toHaveLength(0);
    expect(recordCollector.durationRecords).toHaveLength(1);
  });

  it('records duration metric when handler throws', async () => {
    const { recordCollector } = createCollectors();
    const meter = createMockMeter(recordCollector);

    const app = new Hono().use(otel({ meter })).get('/err-metric', () => {
      throw new Error('fail');
    });

    await Promise.resolve(
      send(app, 'http://localhost/err-metric', { method: 'GET' }),
    ).catch(() => {});

    const errRecord = recordCollector.durationRecords.find(
      (r) => r.attrs['http.route'] === '/err-metric',
    );
    expect(errRecord).toBeDefined();
    expect(errRecord!.attrs['http.response.status_code']).toBe(500);
  });

  it('honors parent context when request runs inside active span', async () => {
    const { spanCollector, recordCollector } = createCollectors();
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);

    const app = new Hono()
      .use(otel({ tracer, meter }))
      .get('/child', (c) => c.text('ok'));

    // SAFETY: only the span context is read from a parent span, and setSpan
    // stores it without touching anything else.
    const parentSpan = createMockSpan() as unknown as Span;
    const ctxWithParent = otelTrace.setSpan(context.active(), parentSpan);
    await context.with(ctxWithParent, async () => {
      await send(app, 'http://localhost/child', { method: 'GET' });
    });

    expect(spanCollector.parentContext).toBeDefined();
  });
});

describe('otel middleware: streamed responses', () => {
  /** An SSE route that sends one event after `release` resolves, then closes. */
  function sseApp(opts: Parameters<typeof otel>[0], release: Promise<void>) {
    return new Hono().use(otel(opts)).get('/sse', (c) =>
      streamSSE(c, async (stream) => {
        await release;
        await stream.writeSSE({ data: 'done' });
      }),
    );
  }

  it('ends the span when the stream finishes, not when the handler returns', async () => {
    const { spanCollector, recordCollector } = createCollectors();
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);
    let release!: () => void;
    const app = sseApp(
      { tracer, meter },
      new Promise<void>((r) => (release = r)),
    );

    const res = await app.request('http://localhost/sse');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    // Handler returned, stream still open: nothing finalized yet.
    expect(spanCollector.span.end).not.toHaveBeenCalled();
    expect(recordCollector.durationRecords).toHaveLength(0);
    expect(
      recordCollector.activeAdds.filter((a) => a.delta === -1),
    ).toHaveLength(0);

    release();
    expect(await res.text()).toContain('data: done');

    expect(spanCollector.span.end).toHaveBeenCalledTimes(1);
    expect(spanCollector.span.setAttribute).toHaveBeenCalledWith(
      'http.response.status_code',
      200,
    );
    expect(recordCollector.durationRecords).toHaveLength(1);
    expect(
      recordCollector.activeAdds.filter((a) => a.delta === -1),
    ).toHaveLength(1);
  });

  it('ends the span once when the client cancels the stream', async () => {
    const { spanCollector, recordCollector } = createCollectors();
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);
    const app = sseApp({ tracer, meter }, new Promise<void>(() => {}));

    const res = await app.request('http://localhost/sse');
    await res.body!.cancel();

    expect(spanCollector.span.end).toHaveBeenCalledTimes(1);
    expect(spanCollector.span.setStatus).not.toHaveBeenCalled();
    expect(recordCollector.durationRecords).toHaveLength(1);
  });

  it('records the error when the stream fails part-way', async () => {
    const { spanCollector, recordCollector } = createCollectors();
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);
    // Hono's stream helpers swallow errors, so fail a raw SSE body directly.
    const app = new Hono().use(otel({ tracer, meter })).get(
      '/sse',
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.error(new Error('model call failed'));
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );

    const res = await app.request('http://localhost/sse');
    await expect(res.text()).rejects.toThrow('model call failed');

    expect(spanCollector.span.recordException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'model call failed' }),
    );
    expect(spanCollector.span.setStatus).toHaveBeenCalledWith({ code: 2 });
    expect(spanCollector.span.end).toHaveBeenCalledTimes(1);
  });

  it('records duration at stream end when tracing is disabled', async () => {
    const { recordCollector } = createCollectors();
    const meter = createMockMeter(recordCollector);
    let release!: () => void;
    const app = sseApp(
      { disableTracing: true, meter },
      new Promise<void>((r) => (release = r)),
    );

    const res = await app.request('http://localhost/sse');
    expect(recordCollector.durationRecords).toHaveLength(0);
    release();
    await res.text();
    expect(recordCollector.durationRecords).toHaveLength(1);
  });

  it('waits for stream() bodies, which carry no streaming headers', async () => {
    const { spanCollector, recordCollector } = createCollectors();
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    const app = new Hono().use(otel({ tracer, meter })).get('/raw', (c) =>
      stream(c, async (s) => {
        await released;
        await s.write('done');
      }),
    );

    const res = await app.request('http://localhost/raw');
    expect(res.headers.get('content-type')).toBeNull();
    expect(res.headers.get('transfer-encoding')).toBeNull();
    expect(spanCollector.span.end).not.toHaveBeenCalled();
    expect(recordCollector.durationRecords).toHaveLength(0);
    expect(
      recordCollector.activeAdds.filter((a) => a.delta === -1),
    ).toHaveLength(0);

    release();
    expect(await res.text()).toBe('done');
    expect(spanCollector.span.end).toHaveBeenCalledTimes(1);
    expect(recordCollector.durationRecords).toHaveLength(1);
    expect(
      recordCollector.activeAdds.filter((a) => a.delta === -1),
    ).toHaveLength(1);
  });

  it('ends a buffered response once its body is sent', async () => {
    const { spanCollector, recordCollector } = createCollectors();
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);
    const app = new Hono()
      .use(otel({ tracer, meter }))
      .get('/json', (c) => c.json({ ok: true }));

    const res = await app.request('http://localhost/json');
    expect(await res.json()).toEqual({ ok: true });
    expect(spanCollector.span.end).toHaveBeenCalledTimes(1);
  });

  it('ends at once for a body-less response', async () => {
    const { spanCollector, recordCollector } = createCollectors();
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);
    const app = new Hono()
      .use(otel({ tracer, meter }))
      .get('/empty', (c) => c.body(null, 204));

    await app.request('http://localhost/empty');
    expect(spanCollector.span.end).toHaveBeenCalledTimes(1);
  });

  it('ends HEAD requests at once: Hono discards their body unread', async () => {
    const { spanCollector, recordCollector } = createCollectors();
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);
    const app = new Hono()
      .use(otel({ tracer, meter }))
      .get('/page', (c) => c.text('hello'));

    const res = await app.request('http://localhost/page', { method: 'HEAD' });
    expect(res.body).toBeNull();
    expect(spanCollector.span.end).toHaveBeenCalledTimes(1);
    expect(recordCollector.durationRecords).toHaveLength(1);
  });
});
