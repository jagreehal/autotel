import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { otel } from './index';
import type { Span, Tracer } from 'autotel';
import { SpanKind, propagation, context, otelTrace } from 'autotel';
import type { HttpMetricsConfig } from './metrics';

function createMockSpan() {
  return {
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    updateName: vi.fn(),
    end: vi.fn(),
  };
}

function createMockTracer(
  spanCollector: {
    span: ReturnType<typeof createMockSpan>;
    options: unknown;
    parentContext?: unknown;
  },
) {
  const tracer: Tracer = {
    startActiveSpan: vi.fn(
      (
        _name: string,
        options: unknown,
        parentContext: unknown,
        callback: (span: Span) => Promise<unknown>,
      ) => {
        const span = createMockSpan() as unknown as Span;
        spanCollector.span = span as ReturnType<typeof createMockSpan>;
        spanCollector.options = options;
        spanCollector.parentContext = parentContext;
        return callback(span);
      },
    ),
  } as unknown as Tracer;
  return tracer;
}

function createMockMeter(recordCollector: {
  durationRecords: Array<{ duration: number; attrs: Record<string, unknown> }>;
  activeAdds: Array<{ delta: number; attrs: Record<string, unknown> }>;
}) {
  const meter = {
    createHistogram: vi.fn(() => ({
      record: vi.fn((duration: number, attrs: Record<string, unknown>) => {
        recordCollector.durationRecords.push({ duration, attrs });
      }),
    })),
    createUpDownCounter: vi.fn(() => ({
      add: vi.fn((delta: number, attrs: Record<string, unknown>) => {
        recordCollector.activeAdds.push({ delta, attrs });
      }),
    })),
  } as unknown as HttpMetricsConfig['meter'];
  return meter;
}

describe('otel middleware', () => {
  it('creates a span and sets method, url, route, status', async () => {
    const spanCollector: {
      span: ReturnType<typeof createMockSpan>;
      options: unknown;
    } = { span: null!, options: null };
    const recordCollector = {
      durationRecords: [] as Array<{ duration: number; attrs: Record<string, unknown> }>,
      activeAdds: [] as Array<{ delta: number; attrs: Record<string, unknown> }>,
    };
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);

    const app = new Hono().use(otel({ tracer, meter })).get('/hello', (c) => c.text('ok'));

    const res = await app.request('http://localhost/hello', { method: 'GET' });
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
    expect(spanCollector.span.setAttribute).toHaveBeenCalledWith('http.route', '/hello');
    expect(spanCollector.span.updateName).toHaveBeenCalledWith('GET /hello');
    expect(spanCollector.span.end).toHaveBeenCalled();

    expect(recordCollector.activeAdds.filter((a) => a.delta === 1)).toHaveLength(1);
    expect(recordCollector.activeAdds.filter((a) => a.delta === -1)).toHaveLength(1);
    expect(recordCollector.durationRecords).toHaveLength(1);
    expect(recordCollector.durationRecords[0].duration).toBeGreaterThanOrEqual(0);
    expect(recordCollector.durationRecords[0].attrs['http.response.status_code']).toBe(200);
  });

  it('sets serviceName and serviceVersion on span and metrics', async () => {
    const spanCollector: { span: ReturnType<typeof createMockSpan>; options: unknown } = {
      span: null!,
      options: null,
    };
    const recordCollector = {
      durationRecords: [] as Array<{ duration: number; attrs: Record<string, unknown> }>,
      activeAdds: [] as Array<{ delta: number; attrs: Record<string, unknown> }>,
    };
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);

    const app = new Hono()
      .use(otel({ tracer, meter, serviceName: 'my-api', serviceVersion: '1.2.3' }))
      .get('/v1/foo', (c) => c.json({}));

    await app.request('http://localhost/v1/foo', { method: 'GET' });

    expect(spanCollector.options).toMatchObject({
      attributes: expect.objectContaining({
        'service.name': 'my-api',
        'service.version': '1.2.3',
      }),
    });
    expect(recordCollector.durationRecords[0].attrs['service.name']).toBe('my-api');
    expect(recordCollector.durationRecords[0].attrs['service.version']).toBe('1.2.3');
  });

  it('captures request and response headers when configured', async () => {
    const spanCollector: { span: ReturnType<typeof createMockSpan>; options: unknown } = {
      span: null!,
      options: null,
    };
    const recordCollector = {
      durationRecords: [] as Array<{ duration: number; attrs: Record<string, unknown> }>,
      activeAdds: [] as Array<{ delta: number; attrs: Record<string, unknown> }>,
    };
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

    await app.request('http://localhost/r', {
      method: 'GET',
      headers: { 'x-request-id': 'req-123', 'content-type': 'application/json' },
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
    const spanCollector: { span: ReturnType<typeof createMockSpan>; options: unknown } = {
      span: null!,
      options: null,
    };
    const recordCollector = {
      durationRecords: [] as Array<{ duration: number; attrs: Record<string, unknown> }>,
      activeAdds: [] as Array<{ delta: number; attrs: Record<string, unknown> }>,
    };
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);

    const app = new Hono()
      .use(otel({ tracer, meter }))
      .get('/err', () => {
        throw new Error('boom');
      });

    const res = await app.request('http://localhost/err', { method: 'GET' });
    expect(res.status).toBe(500);

    expect(spanCollector.span.setStatus).toHaveBeenCalledWith({ code: 2 }); // SpanStatusCode.ERROR
    expect(spanCollector.span.recordException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'boom' }),
    );
    expect(spanCollector.span.end).toHaveBeenCalled();
  });

  it('does not throw when recordException receives non-Error (robustness)', async () => {
    const spanCollector: { span: ReturnType<typeof createMockSpan>; options: unknown } = {
      span: null!,
      options: null,
    };
    const recordCollector = {
      durationRecords: [] as Array<{ duration: number; attrs: Record<string, unknown> }>,
      activeAdds: [] as Array<{ delta: number; attrs: Record<string, unknown> }>,
    };
    const baseSpan = createMockSpan();
    baseSpan.recordException = vi.fn((_e: unknown) => {
      throw new Error('recordException fails on non-Error');
    });
    const tracerWithFragileSpan: Tracer = {
      startActiveSpan: vi.fn(
        (
          _name: string,
          _options: unknown,
          _context: unknown,
          callback: (span: Span) => Promise<unknown>,
        ) => {
          spanCollector.span = baseSpan as ReturnType<typeof createMockSpan>;
          spanCollector.options = _options;
          return callback(baseSpan as unknown as Span);
        },
      ),
    } as unknown as Tracer;
    const meter = createMockMeter(recordCollector);

    const app = new Hono()
      .use(otel({ tracer: tracerWithFragileSpan, meter }))
      .get('/bad', () => {
        throw 'string throw' as unknown as Error;
      });

    await expect(app.request('http://localhost/bad', { method: 'GET' })).rejects.toBe('string throw');
    expect(baseSpan.end).toHaveBeenCalled();
  });

  it('when disableTracing is true, does not create span but still records metrics', async () => {
    const recordCollector = {
      durationRecords: [] as Array<{ duration: number; attrs: Record<string, unknown> }>,
      activeAdds: [] as Array<{ delta: number; attrs: Record<string, unknown> }>,
    };
    const meter = createMockMeter(recordCollector);

    const app = new Hono()
      .use(otel({ disableTracing: true, meter }))
      .get('/no-span', (c) => c.text('ok'));

    const res = await app.request('http://localhost/no-span', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(recordCollector.activeAdds.filter((a) => a.delta === 1)).toHaveLength(1);
    expect(recordCollector.activeAdds.filter((a) => a.delta === -1)).toHaveLength(1);
    expect(recordCollector.durationRecords).toHaveLength(1);
  });

  it('when disableTracing is true, should not call propagation.extract', async () => {
    const extractSpy = vi
      .spyOn(propagation, 'extract')
      .mockImplementation(() => {
        throw new Error('extract should not run when tracing is disabled');
      });

    try {
      const recordCollector = {
        durationRecords: [] as Array<{ duration: number; attrs: Record<string, unknown> }>,
        activeAdds: [] as Array<{ delta: number; attrs: Record<string, unknown> }>,
      };
      const meter = createMockMeter(recordCollector);

      const app = new Hono()
        .use(otel({ disableTracing: true, meter }))
        .get('/disable-tracing', (c) => c.text('ok'));

      const res = await app.request('http://localhost/disable-tracing', { method: 'GET' });
      expect(res.status).toBe(200);
      expect(extractSpy).not.toHaveBeenCalled();
    } finally {
      extractSpy.mockRestore();
    }
  });

  it('uses spanNameFactory when provided', async () => {
    const spanCollector: { span: ReturnType<typeof createMockSpan>; options: unknown } = {
      span: null!,
      options: null,
    };
    const recordCollector = {
      durationRecords: [] as Array<{ duration: number; attrs: Record<string, unknown> }>,
      activeAdds: [] as Array<{ delta: number; attrs: Record<string, unknown> }>,
    };
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

    await app.request('http://localhost/custom-name', { method: 'GET' });

    expect(spanCollector.options).toMatchObject({
      attributes: expect.any(Object),
    });
    expect(spanCollector.span.updateName).toHaveBeenCalledWith('HTTP GET /custom-name');
  });

  it('sets correct span name and route for subapp route', async () => {
    const spanCollector: { span: ReturnType<typeof createMockSpan>; options: unknown } = {
      span: null!,
      options: null,
    };
    const recordCollector = {
      durationRecords: [] as Array<{ duration: number; attrs: Record<string, unknown> }>,
      activeAdds: [] as Array<{ delta: number; attrs: Record<string, unknown> }>,
    };
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);

    const subapp = new Hono().get('/hello', (c) => c.text('from subapp'));
    const app = new Hono()
      .use(otel({ tracer, meter }))
      .route('/subapp', subapp);

    await app.request('http://localhost/subapp/hello', { method: 'GET' });

    expect(spanCollector.span.updateName).toHaveBeenCalledWith('GET /subapp/hello');
    expect(spanCollector.span.setAttribute).toHaveBeenCalledWith(
      'http.route',
      '/subapp/hello',
    );
  });

  it('handles header names case-insensitively (request and response)', async () => {
    const spanCollector: { span: ReturnType<typeof createMockSpan>; options: unknown } = {
      span: null!,
      options: null,
    };
    const recordCollector = {
      durationRecords: [] as Array<{ duration: number; attrs: Record<string, unknown> }>,
      activeAdds: [] as Array<{ delta: number; attrs: Record<string, unknown> }>,
    };
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

    await app.request('http://localhost/case', {
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
    const spanCollector: { span: ReturnType<typeof createMockSpan>; options: unknown } = {
      span: null!,
      options: null,
    };
    const recordCollector = {
      durationRecords: [] as Array<{ duration: number; attrs: Record<string, unknown> }>,
      activeAdds: [] as Array<{ delta: number; attrs: Record<string, unknown> }>,
    };
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

    await app.request('http://localhost/foo', {
      headers: { Authorization: 'Bearer secret', 'Content-Type': 'text/plain' },
    });

    const setAttributeCalls = (spanCollector.span.setAttribute as ReturnType<typeof vi.fn>).mock
      .calls as Array<[string, unknown]>;
    const attrKeys = setAttributeCalls.map(([k]) => k);
    expect(attrKeys).not.toContain('http.request.header.authorization');
    expect(attrKeys).not.toContain('http.response.header.x-secret');
  });

  it('uses getTime for span startTime and end when provided', async () => {
    const spanCollector: {
      span: ReturnType<typeof createMockSpan>;
      options: unknown;
    } = { span: null!, options: null };
    const recordCollector = {
      durationRecords: [] as Array<{ duration: number; attrs: Record<string, unknown> }>,
      activeAdds: [] as Array<{ delta: number; attrs: Record<string, unknown> }>,
    };
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);
    const customTime = 12_345;

    const app = new Hono()
      .use(otel({ tracer, meter, getTime: () => customTime }))
      .get('/time', (c) => c.text('ok'));

    await app.request('http://localhost/time', { method: 'GET' });

    expect(spanCollector.options).toMatchObject({ startTime: customTime });
    expect(spanCollector.span.end).toHaveBeenCalledWith(customTime);
  });

  it('marks span error for 5xx response without thrown exception', async () => {
    const spanCollector: { span: ReturnType<typeof createMockSpan>; options: unknown } = {
      span: null!,
      options: null,
    };
    const recordCollector = {
      durationRecords: [] as Array<{ duration: number; attrs: Record<string, unknown> }>,
      activeAdds: [] as Array<{ delta: number; attrs: Record<string, unknown> }>,
    };
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);

    const app = new Hono()
      .use(otel({ tracer, meter }))
      .get('/boom', () => new Response('fail', { status: 503 }));

    await app.request('http://localhost/boom', { method: 'GET' });

    expect(spanCollector.span.setAttribute).toHaveBeenCalledWith(
      'http.response.status_code',
      503,
    );
    expect(spanCollector.span.setStatus).toHaveBeenCalledWith({ code: 2 });
  });

  it('does not crash without meter or tracer (uses global providers)', async () => {
    const app = new Hono().use(otel({})).get('/no-config', (c) => c.text('ok'));
    const res = await app.request('http://localhost/no-config', { method: 'GET' });
    expect(res.status).toBe(200);
  });

  it('records duration metrics for subapp routes', async () => {
    const recordCollector = {
      durationRecords: [] as Array<{ duration: number; attrs: Record<string, unknown> }>,
      activeAdds: [] as Array<{ delta: number; attrs: Record<string, unknown> }>,
    };
    const meter = createMockMeter(recordCollector);

    const subapp = new Hono().get('/nested', (c) => c.text('nested'));
    const app = new Hono()
      .use(otel({ meter }))
      .route('/api', subapp);

    await app.request('http://localhost/api/nested', { method: 'GET' });

    const durationForRoute = recordCollector.durationRecords.find(
      (r) => r.attrs['http.route'] === '/api/nested',
    );
    expect(durationForRoute).toBeDefined();
    expect(durationForRoute!.attrs['http.request.method']).toBe('GET');
  });

  it('records metrics for different HTTP methods and status codes', async () => {
    const recordCollector = {
      durationRecords: [] as Array<{ duration: number; attrs: Record<string, unknown> }>,
      activeAdds: [] as Array<{ delta: number; attrs: Record<string, unknown> }>,
    };
    const meter = createMockMeter(recordCollector);

    const app = new Hono()
      .use(otel({ meter }))
      .get('/success', (c) => c.text('ok'))
      .post('/created', (c) => c.text('created', 201))
      .get('/not-found', (c) => c.text('not found', 404));

    await app.request('http://localhost/success');
    await app.request('http://localhost/success');
    await app.request('http://localhost/created', { method: 'POST' });
    await app.request('http://localhost/not-found');

    const routes = recordCollector.durationRecords.map((r) => r.attrs['http.route']);
    expect(routes).toContain('/success');
    expect(routes).toContain('/created');
    expect(routes).toContain('/not-found');
    const methods = recordCollector.durationRecords.map((r) => r.attrs['http.request.method']);
    expect(methods).toContain('GET');
    expect(methods).toContain('POST');
  });

  it('active requests increment and decrement use identical attributes', async () => {
    const recordCollector = {
      durationRecords: [] as Array<{ duration: number; attrs: Record<string, unknown> }>,
      activeAdds: [] as Array<{ delta: number; attrs: Record<string, unknown> }>,
    };
    const meter = createMockMeter(recordCollector);

    const app = new Hono().use(otel({ meter })).get('/attrs', (c) => c.text('ok'));
    await app.request('http://localhost/attrs', { method: 'GET' });

    expect(recordCollector.activeAdds).toHaveLength(2);
    expect(recordCollector.activeAdds[0].delta).toBe(1);
    expect(recordCollector.activeAdds[1].delta).toBe(-1);
    expect(recordCollector.activeAdds[0].attrs).toEqual(recordCollector.activeAdds[1].attrs);
    expect(recordCollector.activeAdds[0].attrs['http.request.method']).toBe('GET');
  });

  it('does not track active requests when captureActiveRequests is false', async () => {
    const recordCollector = {
      durationRecords: [] as Array<{ duration: number; attrs: Record<string, unknown> }>,
      activeAdds: [] as Array<{ delta: number; attrs: Record<string, unknown> }>,
    };
    const meter = createMockMeter(recordCollector);

    const app = new Hono()
      .use(otel({ meter, captureActiveRequests: false }))
      .get('/no-active', (c) => c.text('ok'));

    await app.request('http://localhost/no-active', { method: 'GET' });

    expect(recordCollector.activeAdds).toHaveLength(0);
    expect(recordCollector.durationRecords).toHaveLength(1);
  });

  it('records duration metric when handler throws', async () => {
    const recordCollector = {
      durationRecords: [] as Array<{ duration: number; attrs: Record<string, unknown> }>,
      activeAdds: [] as Array<{ delta: number; attrs: Record<string, unknown> }>,
    };
    const meter = createMockMeter(recordCollector);

    const app = new Hono()
      .use(otel({ meter }))
      .get('/err-metric', () => {
        throw new Error('fail');
      });

    await app.request('http://localhost/err-metric', { method: 'GET' }).catch(() => {});

    const errRecord = recordCollector.durationRecords.find(
      (r) => r.attrs['http.route'] === '/err-metric',
    );
    expect(errRecord).toBeDefined();
    expect(errRecord!.attrs['http.response.status_code']).toBe(500);
  });

  it('honors parent context when request runs inside active span', async () => {
    const spanCollector: {
      span: ReturnType<typeof createMockSpan>;
      options: unknown;
      parentContext?: unknown;
    } = { span: null!, options: null };
    const recordCollector = {
      durationRecords: [] as Array<{ duration: number; attrs: Record<string, unknown> }>,
      activeAdds: [] as Array<{ delta: number; attrs: Record<string, unknown> }>,
    };
    const tracer = createMockTracer(spanCollector);
    const meter = createMockMeter(recordCollector);

    const app = new Hono().use(otel({ tracer, meter })).get('/child', (c) => c.text('ok'));

    const parentSpan = createMockSpan() as unknown as Span;
    const ctxWithParent = otelTrace.setSpan(context.active(), parentSpan);
    await context.with(ctxWithParent, async () => {
      await app.request('http://localhost/child', { method: 'GET' });
    });

    expect(spanCollector.parentContext).toBeDefined();
  });
});
