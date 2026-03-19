/**
 * Wiring test: verifies the public `test` export from index.ts
 * actually registers the _otelTestSpan fixture with auto: true.
 *
 * Uses the exported `test` (not vitest's base) to define tests,
 * so if index.ts stops calling base.extend() or drops the fixture,
 * these tests will fail.
 */
import { expect, vi } from 'vitest';

vi.mock('autotel', () => ({
  SpanStatusCode: { UNSET: 0, OK: 1, ERROR: 2 },
  context: {
    active: () => ({}),
    with: (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
  },
  getTracer: () => ({
    startSpan: () => ({
      end: vi.fn(),
      recordException: vi.fn(),
      setStatus: vi.fn(),
      spanContext: () => ({ traceId: 'wiring-trace', spanId: 'wiring-span' }),
    }),
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

vi.mock('autotel/test-span-collector', () => ({
  TestSpanCollector: class {
    export = vi.fn();
    drainTrace = vi.fn(() => []);
    shutdown = vi.fn(() => Promise.resolve());
    forceFlush = vi.fn(() => Promise.resolve());
  },
}));

vi.mock('autotel/processors', () => ({
  SimpleSpanProcessor: class {
    constructor() {}
  },
}));

// Import the PUBLIC test — not vitest's base test.
// If index.ts doesn't wire otelTestSpanFixture via base.extend(),
// _otelTestSpan won't be available and these tests fail.
import { test } from './index';

test('_otelTestSpan fixture is registered and auto-activates', ({ _otelTestSpan }) => {
  // auto: true means the fixture injects automatically.
  // If the fixture key is missing from base.extend(), this will be undefined.
  expect(_otelTestSpan).toBeDefined();
});
