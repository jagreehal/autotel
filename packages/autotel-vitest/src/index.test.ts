import { afterEach, describe, expect, it, vi } from 'vitest';

type FixtureFn = (
  args: { task: { name: string; file?: { name: string }; suite?: { name: string }; meta: Record<string, unknown> } },
  use: (span: unknown) => Promise<void>,
) => Promise<void>;

type Fixtures = {
  _otelTestSpan?: FixtureFn | [FixtureFn, { auto: true }];
};

const state: { fixtures?: Fixtures } = {};
let spanIdCounter = 0;
const createdSpans: Array<{
  end: ReturnType<typeof vi.fn>;
  recordException: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
  spanContext: () => { traceId: string; spanId: string };
}> = [];

vi.mock('vitest', async () => {
  const actual = await vi.importActual<typeof import('vitest')>('vitest');
  return {
    ...actual,
    test: {
      ...actual.test,
      extend: (fixtures: Fixtures) => {
        state.fixtures = fixtures;
        return fixtures;
      },
    },
  };
});

vi.mock('autotel', () => ({
  SpanStatusCode: { UNSET: 0, OK: 1, ERROR: 2 },
  context: {
    active: () => ({}),
    with: (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
  },
  getTracer: () => ({
    startSpan: (_name: string, _options?: unknown) => {
      const id = String(++spanIdCounter);
      const span = {
        end: vi.fn(),
        recordException: vi.fn(),
        setStatus: vi.fn(),
        spanContext: () => ({ traceId: `trace-${id}`, spanId: `span-${id}` }),
      };
      createdSpans.push(span);
      return span;
    },
  }),
  otelTrace: {
    setSpan: () => ({}),
  },
  getAutotelTracerProvider: vi.fn(() => ({})),
  getTraceContext: vi.fn(() => null),
  resolveTraceUrl: vi.fn(() => undefined),
  isTracing: vi.fn(() => false),
  enrichWithTraceContext: vi.fn((obj: unknown) => obj),
}));

let mockDrainResult: unknown[] = [];
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

describe('autotel-vitest fixture', () => {
  afterEach(() => {
    state.fixtures = undefined;
    createdSpans.length = 0;
    spanIdCounter = 0;
    mockDrainResult = [];
    vi.resetModules();
  });

  it('creates a span for each test via the _otelTestSpan fixture', async () => {
    await import('./index');

    const spanFixture = state.fixtures?._otelTestSpan;
    const spanFixtureFn = Array.isArray(spanFixture) ? spanFixture[0] : spanFixture;
    expect(spanFixtureFn).toBeTypeOf('function');

    await spanFixtureFn?.(
      {
        task: {
          name: 'creates user',
          file: { name: 'user.test.ts' },
          suite: { name: 'UserService' },
          meta: {},
        },
      },
      async () => {},
    );

    expect(createdSpans).toHaveLength(1);
    expect(createdSpans[0].end).toHaveBeenCalledTimes(1);
  });

  it('ends the span after the test completes', async () => {
    await import('./index');

    const spanFixture = state.fixtures?._otelTestSpan;
    const spanFixtureFn = Array.isArray(spanFixture) ? spanFixture[0] : spanFixture;

    let spanDuringTest: unknown;

    await spanFixtureFn?.(
      {
        task: {
          name: 'test end timing',
          file: { name: 'timing.test.ts' },
          suite: { name: '' },
          meta: {},
        },
      },
      async (span) => {
        spanDuringTest = span;
        // Span should not yet be ended during the test
        expect(createdSpans[0].end).not.toHaveBeenCalled();
      },
    );

    // Span should be ended after use() resolves
    expect(spanDuringTest).toBeDefined();
    expect(createdSpans[0].end).toHaveBeenCalledTimes(1);
  });

  it('sets error status when the test throws', async () => {
    await import('./index');

    const spanFixture = state.fixtures?._otelTestSpan;
    const spanFixtureFn = Array.isArray(spanFixture) ? spanFixture[0] : spanFixture;

    const err = new Error('test failure');

    await expect(
      spanFixtureFn?.(
        {
          task: {
            name: 'failing test',
            file: { name: 'fail.test.ts' },
            suite: { name: '' },
            meta: {},
          },
        },
        async () => {
          throw err;
        },
      ),
    ).rejects.toThrow('test failure');

    const span = createdSpans[0];
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2 });
    expect(span.recordException).toHaveBeenCalledWith(err);
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('attaches otelSpans to task.meta when collector returns spans', async () => {
    mockDrainResult = [
      { spanId: 'span-1', name: 'test:my-test', startTimeMs: 1000, durationMs: 100, status: 'ok' },
    ];

    await import('./index');

    const spanFixture = state.fixtures?._otelTestSpan;
    const spanFixtureFn = Array.isArray(spanFixture) ? spanFixture[0] : spanFixture;

    const meta: Record<string, unknown> = {};
    await spanFixtureFn?.(
      {
        task: {
          name: 'my-test',
          file: { name: 'test.ts' },
          suite: { name: '' },
          meta,
        },
      },
      async () => {},
    );

    expect(meta.otelSpans).toEqual([
      { spanId: 'span-1', name: 'test:my-test', startTimeMs: 1000, durationMs: 100, status: 'ok' },
    ]);
  });

  it('uses auto: true to activate for every test', async () => {
    await import('./index');

    const spanFixture = state.fixtures?._otelTestSpan;
    expect(Array.isArray(spanFixture)).toBe(true);
    if (Array.isArray(spanFixture)) {
      expect(spanFixture[1]).toEqual({ auto: true });
    }
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
