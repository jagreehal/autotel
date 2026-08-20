import { afterEach, describe, it, expect, vi } from 'vitest';

import type { TestCase, TestResult, TestStep } from '@playwright/test/reporter';

/** A span the faked tracer handed out, so a test can see what happened to it. */
interface RecordedSpan {
  end: ReturnType<typeof vi.fn>;
  recordException: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
}

const spans: Array<RecordedSpan> = [];

// The reporter reaches for autotel's tracer at module scope, which is what a
// Playwright reporter has to do - it is constructed by Playwright, not by us -
// so the tracer is supplied here rather than injected.
vi.mock('autotel', () => ({
  SpanStatusCode: { ERROR: 2 },
  context: {
    active: () => ({}),
    with: (_ctx: never, fn: () => void) => fn(),
  },
  getTracer: () => ({
    startSpan: () => {
      const span: RecordedSpan = {
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

/**
 * Playwright builds these itself and its types describe far more than a
 * reporter ever reads. Each factory names the fields the reporter does read,
 * and states that once, rather than at every call site.
 */
function testCase(fields: {
  id: string;
  title: string;
  line: number;
}): TestCase {
  // SAFETY: OtelReporter reads id, title and location.{file,line} from a test
  // case and nothing else; the rest of TestCase is unreachable from these paths.
  return {
    id: fields.id,
    title: fields.title,
    location: { file: 'e2e/spec.ts', line: fields.line, column: 1 },
  } as TestCase;
}

function testResult(status: TestResult['status'] = 'passed'): TestResult {
  // SAFETY: only `status` is read from a result on the paths under test.
  return { status } as TestResult;
}

function testStep(fields: {
  title: string;
  error?: { message: string; stack: string };
}): TestStep {
  // SAFETY: only `title` and `error` are read from a step.
  return fields as TestStep;
}

describe('OtelReporter', () => {
  afterEach(() => {
    spans.length = 0;
    vi.resetModules();
  });

  it('tracks same file/line/title tests independently (no key collisions)', async () => {
    const { OtelReporter } = await import('./reporter');
    const reporter = new OtelReporter();

    const testA = testCase({
      id: 'project-a-id',
      title: 'shared title',
      line: 7,
    });
    const testB = testCase({
      id: 'project-b-id',
      title: 'shared title',
      line: 7,
    });

    reporter.onTestBegin(testA, testResult());
    reporter.onTestBegin(testB, testResult());

    reporter.onTestEnd(testA, testResult());

    expect(spans).toHaveLength(2);
    expect(spans[0]!.end).toHaveBeenCalledTimes(1);
    expect(spans[1]!.end).not.toHaveBeenCalled();
  });

  it('marks a step span as error when step.error exists even if result.status is passed', async () => {
    const { OtelReporter } = await import('./reporter');
    const reporter = new OtelReporter();

    const test = testCase({
      id: 'project-a-id',
      title: 'step failure case',
      line: 12,
    });

    const step = testStep({
      title: 'failing step',
      error: { message: 'boom', stack: 'stack' },
    });

    reporter.onTestBegin(test, testResult());
    reporter.onStepBegin(test, testResult(), step);
    reporter.onStepEnd(test, testResult(), step);

    const stepSpan = spans[1]!;
    expect(stepSpan.recordException).toHaveBeenCalled();
    expect(stepSpan.setStatus).toHaveBeenCalledWith({ code: 2 });
  });
});
