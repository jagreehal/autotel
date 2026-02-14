/**
 * Optional Vitest reporter that creates OTel spans for each test and suite.
 * Runs in the runner process; ensure autotel.init() is called in globalSetup so spans are exported.
 *
 * Use when you want test/suite timing and hierarchy in OTLP from the runner side.
 * For "test → instrumented code" in one trace (worker side), use the test fixture.
 *
 * @example
 * // vitest.config.ts
 * import { defineConfig } from 'vitest/config';
 *
 * export default defineConfig({
 *   test: {
 *     reporters: ['default', 'autotel-vitest/reporter'],
 *     globalSetup: './globalSetup.ts', // must call init()
 *   },
 * });
 */

import type { Reporter, TestCase, TestModule, TestSuite } from 'vitest/node';
import { getTracer, SpanStatusCode } from 'autotel';

const TRACER_NAME = 'vitest-reporter';
const TRACER_VERSION = '0.1.0';

type SpanEntry = {
  span: ReturnType<ReturnType<typeof getTracer>['startSpan']>;
  moduleId: string;
};

/** Convert a vitest TestError-like object to a standard Error for OTel. */
function toError(testError: { message?: string; stack?: string }): Error {
  const err = new Error(testError.message ?? 'Unknown error');
  if (testError.stack) err.stack = testError.stack;
  return err;
}

/**
 * Vitest Reporter that creates one span per test and one per suite (as parents).
 * Requires autotel.init() in globalSetup so spans are exported.
 */
class OtelReporter implements Reporter {
  private testSpans = new Map<string, SpanEntry>();
  private suiteSpans = new Map<string, SpanEntry>();

  onTestCaseReady(testCase: TestCase): void {
    const tracer = getTracer(TRACER_NAME, TRACER_VERSION);
    const moduleId = testCase.module.moduleId ?? '';
    const span = tracer.startSpan(`test:${testCase.name}`, {
      attributes: {
        'test.name': testCase.name,
        'test.fullName': testCase.fullName,
        'test.file': moduleId,
      },
    });
    this.testSpans.set(testCase.id, { span, moduleId });
  }

  onTestCaseResult(testCase: TestCase): void {
    const entry = this.testSpans.get(testCase.id);
    if (!entry) return;

    const result = testCase.result();
    if (result.state === 'failed') {
      entry.span.setStatus({ code: SpanStatusCode.ERROR });
      if (result.errors && result.errors.length > 0) {
        for (const error of result.errors) {
          entry.span.recordException(toError(error));
        }
      }
    }
    entry.span.end();
    this.testSpans.delete(testCase.id);
  }

  onTestSuiteReady(testSuite: TestSuite): void {
    const tracer = getTracer(TRACER_NAME, TRACER_VERSION);
    const moduleId = testSuite.module.moduleId ?? '';
    const span = tracer.startSpan(`suite:${testSuite.name}`, {
      attributes: {
        'suite.name': testSuite.name,
        'suite.file': moduleId,
      },
    });
    this.suiteSpans.set(testSuite.id, { span, moduleId });
  }

  onTestSuiteResult(testSuite: TestSuite): void {
    const entry = this.suiteSpans.get(testSuite.id);
    if (!entry) return;

    const state = testSuite.state();
    if (state === 'failed') {
      entry.span.setStatus({ code: SpanStatusCode.ERROR });
    }
    entry.span.end();
    this.suiteSpans.delete(testSuite.id);
  }

  onTestModuleEnd(testModule: TestModule): void {
    const moduleId = testModule.moduleId;
    // Clean up any remaining spans for this specific module
    for (const [key, entry] of this.testSpans) {
      if (entry.moduleId === moduleId) {
        entry.span.end();
        this.testSpans.delete(key);
      }
    }
    for (const [key, entry] of this.suiteSpans) {
      if (entry.moduleId === moduleId) {
        entry.span.end();
        this.suiteSpans.delete(key);
      }
    }
  }
}

export { OtelReporter };
export default OtelReporter;
