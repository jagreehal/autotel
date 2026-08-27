import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { TailSamplingSpanProcessor } from './tail-sampling-processor';
import { instrument, withBaggage } from './functional';
import { init } from './init';
import type { Sampler } from './sampling';

const dropEverything: Sampler = {
  shouldSample: () => true,
  needsTailSampling: () => true,
  shouldKeepTrace: () => false,
};

/** The load-bearing property: nothing is deployed to turn this on. */
describe('debug capture through baggage', () => {
  const exporter = new InMemorySpanExporter();

  beforeAll(() => {
    init({
      service: 'debug-capture-test',
      spanProcessor: new TailSamplingSpanProcessor(
        new SimpleSpanProcessor(exporter),
      ),
    });
  });

  beforeEach(() => exporter.reset());

  const names = () => exporter.getFinishedSpans().map((s) => s.name);

  it('keeps a trace the sampler dropped when the request carries the debug flag', async () => {
    const checkout = instrument({
      key: 'checkout.debugged',
      fn: async () => {},
      sampler: dropEverything,
    });
    const marker = instrument({ key: 'marker.debug', fn: async () => {} });

    await withBaggage({
      baggage: { 'autotel.debug': '1' },
      fn: async () => {
        await checkout();
      },
    });
    await marker();

    await expect.poll(() => names()).toContain('marker.debug');
    expect(names()).toContain('checkout.debugged');
  });

  it('leaves sampling alone when the request does not carry it', async () => {
    const checkout = instrument({
      key: 'checkout.undebugged',
      fn: async () => {},
      sampler: dropEverything,
    });
    const marker = instrument({ key: 'marker.plain', fn: async () => {} });

    await checkout();
    await marker();

    await expect.poll(() => names()).toContain('marker.plain');
    expect(names()).not.toContain('checkout.undebugged');
  });
});
