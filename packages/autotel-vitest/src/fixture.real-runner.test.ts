/**
 * The fixture under the real vitest runner, with a real autotel provider.
 *
 * `src/context-entry.test.ts` drives the fixture function directly, and its
 * test body runs on the fixture's own call stack — so it cannot see the thing
 * that actually breaks here: vitest resolves `use()` from the runner, and the
 * context has to be entered on the async resource the runner shares with the
 * fixture, before the fixture awaits anything at all. Await first and the test
 * body inherits nothing, every instrumented call starts its own trace, and the
 * mocked harness still passes.
 */
import { expect } from 'vitest';
import { context as otelContext, flush, init, otelTrace, trace } from 'autotel';
import { createMemoryExporter } from 'autotel/testing';

import { test } from './index';

const exporter = createMemoryExporter();

init({
  service: 'fixture-real-runner',
  spanExporters: [exporter],
  debug: false,
});

const INVALID_TRACE_ID = '0'.repeat(32);

test('the test body runs inside the test span', () => {
  const active = otelTrace.getSpanContext(otelContext.active());

  expect(active?.traceId).toMatch(/^[\da-f]{32}$/);
  expect(active?.traceId).not.toBe(INVALID_TRACE_ID);
});

test('instrumented code in the test body joins the test trace', async () => {
  const testTraceId = otelTrace.getSpanContext(otelContext.active())?.traceId;

  await trace.run('work', async () => {});
  await flush();

  const work = exporter.findSpan('work');
  expect(work).toBeDefined();
  // The whole promise of the package: a span recorded during a test belongs to
  // that test's trace, so a run is filterable by test in the backend.
  expect(work!.traceId).toBe(testTraceId);
  expect(work!.parentSpanId).toBeDefined();
});
