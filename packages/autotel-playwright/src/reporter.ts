/**
 * Optional Playwright reporter that creates OTel spans for each test and step.
 * Runs in the runner process; ensure autotel.init() is called in globalSetup so spans are exported.
 *
 * Use when you want test/step timing and hierarchy in OTLP from the runner side.
 * For "test → API" in one trace (worker side), use the test fixture and requestWithTrace.
 *
 * @example
 * // playwright.config.ts
 * import { defineConfig } from '@playwright/test';
 *
 * export default defineConfig({
 *   reporter: [['list'], ['autotel-playwright/reporter']],
 *   globalSetup: './globalSetup.ts', // must call init()
 * });
 */

import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';
import { getTracer, context as otelContext, otelTrace, SpanStatusCode } from 'autotel';

const TRACER_NAME = 'playwright-reporter';
const TRACER_VERSION = '0.1.0';

function testKey(test: TestCase): string {
  return test.id;
}

/** Convert Playwright TestError (no `name` field) to a standard Error for OTel. */
function toError(testError: { message?: string; stack?: string }): Error {
  const err = new Error(testError.message ?? 'Unknown error');
  if (testError.stack) err.stack = testError.stack;
  return err;
}

/**
 * Playwright Reporter that creates one span per test and one per step (as children).
 * Requires autotel.init() in globalSetup so spans are exported.
 */
class OtelReporter implements Reporter {
  private testSpans = new Map<string, ReturnType<ReturnType<typeof getTracer>['startSpan']>>();
  private stepSpans = new WeakMap<TestStep, ReturnType<ReturnType<typeof getTracer>['startSpan']>>();

  onTestBegin(test: TestCase, _result: TestResult): void {
    const tracer = getTracer(TRACER_NAME, TRACER_VERSION);
    const span = tracer.startSpan(`e2e:${test.title}`, {
      attributes: {
        'test.title': test.title,
        'test.file': test.location?.file ?? '',
        'test.line': test.location?.line ?? 0,
      },
    });
    this.testSpans.set(testKey(test), span);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const key = testKey(test);
    const span = this.testSpans.get(key);
    if (span) {
      if (result.status !== 'passed' && result.status !== 'skipped') {
        span.setStatus({ code: SpanStatusCode.ERROR });
        if (result.error) span.recordException(toError(result.error));
      }
      span.end();
      this.testSpans.delete(key);
    }
  }

  onStepBegin(test: TestCase, _result: TestResult, step: TestStep): void {
    const testSpan = this.testSpans.get(testKey(test));
    if (!testSpan) return;
    otelContext.with(otelTrace.setSpan(otelContext.active(), testSpan), () => {
      const tracer = getTracer(TRACER_NAME, TRACER_VERSION);
      const span = tracer.startSpan(`step:${step.title}`, {
        attributes: { 'step.name': step.title },
      });
      this.stepSpans.set(step, span);
    });
  }

  onStepEnd(_test: TestCase, result: TestResult, step: TestStep): void {
    const span = this.stepSpans.get(step);
    if (span) {
      if (step.error) {
        span.recordException(toError(step.error));
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      span.end();
      this.stepSpans.delete(step);
    }
  }

  onBegin?(_config: FullConfig, _suite: Suite): void {}
  onEnd?(_result: FullResult): void {}
}

export { OtelReporter };
export default OtelReporter;
