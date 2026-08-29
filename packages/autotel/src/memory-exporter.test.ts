import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { createMemoryExporter } from './memory-exporter';
import { ctx, instrument } from './functional';
import { trace } from './trace-hybrid';
import { init } from './init';

/**
 * Reading back what a backend would have received, without writing a span
 * exporter by hand and without depending on the OpenTelemetry SDK types.
 */
describe('createMemoryExporter()', () => {
  const exporter = createMemoryExporter();

  beforeAll(() => {
    init({
      service: 'memory-exporter-test',
      spanProcessor: new SimpleSpanProcessor(exporter),
    });
  });

  beforeEach(() => {
    exporter.reset();
  });

  it('records finished spans as plain objects', async () => {
    const charge = instrument({
      key: 'checkout.charge',
      fn: async () => 'ok',
    });

    await charge();

    await expect.poll(() => exporter.spans().length).toBe(1);
    const [span] = exporter.spans();
    expect(span?.name).toBe('checkout.charge');
    expect(span?.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('finds a span by name and reads its attributes', async () => {
    const charge = trace('checkout.attributed', async () => {
      ctx.setAttribute('payment.provider', 'stripe');
    });

    await charge();

    await expect
      .poll(() => exporter.findSpan('checkout.attributed')?.attributes)
      .toMatchObject({ 'payment.provider': 'stripe' });
  });

  it('reset() empties what it has collected', async () => {
    const noop = instrument({ key: 'checkout.reset', fn: async () => {} });
    await noop();
    await expect.poll(() => exporter.spans().length).toBe(1);

    exporter.reset();

    expect(exporter.spans()).toEqual([]);
  });
});
