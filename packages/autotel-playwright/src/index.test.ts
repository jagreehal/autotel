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
    with: (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
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
