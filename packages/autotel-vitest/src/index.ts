/**
 * autotel-vitest
 *
 * Vitest fixture that creates one OTel span per test so all autotel-instrumented
 * code executed during a test automatically creates child spans under it;
 * making every test run filterable in your OTLP backend.
 *
 * @example
 * // vitest.config.ts: globalSetup calls init({ service: 'unit-tests' })
 * // In spec:
 * import { test, expect } from 'autotel-vitest';
 * test('creates user', async () => {
 *   await userService.createUser({ email: 'test@example.com' });
 *   // All trace()/span() calls become children of the test span
 * });
 */

import { test as base } from 'vitest';
import {
  getTracer,
  getAutotelTracerProvider,
  context as otelContext,
  otelTrace,
  SpanStatusCode,
} from 'autotel';
import { TestSpanCollector } from 'autotel/test-span-collector';
import { SimpleSpanProcessor } from 'autotel/processors';

const TRACER_NAME = 'vitest-tests';
const TRACER_VERSION = '0.1.0';

let collector: TestSpanCollector | null = null;

function ensureCollector(): TestSpanCollector {
  if (!collector) {
    collector = new TestSpanCollector();
    const provider = getAutotelTracerProvider();
    if ('addSpanProcessor' in provider) {
      (provider as any).addSpanProcessor(new SimpleSpanProcessor(collector));
    }
  }
  return collector;
}

export const test = base.extend({
  _otelTestSpan: [
    async ({ task }, use) => {
      ensureCollector();
      const tracer = getTracer(TRACER_NAME, TRACER_VERSION);
      const span = tracer.startSpan(`test:${task.name}`, {
        attributes: {
          'test.name': task.name,
          'test.file': task.file?.name ?? '',
          'test.suite': task.suite?.name ?? '',
        },
      });
      const ctx = otelTrace.setSpan(otelContext.active(), span);
      try {
        await otelContext.with(ctx, () => use(span));
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        throw error;
      } finally {
        span.end();
        const traceId = span.spanContext().traceId;
        const rootSpanId = span.spanContext().spanId;
        const spans = collector!.drainTrace(traceId, rootSpanId);
        if (spans.length > 0) {
          (task.meta as Record<string, unknown>).otelSpans = spans;
        }
      }
    },
    { auto: true },
  ],
});

export { expect, describe, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

// Re-export all autotel/testing utilities
export {
  createTraceCollector,
  assertTraceCreated,
  assertTraceSucceeded,
  assertTraceFailed,
  assertNoErrors,
  assertTraceDuration,
  waitForTrace,
  getTraceDuration,
  createMockLogger,
  type TraceCollector,
  type TestSpan,
  type LogCollector,
  type LogEntry,
} from 'autotel/testing';

// Re-export trace context helpers for DX convenience
export {
  getTraceContext,
  resolveTraceUrl,
  isTracing,
  enrichWithTraceContext,
} from 'autotel';

export type { OtelTraceContext } from 'autotel';
