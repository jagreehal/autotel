import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpanStatusCode, trace as otelTrace } from '@opentelemetry/api';
import { trace, withTracing } from './functional';
import { createTraceCollector } from './testing';

const ERROR = { code: SpanStatusCode.ERROR };

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * `trace(name, fn)` wraps a plain function. Called with the factory form,
 * `trace(name, ctx => async () => ...)`, the wrapper hands back the inner
 * function without running it.
 */
describe('trace() with a ctx factory', () => {
  const warned = (warn: ReturnType<typeof vi.spyOn>) =>
    warn.mock.calls.filter(([message]: unknown[]) =>
      String(message).includes('withTracing'),
    );

  it('warns once when the wrapper is called bare and returns a function', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createTraceCollector();
    // TypeScript rejects calling this wrapper bare; JavaScript, where the
    // reported code ran, does not.
    const handler = trace(
      'factory.form',
      (_ctx: unknown) => async () => 'ok',
    ) as unknown as () => unknown;

    handler();
    handler();

    expect(warned(warn)).toHaveLength(1);
    expect(String(warned(warn)[0]![0])).toContain('factory.form');
  });

  it('stays quiet for a curried function called with its argument', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createTraceCollector();
    const makeGreeter = trace('make.greeter', (greeting: string) => {
      return (name: string) => `${greeting} ${name}`;
    });

    expect(makeGreeter('hi')('jo')).toBe('hi jo');
    expect(warned(warn)).toHaveLength(0);
  });

  it('stays quiet for the factory form under withTracing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createTraceCollector();
    const handler = withTracing({ name: 'with.tracing' })(
      (_ctx) => async () => 'ok',
    );

    await expect(handler()).resolves.toBe('ok');
    expect(warned(warn)).toHaveLength(0);
  });
});

/**
 * A wrapper marks a returned (not thrown) result OK unless the body chose a
 * status. A status set with the plain OpenTelemetry API is a choice too.
 */
describe('a status set on the span directly', () => {
  it('survives a returned result', async () => {
    const collector = createTraceCollector();
    const work = trace('raw.status', async () => {
      otelTrace.getActiveSpan()?.setStatus(ERROR);
      return 'ok';
    });

    await work();

    expect(collector.getSpansByName('raw.status')[0]?.status.code).toBe(
      SpanStatusCode.ERROR,
    );
  });
});
