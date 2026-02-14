import { afterEach, describe, it, expect, vi } from 'vitest';

const spans: Array<{ end: ReturnType<typeof vi.fn> }> = [];

vi.mock('autotel', () => ({
  SpanStatusCode: { ERROR: 2 },
  context: {
    active: () => ({}),
    with: (_ctx: unknown, fn: () => void) => fn(),
  },
  getTracer: () => ({
    startSpan: () => {
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

describe('OtelReporter', () => {
  afterEach(() => {
    spans.length = 0;
    vi.resetModules();
  });

  it('tracks same file/line/title tests independently (no key collisions)', async () => {
    const { OtelReporter } = await import('./reporter');
    const reporter = new OtelReporter();

    const testA = {
      id: 'project-a-id',
      title: 'shared title',
      location: { file: 'e2e/spec.ts', line: 7 },
    } as any;
    const testB = {
      id: 'project-b-id',
      title: 'shared title',
      location: { file: 'e2e/spec.ts', line: 7 },
    } as any;

    reporter.onTestBegin(testA, {} as any);
    reporter.onTestBegin(testB, {} as any);

    reporter.onTestEnd(testA, { status: 'passed' } as any);

    expect(spans).toHaveLength(2);
    expect(spans[0].end).toHaveBeenCalledTimes(1);
    expect(spans[1].end).not.toHaveBeenCalled();
  });

  it('marks a step span as error when step.error exists even if result.status is passed', async () => {
    const { OtelReporter } = await import('./reporter');
    const reporter = new OtelReporter();

    const test = {
      id: 'project-a-id',
      title: 'step failure case',
      location: { file: 'e2e/spec.ts', line: 12 },
    } as any;

    const step = {
      title: 'failing step',
      error: { message: 'boom', stack: 'stack' },
    } as any;

    reporter.onTestBegin(test, {} as any);
    reporter.onStepBegin(test, {} as any, step);
    reporter.onStepEnd(test, { status: 'passed' } as any, step);

    const stepSpan = spans[1] as any;
    expect(stepSpan.recordException).toHaveBeenCalled();
    expect(stepSpan.setStatus).toHaveBeenCalledWith({ code: 2 });
  });
});
