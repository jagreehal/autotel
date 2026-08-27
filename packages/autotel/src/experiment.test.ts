import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { experiment } from './experiment';
import { instrument } from './functional';
import { init } from './init';

/**
 * Observed through exported spans rather than `createTraceCollector()`, which
 * swaps in mock spans backed by its own storage and so cannot prove which span
 * the OpenTelemetry context was bound to.
 */
describe('experiment()', () => {
  const exporter = new InMemorySpanExporter();

  beforeAll(() => {
    init({
      service: 'experiment-test',
      sampling: 'development',
      spanProcessor: new SimpleSpanProcessor(exporter),
    });
  });

  beforeEach(() => {
    exporter.reset();
  });

  const spanNamed = (name: string) =>
    exporter.getFinishedSpans().find((s) => s.name === name);

  it('names the experiment and the variant on the running span', async () => {
    const checkout = instrument({
      key: 'checkout',
      fn: async () => {
        experiment({ name: 'checkout-pricing', variant: 'v2' });
        return 'ok';
      },
    });

    await checkout();

    await expect
      .poll(() => spanNamed('checkout')?.attributes['experiment.name'])
      .toBe('checkout-pricing');
    expect(spanNamed('checkout')?.attributes['experiment.variant']).toBe('v2');
  });

  it('records the expectation, so a reader knows what was being claimed', async () => {
    const checkout = instrument({
      key: 'checkout.expectation',
      fn: async () => {
        experiment({
          name: 'checkout-pricing',
          variant: 'v2',
          expect: 'p95 drops, conversion holds',
        });
      },
    });

    await checkout();

    await expect
      .poll(
        () =>
          spanNamed('checkout.expectation')?.attributes[
            'experiment.expectation'
          ],
      )
      .toBe('p95 drops, conversion holds');
  });

  it('stays quiet when nothing is being traced', () => {
    expect(() =>
      experiment({ name: 'checkout-pricing', variant: 'v2' }),
    ).not.toThrow();
  });

  it('reaches the span from a helper several frames inside the traced body', async () => {
    const applyPricing = () => {
      experiment({ name: 'checkout-pricing', variant: 'v2' });
      return 12;
    };
    const checkout = instrument({
      key: 'checkout.nested',
      fn: async () => applyPricing(),
    });

    await checkout();

    await expect
      .poll(() => spanNamed('checkout.nested')?.attributes['experiment.name'])
      .toBe('checkout-pricing');
  });
});
