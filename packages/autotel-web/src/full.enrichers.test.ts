// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { SpanKind, trace as otelTrace } from '@opentelemetry/api';
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace';
import { initFull, resetFullForTesting, span } from './full';

afterEach(() => {
  resetFullForTesting();
});

function recorder(): SpanProcessor & { seen: ReadableSpan[] } {
  const seen: ReadableSpan[] = [];
  return {
    seen,
    onStart() {},
    onEnd(s) {
      seen.push(s);
    },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}

describe('spanEnrichers', () => {
  it('adds to the pipeline instead of replacing the exporter', () => {
    // `spanProcessor` replaces everything autotel wired, so anyone passing an
    // enricher there loses their export and does not find out until no spans
    // arrive. Enrichers have to be a separate door.
    const enricher = recorder();
    const exporterSide = recorder();

    initFull({
      service: 'web',
      spanProcessor: exporterSide,
      spanEnrichers: [enricher],
    });

    span('checkout', () => undefined);

    expect(enricher.seen.map((s) => s.name)).toContain('checkout');
    expect(exporterSide.seen.map((s) => s.name)).toContain('checkout');
  });

  it('runs an enricher before the exporter, not after', () => {
    // Both processors are handed the same span object, so mutating it proves
    // nothing about order — the call sequence is the thing that decides whether
    // an added attribute is one the exporter actually sends.
    const calls: string[] = [];
    const named = (label: string): SpanProcessor => ({
      onStart() {},
      onEnd(s) {
        if (s.name === 'checkout') calls.push(label);
      },
      forceFlush: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
    });

    initFull({
      service: 'web',
      spanProcessor: named('exporter'),
      spanEnrichers: [named('enricher')],
    });

    span('checkout', () => undefined);

    expect(calls).toEqual(['enricher', 'exporter']);
  });
});

describe('client span names', () => {
  it('names a fetch or XHR span `{method} {url.template}`', () => {
    const exporterSide = recorder();
    initFull({
      service: 'web',
      spanProcessor: exporterSide,
      urlIdPatterns: [/^ord_\w+$/],
    });

    // The shape the fetch and XHR instrumentations start a span with.
    otelTrace
      .getTracer('instrumentation-fetch')
      .startSpan('GET', {
        kind: SpanKind.CLIENT,
        attributes: {
          'http.request.method': 'GET',
          'url.full':
            'https://api.example.com/clients/42/orders/ord_9f2k?limit=5',
        },
      })
      .end();

    const [span] = exporterSide.seen;
    expect(span!.name).toBe('GET /clients/:id/orders/:id');
    expect(span!.attributes['url.template']).toBe('/clients/:id/orders/:id');
  });

  it('keeps the method alone for a path with no id in it', () => {
    const exporterSide = recorder();
    initFull({ service: 'web', spanProcessor: exporterSide });

    otelTrace
      .getTracer('instrumentation-fetch')
      .startSpan('GET', {
        kind: SpanKind.CLIENT,
        attributes: {
          'http.request.method': 'GET',
          'url.full': 'https://api.example.com/users/jane-doe/settings',
        },
      })
      .end();

    const [span] = exporterSide.seen;
    expect(span!.name).toBe('GET');
    expect(span!.attributes['url.template']).toBeUndefined();
  });
});
