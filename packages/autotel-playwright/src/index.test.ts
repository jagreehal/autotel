import { afterEach, describe, expect, it, vi } from 'vitest';

type Fixtures = {
  _otelTestSpan?: TestSpanFixtureFn | [TestSpanFixtureFn, { scope: 'test' }];
  requestWithTrace?: (
    args: { request: unknown; _otelTestSpan: unknown },
    use: (wrapped: any) => Promise<void>,
  ) => Promise<void>;
};

type TestSpanFixtureFn = (
  args: Record<string, never>,
  use: (spanData: unknown) => Promise<void>,
  testInfo: {
    annotations: Array<{ type: string; description?: string }>;
    file?: string;
    line?: number;
    project: { name: string };
    title: string;
  },
) => Promise<void>;

const state: { fixtures?: Fixtures } = {};
let spanIdCounter = 0;
let mockDrainResult: unknown[] = [];
const contextWithSpy = vi.fn((_ctx: unknown, fn: () => Promise<unknown>) => fn());
const createdSpans: Array<{
  end: ReturnType<typeof vi.fn>;
  recordException: ReturnType<typeof vi.fn>;
  setAttribute: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
  spanContext: () => { traceId: string; spanId: string };
}> = [];

vi.mock('@playwright/test', () => ({
  expect,
  test: {
    extend: (fixtures: Fixtures) => {
      state.fixtures = fixtures;
      return fixtures;
    },
  },
}));

vi.mock('autotel', () => ({
  SpanStatusCode: { UNSET: 0, OK: 1, ERROR: 2 },
  context: {
    active: () => ({}),
    with: contextWithSpy,
  },
  getTracer: () => ({
    startSpan: () => {
      const id = String(++spanIdCounter);
      const span = {
        end: vi.fn(),
        recordException: vi.fn(),
        setAttribute: vi.fn(),
        setStatus: vi.fn(),
        spanContext: () => ({ traceId: `trace-${id}`, spanId: `span-${id}` }),
      };
      createdSpans.push(span);
      return span;
    },
  }),
  propagation: {
    inject: (_ctx: unknown, carrier: Record<string, string>) => {
      carrier.traceparent = '00-testtrace-testspan-01';
    },
  },
  otelTrace: {
    setSpan: () => ({}),
  },
  getAutotelTracerProvider: vi.fn(() => ({})),
  getTraceContext: vi.fn(() => null),
  resolveTraceUrl: vi.fn(() => undefined),
  isTracing: vi.fn(() => false),
  enrichWithTraceContext: vi.fn((obj: unknown) => obj),
}));

vi.mock('autotel/test-span-collector', () => ({
  TestSpanCollector: class {
    export = vi.fn();
    drainTrace = vi.fn(() => mockDrainResult);
    shutdown = vi.fn(() => Promise.resolve());
    forceFlush = vi.fn(() => Promise.resolve());
  },
}));

vi.mock('autotel/processors', () => ({
  SimpleSpanProcessor: class {
    constructor() {}
  },
}));

describe('autotel-playwright requestWithTrace.fetch', () => {
  afterEach(() => {
    delete process.env.API_BASE_URL;
    delete process.env.AUTOTEL_PLAYWRIGHT_API_ORIGIN;
    state.fixtures = undefined;
    createdSpans.length = 0;
    spanIdCounter = 0;
    mockDrainResult = [];
    contextWithSpy.mockClear();
    vi.resetModules();
  });

  it('injects trace headers for string URLs', async () => {
    await import('./index');

    const requestWithTraceFixture = state.fixtures?.requestWithTrace;
    expect(requestWithTraceFixture).toBeTypeOf('function');

    const fetchSpy = vi.fn(async () => ({ ok: true }));
    const request = { fetch: fetchSpy } as any;
    let wrapped: any;

    await requestWithTraceFixture?.(
      {
        request,
        _otelTestSpan: {
          apiBaseUrls: ['http://localhost:3000'],
          carrier: { traceparent: '00-testtrace-testspan-01' },
          testInfo: { title: 'fetch string url' },
        },
      },
      async (value) => {
        wrapped = value;
      },
    );

    await wrapped.fetch('http://localhost:3000/health');

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:3000/health',
      expect.objectContaining({
        headers: expect.objectContaining({
          traceparent: '00-testtrace-testspan-01',
          'x-test-name': 'fetch string url',
        }),
      }),
    );
  });

  it('injects trace headers for Playwright Request objects', async () => {
    await import('./index');

    const requestWithTraceFixture = state.fixtures?.requestWithTrace;
    expect(requestWithTraceFixture).toBeTypeOf('function');

    const fetchSpy = vi.fn(async () => ({ ok: true }));
    const request = { fetch: fetchSpy } as any;
    let wrapped: any;

    await requestWithTraceFixture?.(
      {
        request,
        _otelTestSpan: {
          apiBaseUrls: ['http://localhost:3000'],
          carrier: { traceparent: '00-testtrace-testspan-01' },
          testInfo: { title: 'fetch request object' },
        },
      },
      async (value) => {
        wrapped = value;
      },
    );

    const playwrightRequestLike = {
      url: () => 'http://localhost:3000/health',
    };

    await wrapped.fetch(playwrightRequestLike);

    expect(fetchSpy).toHaveBeenCalledWith(
      playwrightRequestLike,
      expect.objectContaining({
        headers: expect.objectContaining({
          traceparent: '00-testtrace-testspan-01',
          'x-test-name': 'fetch request object',
        }),
      }),
    );
  });
});

describe('autotel-playwright annotations', () => {
  afterEach(() => {
    delete process.env.API_BASE_URL;
    delete process.env.AUTOTEL_PLAYWRIGHT_API_ORIGIN;
    state.fixtures = undefined;
    createdSpans.length = 0;
    spanIdCounter = 0;
    mockDrainResult = [];
    contextWithSpy.mockClear();
    vi.resetModules();
  });

  it('supports semicolon-delimited autotel.attribute key-value pairs', async () => {
    await import('./index');

    const spanFixture = state.fixtures?._otelTestSpan;
    const spanFixtureFn = Array.isArray(spanFixture) ? spanFixture[0] : spanFixture;
    expect(spanFixtureFn).toBeTypeOf('function');

    await spanFixtureFn?.(
      {},
      async () => {},
      {
        annotations: [
          {
            type: 'autotel.attribute',
            description: 'team=checkout;flow=signup',
          },
        ],
        project: { name: 'chromium' },
        title: 'annotation parsing',
      },
    );

    const span = createdSpans[0];
    expect(span).toBeDefined();
    expect(span.setAttribute).toHaveBeenCalledWith('team', 'checkout');
    expect(span.setAttribute).toHaveBeenCalledWith('flow', 'signup');
  });

  it('attaches otel-spans annotation to testInfo when collector returns spans', async () => {
    mockDrainResult = [
      { spanId: 's1', name: 'e2e:test', startTimeMs: 1000, durationMs: 100, status: 'ok' },
    ];

    await import('./index');

    const spanFixture = state.fixtures?._otelTestSpan;
    const spanFixtureFn = Array.isArray(spanFixture) ? spanFixture[0] : spanFixture;

    const annotations: Array<{ type: string; description?: string }> = [];
    await spanFixtureFn?.(
      {},
      async () => {},
      {
        annotations,
        project: { name: 'chromium' },
        title: 'otel-spans test',
      },
    );

    const spansAnnotation = annotations.find((a) => a.type === 'otel-spans');
    expect(spansAnnotation).toBeDefined();
    expect(JSON.parse(spansAnnotation!.description!)).toEqual([
      { spanId: 's1', name: 'e2e:test', startTimeMs: 1000, durationMs: 100, status: 'ok' },
    ]);
  });

  it('marks the test span as error and records exception when test body throws', async () => {
    await import('./index');

    const spanFixture = state.fixtures?._otelTestSpan;
    const spanFixtureFn = Array.isArray(spanFixture) ? spanFixture[0] : spanFixture;
    expect(spanFixtureFn).toBeTypeOf('function');

    const testError = new Error('fixture blew up');
    await expect(
      spanFixtureFn?.(
        {},
        async () => {
          throw testError;
        },
        {
          annotations: [],
          project: { name: 'chromium' },
          title: 'failing fixture test',
        },
      ),
    ).rejects.toThrow('fixture blew up');

    const span = createdSpans[0];
    expect(span).toBeDefined();
    expect(span.setStatus).toHaveBeenCalled();
    expect(span.recordException).toHaveBeenCalledWith(testError);
  });

  it('runs test body inside the test span context', async () => {
    await import('./index');

    const spanFixture = state.fixtures?._otelTestSpan;
    const spanFixtureFn = Array.isArray(spanFixture) ? spanFixture[0] : spanFixture;
    expect(spanFixtureFn).toBeTypeOf('function');

    await spanFixtureFn?.(
      {},
      async () => {},
      {
        annotations: [],
        project: { name: 'chromium' },
        title: 'context propagation test',
      },
    );

    // Once to build carrier, once to run the test body under the span context.
    expect(contextWithSpy).toHaveBeenCalledTimes(2);
  });
});

describe('autotel-playwright step', () => {
  afterEach(() => {
    createdSpans.length = 0;
    vi.resetModules();
  });

  it('marks step span as error and records exception when the step throws', async () => {
    const { step } = await import('./index');
    const err = new Error('step failed');

    await expect(step('boom', async () => Promise.reject(err))).rejects.toThrow('step failed');

    const stepSpan = createdSpans.at(-1);
    expect(stepSpan).toBeDefined();
    expect(stepSpan?.setStatus).toHaveBeenCalled();
    expect(stepSpan?.recordException).toHaveBeenCalledWith(err);
  });
});

describe('trace context helper re-exports', () => {
  it('re-exports getTraceContext', async () => {
    const mod = await import('./index');
    expect(mod.getTraceContext).toBeTypeOf('function');
  });

  it('re-exports resolveTraceUrl', async () => {
    const mod = await import('./index');
    expect(mod.resolveTraceUrl).toBeTypeOf('function');
  });

  it('re-exports isTracing', async () => {
    const mod = await import('./index');
    expect(mod.isTracing).toBeTypeOf('function');
  });

  it('re-exports enrichWithTraceContext', async () => {
    const mod = await import('./index');
    expect(mod.enrichWithTraceContext).toBeTypeOf('function');
  });
});

// Minimal APIRequestContext mock for createTestSpansClient tests
function makeRequest(responseBody: unknown, status = 200) {
  const mockResponse = {
    ok: () => status >= 200 && status < 300,
    status: () => status,
    json: async () => responseBody,
  };
  return {
    get: vi.fn().mockResolvedValue(mockResponse),
    delete: vi.fn().mockResolvedValue(mockResponse),
  };
}

describe('createTestSpansClient', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('getSpans calls GET /api/test-spans', async () => {
    const { createTestSpansClient } = await import('./index');
    const mockSpan = {
      name: 'sendMoney.handler',
      spanId: 'abc',
      traceId: 'trace',
      attributes: {},
      status: { code: 0 },
      durationMs: 100,
    };
    const req = makeRequest({ spans: [mockSpan] });
    const client = createTestSpansClient('http://localhost:3100');
    const spans = await client.getSpans(req as any);
    expect(req.get).toHaveBeenCalledWith('http://localhost:3100/api/test-spans');
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('sendMoney.handler');
  });

  it('getSpans uses custom path when provided', async () => {
    const { createTestSpansClient } = await import('./index');
    const req = makeRequest({ spans: [] });
    const client = createTestSpansClient('http://localhost:3100', { path: '/custom/spans' });
    await client.getSpans(req as any);
    expect(req.get).toHaveBeenCalledWith('http://localhost:3100/custom/spans');
  });

  it('getSpans throws when response not ok', async () => {
    const { createTestSpansClient } = await import('./index');
    const req = makeRequest({ error: 'not found' }, 404);
    const client = createTestSpansClient('http://localhost:3100');
    await expect(client.getSpans(req as any)).rejects.toThrow('GET /api/test-spans failed: 404');
  });

  it('clearSpans calls DELETE /api/test-spans', async () => {
    const { createTestSpansClient } = await import('./index');
    const req = makeRequest({ ok: true });
    const client = createTestSpansClient('http://localhost:3100');
    await client.clearSpans(req as any);
    expect(req.delete).toHaveBeenCalledWith('http://localhost:3100/api/test-spans');
  });

  it('clearSpans uses custom path when provided', async () => {
    const { createTestSpansClient } = await import('./index');
    const req = makeRequest({ ok: true });
    const client = createTestSpansClient('http://localhost:3100', { path: '/custom/spans' });
    await client.clearSpans(req as any);
    expect(req.delete).toHaveBeenCalledWith('http://localhost:3100/custom/spans');
  });

  it('clearSpans throws when response not ok', async () => {
    const { createTestSpansClient } = await import('./index');
    const req = makeRequest({ error: 'not found' }, 404);
    const client = createTestSpansClient('http://localhost:3100');
    await expect(client.clearSpans(req as any)).rejects.toThrow('DELETE /api/test-spans failed: 404');
  });

  it('strips trailing slash from baseUrl', async () => {
    const { createTestSpansClient } = await import('./index');
    const req = makeRequest({ spans: [] });
    const client = createTestSpansClient('http://localhost:3100/');
    await client.getSpans(req as any);
    expect(req.get).toHaveBeenCalledWith('http://localhost:3100/api/test-spans');
  });
});
