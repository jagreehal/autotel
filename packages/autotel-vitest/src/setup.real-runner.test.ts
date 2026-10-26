/**
 * `autotel-vitest/setup` under the real vitest runner, with a real autotel
 * provider and vitest's own `test`, the way a project that changes no test
 * file uses it. Importing the module here registers its `aroundEach` on this
 * file, which is what listing it in `setupFiles` does for every file.
 */
import { expect, test } from 'vitest';
import {
  context as otelContext,
  flush,
  init,
  otelTrace,
  SpanStatusCode,
  trace,
} from 'autotel';
import { createMemoryExporter } from 'autotel/testing';

import './setup';

const exporter = createMemoryExporter();

init({
  service: 'setup-real-runner',
  spanExporters: [exporter],
  debug: false,
});

test('instrumented code in the test body joins the test trace', async () => {
  const testSpan = otelTrace.getSpanContext(otelContext.active());

  await trace.run('work', async () => {});
  await flush();

  const work = exporter.findSpan('work');
  expect(work?.traceId).toBe(testSpan?.traceId);
  expect(work?.parentSpanId).toBe(testSpan?.spanId);
});

test('the test span is named for the test', () => {
  const span = exporter.findSpan(
    'test:instrumented code in the test body joins the test trace',
  );
  expect(span?.attributes['test.file']).toBe('src/setup.real-runner.test.ts');
});

test.fails('a failing test', () => {
  throw new Error('boom');
});

test('a failed test leaves an error span', () => {
  expect(exporter.findSpan('test:a failing test')?.status.code).toBe(
    SpanStatusCode.ERROR,
  );
});
