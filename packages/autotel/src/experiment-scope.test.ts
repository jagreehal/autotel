import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { experiment } from './experiment';
import { instrument } from './functional';
import { init } from './init';

/**
 * An experiment covers a unit of work, not one function in it. A child span
 * that cannot say which arm it ran under cannot be filtered into a cohort.
 */
describe('experiment() reaches the whole unit of work', () => {
  const exporter = new InMemorySpanExporter();

  beforeAll(() => {
    init({
      service: 'experiment-scope-test',
      // Bare keys rather than the `baggage.` prefix, so the attribute a child
      // span carries is the same one the calling span carries.
      baggage: '',
      spanProcessor: new SimpleSpanProcessor(exporter),
    });
  });

  beforeEach(() => exporter.reset());

  const attributeOn = (name: string, key: string) =>
    exporter.getFinishedSpans().find((s) => s.name === name)?.attributes[key];

  it('reaches a child span started after the call', async () => {
    const priceCart = instrument({ key: 'priceCart', fn: async () => 12 });
    const checkout = instrument({
      key: 'checkout.parent',
      fn: async () => {
        experiment({ name: 'checkout-pricing', variant: 'v2' });
        await priceCart();
      },
    });

    await checkout();

    await expect
      .poll(() => attributeOn('checkout.parent', 'experiment.name'))
      .toBe('checkout-pricing');
    expect(attributeOn('priceCart', 'experiment.name')).toBe(
      'checkout-pricing',
    );
    expect(attributeOn('priceCart', 'experiment.variant')).toBe('v2');
  });
});
