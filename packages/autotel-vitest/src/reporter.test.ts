import { afterEach, describe, it, expect, vi } from 'vitest';

const spans: Array<{
  end: ReturnType<typeof vi.fn>;
  recordException: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('autotel', () => ({
  SpanStatusCode: { ERROR: 2 },
  context: {
    active: () => ({}),
    with: (_ctx: unknown, fn: () => void) => fn(),
  },
  getTracer: () => ({
    startSpan: (_name: string, _options?: unknown) => {
      const span = {
        end: vi.fn(),
        recordException: vi.fn(),
        setStatus: vi.fn(),
      };
      spans.push(span);
      return span;
    },
  }),
  otelTrace: {
    setSpan: () => ({}),
  },
}));

function makeTestCase(overrides: {
  id: string;
  name: string;
  moduleId?: string;
  result?: { state: string; errors?: Array<{ message?: string; stack?: string }> };
}) {
  return {
    id: overrides.id,
    name: overrides.name,
    fullName: overrides.name,
    module: { moduleId: overrides.moduleId ?? 'test.ts' },
    result: () => overrides.result ?? { state: 'passed', errors: undefined },
  } as any;
}

function makeTestSuite(overrides: {
  id: string;
  name: string;
  moduleId?: string;
  state?: string;
}) {
  return {
    id: overrides.id,
    name: overrides.name,
    module: { moduleId: overrides.moduleId ?? 'test.ts' },
    state: () => overrides.state ?? 'passed',
  } as any;
}

describe('OtelReporter', () => {
  afterEach(() => {
    spans.length = 0;
    vi.resetModules();
  });

  it('creates a span on test ready and ends it on test result', async () => {
    const { OtelReporter } = await import('./reporter');
    const reporter = new OtelReporter();

    const testCase = makeTestCase({ id: 'test-1', name: 'my test' });

    reporter.onTestCaseReady!(testCase);
    expect(spans).toHaveLength(1);
    expect(spans[0].end).not.toHaveBeenCalled();

    reporter.onTestCaseResult!(testCase);
    expect(spans[0].end).toHaveBeenCalledTimes(1);
  });

  it('sets error status and records exception on failure', async () => {
    const { OtelReporter } = await import('./reporter');
    const reporter = new OtelReporter();

    const testCase = makeTestCase({
      id: 'test-fail',
      name: 'failing test',
      result: {
        state: 'failed',
        errors: [{ message: 'assertion failed', stack: 'Error: assertion failed\n  at ...' }],
      },
    });

    reporter.onTestCaseReady!(testCase);
    reporter.onTestCaseResult!(testCase);

    const span = spans[0];
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2 });
    expect(span.recordException).toHaveBeenCalled();
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('tracks parallel tests independently (no key collisions)', async () => {
    const { OtelReporter } = await import('./reporter');
    const reporter = new OtelReporter();

    const testA = makeTestCase({ id: 'test-a', name: 'shared title' });
    const testB = makeTestCase({ id: 'test-b', name: 'shared title' });

    reporter.onTestCaseReady!(testA);
    reporter.onTestCaseReady!(testB);

    reporter.onTestCaseResult!(testA);

    expect(spans).toHaveLength(2);
    expect(spans[0].end).toHaveBeenCalledTimes(1);
    expect(spans[1].end).not.toHaveBeenCalled();
  });

  it('creates suite spans', async () => {
    const { OtelReporter } = await import('./reporter');
    const reporter = new OtelReporter();

    const suite = makeTestSuite({ id: 'suite-1', name: 'UserService' });

    reporter.onTestSuiteReady!(suite);
    expect(spans).toHaveLength(1);

    reporter.onTestSuiteResult!(suite);
    expect(spans[0].end).toHaveBeenCalledTimes(1);
  });

  it('marks suite span as error when suite fails', async () => {
    const { OtelReporter } = await import('./reporter');
    const reporter = new OtelReporter();

    const suite = makeTestSuite({ id: 'suite-fail', name: 'FailingSuite', state: 'failed' });

    reporter.onTestSuiteReady!(suite);
    reporter.onTestSuiteResult!(suite);

    expect(spans[0].setStatus).toHaveBeenCalledWith({ code: 2 });
    expect(spans[0].end).toHaveBeenCalledTimes(1);
  });

  it('does not error when onTestCaseResult is called without onTestCaseReady', async () => {
    const { OtelReporter } = await import('./reporter');
    const reporter = new OtelReporter();

    const testCase = makeTestCase({ id: 'orphan', name: 'orphan test' });

    // Should not throw
    reporter.onTestCaseResult!(testCase);
    expect(spans).toHaveLength(0);
  });

  it('does not end test spans from other modules when a module ends', async () => {
    const { OtelReporter } = await import('./reporter');
    const reporter = new OtelReporter();

    const moduleA = { moduleId: 'a.test.ts' } as any;

    const testInA = makeTestCase({ id: 'a-1', name: 'test a', moduleId: 'a.test.ts' });
    const testInB = makeTestCase({ id: 'b-1', name: 'test b', moduleId: 'b.test.ts' });

    reporter.onTestCaseReady!(testInA);
    reporter.onTestCaseReady!(testInB);

    reporter.onTestModuleEnd!(moduleA);

    expect(spans).toHaveLength(2);
    expect(spans[0].end).toHaveBeenCalledTimes(1);
    expect(spans[1].end).not.toHaveBeenCalled();
  });

  it('does not end suite spans from other modules when a module ends', async () => {
    const { OtelReporter } = await import('./reporter');
    const reporter = new OtelReporter();

    const moduleA = { moduleId: 'a.test.ts' } as any;

    const suiteInA = makeTestSuite({ id: 'suite-a', name: 'suite a', moduleId: 'a.test.ts' });
    const suiteInB = makeTestSuite({ id: 'suite-b', name: 'suite b', moduleId: 'b.test.ts' });

    reporter.onTestSuiteReady!(suiteInA);
    reporter.onTestSuiteReady!(suiteInB);

    reporter.onTestModuleEnd!(moduleA);

    expect(spans).toHaveLength(2);
    expect(spans[0].end).toHaveBeenCalledTimes(1);
    expect(spans[1].end).not.toHaveBeenCalled();
  });
});
