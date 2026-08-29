import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { TailSamplingSpanProcessor } from './tail-sampling-processor';
import { instrument } from './functional';
import { init } from './init';
import type { Sampler } from './sampling';

/**
 * A sampler given to `init()` has to govern the functions the app wraps.
 * Without this, `init({ sampling: 'production' })` reads as configured while
 * every wrapped span is still exported, and the bill is the only signal.
 */
const dropEverything: Sampler = {
  shouldSample: () => true,
  needsTailSampling: () => true,
  shouldKeepTrace: () => false,
};

const keepEverything: Sampler = {
  shouldSample: () => true,
  needsTailSampling: () => true,
  shouldKeepTrace: () => true,
};

describe('sampler configured on init()', () => {
  const exporter = new InMemorySpanExporter();

  beforeAll(() => {
    init({
      service: 'init-sampler-test',
      sampler: dropEverything,
      spanProcessor: new TailSamplingSpanProcessor(
        new SimpleSpanProcessor(exporter),
      ),
    });
  });

  beforeEach(() => {
    exporter.reset();
  });

  const names = () => exporter.getFinishedSpans().map((s) => s.name);

  it('governs a wrapper that was given no sampler of its own', async () => {
    const wrapped = instrument({ key: 'checkout.default', fn: async () => {} });
    const marker = instrument({
      key: 'marker.one',
      fn: async () => {},
      sampler: keepEverything,
    });

    await wrapped();
    await marker();

    await expect.poll(() => names()).toContain('marker.one');
    expect(names()).not.toContain('checkout.default');
  });

  it('yields to a sampler passed at the wrapper', async () => {
    const wrapped = instrument({
      key: 'checkout.explicit',
      fn: async () => {},
      sampler: keepEverything,
    });

    await wrapped();

    await expect.poll(() => names()).toContain('checkout.explicit');
  });
});
