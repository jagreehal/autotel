import { describe, it, expect, beforeAll } from 'vitest';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { trace } from './functional';
import { init } from './init';
import { flush } from './shutdown';
import type { Sampler } from './sampling';

// Its own file: init() registers one provider per process.

/** Keeps only the span named `parent`, deciding at the head. */
const keepParentOnly: Sampler = {
  shouldSample: ({ operationName }) => operationName === 'parent',
};

describe("trace()'s own head decision and the parent's", () => {
  const exporter = new InMemorySpanExporter();
  beforeAll(() => {
    init({
      service: 'wrapper-parent-sampler-test',
      sampler: keepParentOnly,
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
  });

  it('keeps a trace() child its sampler rejects when the parent was kept', async () => {
    await trace.run('parent', () => trace.run('child', async () => {}));
    await flush();
    expect(exporter.getFinishedSpans().map((s) => s.name)).toEqual([
      'child',
      'parent',
    ]);
  });
});
