/**
 * A wrapper is usually created at module load, before anything has configured
 * a tracer, so `configure({ tracer })` after the wrap, which is what
 * `createTraceCollector()` calls, must reach wrappers that already exist.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { trace, withTracing } from './functional';
import { resetConfig } from './config';
import { createTraceCollector } from './testing';

afterEach(() => resetConfig());

describe('tracer resolution', () => {
  it('trace(name, fn) wrapped before createTraceCollector() still records', async () => {
    const wrapped = trace('early', async (n: number) => n * 2);

    const collector = createTraceCollector();
    await expect(wrapped(21)).resolves.toBe(42);

    expect(collector.getSpansByName('early')).toHaveLength(1);
  });

  it('withTracing() wrapped before createTraceCollector() still records', async () => {
    const wrapped = withTracing({ name: 'early.factory' })(
      (ctx) => async () => ctx.setAttribute('seen', true),
    );

    const collector = createTraceCollector();
    await wrapped();

    expect(collector.expectSpan('early.factory').attributes).toMatchObject({
      seen: true,
    });
  });
});
