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
import { otelTestSpanFixture } from './fixture';

export const test = base.extend({
  _otelTestSpan: otelTestSpanFixture as never,
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
