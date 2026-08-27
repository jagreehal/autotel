import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { TailSamplingSpanProcessor } from './tail-sampling-processor';
import { forceKeep } from './force-keep';
import { instrument } from './functional';
import { init } from './init';
import type { Sampler } from './sampling';

/**
 * Observed through what survives the tail sampling processor, which is the
 * boundary deciding whether a trace reaches a backend.
 *
 * The sampler is passed per wrapper rather than to `init()`: the tracing
 * wrapper reads `options.sampler` and falls back to `AlwaysSampler`, so a
 * sampler given to `init()` never reaches this decision.
 */
const dropEverything: Sampler = {
  shouldSample: () => true,
  needsTailSampling: () => true,
  shouldKeepTrace: () => false,
};

describe('forceKeep()', () => {
  const exporter = new InMemorySpanExporter();

  beforeAll(() => {
    init({
      service: 'force-keep-test',
      spanProcessor: new TailSamplingSpanProcessor(
        new SimpleSpanProcessor(exporter),
      ),
    });
  });

  beforeEach(() => {
    exporter.reset();
  });

  const names = () => exporter.getFinishedSpans().map((s) => s.name);

  it('drops a span when the sampler decides against it', async () => {
    const dropped = instrument({
      key: 'checkout.dropped',
      fn: async () => {},
      sampler: dropEverything,
    });
    // A span that always survives, so absence is read after export has run
    // rather than before it started.
    const marker = instrument({ key: 'marker.one', fn: async () => {} });

    await dropped();
    await marker();

    await expect.poll(() => names()).toContain('marker.one');
    expect(names()).not.toContain('checkout.dropped');
  });

  it('keeps a span the sampler decided against', async () => {
    const kept = instrument({
      key: 'checkout.kept',
      fn: async () => {
        forceKeep();
      },
      sampler: dropEverything,
    });
    const marker = instrument({ key: 'marker.two', fn: async () => {} });

    await kept();
    await marker();

    await expect.poll(() => names()).toContain('marker.two');
    expect(names()).toContain('checkout.kept');
  });
});
