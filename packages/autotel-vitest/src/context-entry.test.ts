import type { TaskMeta } from 'vitest';
/**
 * Guards the one thing that makes the fixture's promise true: the test span has
 * to be the active context *inside the test body*, so instrumented calls parent
 * to it. Vitest resolves `use()` from the runner rather than from the fixture's
 * own call stack, so wrapping `use()` in `context.with()` does not reach the
 * body. The fixture enters the context on the async resource instead.
 *
 * If that regresses, every span a test records starts its own trace and
 * `task.meta.otelSpans` goes empty.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, it, vi } from 'vitest';

const storage = new AsyncLocalStorage<unknown>();
const TEST_CONTEXT = { marker: 'test-span-context' };

let exposeContextManager = true;

vi.mock('autotel', () => ({
  SpanStatusCode: { UNSET: 0, OK: 1, ERROR: 2 },
  context: {
    active: () => ({}),
    // Deliberately a no-op wrapper: if the fixture falls back to this path when
    // an AsyncLocalStorage is available, the assertion below catches it.
    with: (_ctx: never, fn: () => Promise<void>) => fn(),
    _getContextManager: () =>
      exposeContextManager ? { _asyncLocalStorage: storage } : undefined,
  },
  getTracer: () => ({
    startSpan: () => ({
      end: vi.fn(),
      recordException: vi.fn(),
      setStatus: vi.fn(),
      spanContext: () => ({ traceId: 'trace', spanId: 'span' }),
    }),
  }),
  otelTrace: { setSpan: () => TEST_CONTEXT },
  flush: vi.fn(async () => {}),
  getAutotelTracerProvider: vi.fn(() => ({})),
  getTraceContext: vi.fn(() => null),
  resolveTraceUrl: vi.fn(() => undefined),
  isTracing: vi.fn(() => false),
  enrichWithTraceContext: vi.fn((obj: Record<string, string>) => obj),
}));

vi.mock('autotel/test-span-collector', () => ({
  TestSpanCollector: class {
    export = vi.fn();
    drainTrace = vi.fn(() => []);
    peekTrace = vi.fn(() => []);
    shutdown = vi.fn(() => Promise.resolve());
    forceFlush = vi.fn(() => Promise.resolve());
  },
}));

vi.mock('autotel/processors', () => ({
  SimpleSpanProcessor: class {},
}));

// SAFETY: an empty meta is what vitest hands a task before anything writes to
// it; every field on TaskMeta is optional.
const task = { name: 'a test', meta: {} as TaskMeta };

async function runFixture(body: () => void) {
  const { otelTestSpanFixture } = await import('./fixture');
  const [fixtureFn] = otelTestSpanFixture;
  await fixtureFn({ task }, async () => body());
}

describe('fixture context entry', () => {
  it('makes the test span context visible to the test body', async () => {
    exposeContextManager = true;
    let seen: unknown;
    await runFixture(() => {
      seen = storage.getStore();
    });
    expect(seen).toBe(TEST_CONTEXT);
  });

  it('falls back to context.with when no AsyncLocalStorage is exposed', async () => {
    exposeContextManager = false;
    let ran = false;
    await runFixture(() => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
