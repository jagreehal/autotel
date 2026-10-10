import { describe, expect, it } from 'vitest';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  InMemorySpanExporter,
  type ReadableSpan,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { EnrichedSpanProcessor } from './enriched-span-processor';

/** Ends a span of its own after the span it saw, like an async judgment. */
function lateSpanEnricher(provider: { current?: BasicTracerProvider }) {
  const pending = new Set<Promise<void>>();
  const enricher: SpanProcessor = {
    onStart() {},
    onEnd(span: ReadableSpan) {
      if (span.name !== 'request') return;
      const job = new Promise<void>((resolve) => setTimeout(resolve, 20)).then(
        () => provider.current!.getTracer('t').startSpan('verdict').end(),
      );
      pending.add(job);
    },
    forceFlush: () => Promise.all(pending).then(() => {}),
    shutdown: () => Promise.all(pending).then(() => {}),
  };
  return enricher;
}

/** Span names exported by the time the provider has shut down. */
async function exportedOnShutdown(
  build: (enricher: SpanProcessor, exporter: SpanProcessor) => SpanProcessor[],
): Promise<string[]> {
  const exporter = new InMemorySpanExporter();
  // Captured as they go: the in-memory exporter clears on shutdown.
  const exported: string[] = [];
  const original = exporter.export.bind(exporter);
  exporter.export = (spans, done) => {
    exported.push(...spans.map((s) => s.name));
    original(spans, done);
  };
  const ref: { current?: BasicTracerProvider } = {};
  const provider = new BasicTracerProvider({
    spanProcessors: build(
      lateSpanEnricher(ref),
      new BatchSpanProcessor(exporter),
    ),
  });
  ref.current = provider;
  provider.getTracer('t').startSpan('request').end();
  await provider.shutdown();
  return exported.toSorted();
}

describe('EnrichedSpanProcessor', () => {
  it('drains enrichers before the exporter shuts down', async () => {
    expect(
      await exportedOnShutdown((enricher, exporter) => [
        new EnrichedSpanProcessor([enricher], [exporter]),
      ]),
    ).toEqual(['request', 'verdict']);
  });

  it('is needed: as siblings, the exporter closes first', async () => {
    expect(
      await exportedOnShutdown((enricher, exporter) => [enricher, exporter]),
    ).toEqual(['request']);
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('enricher failed'))],
    [
      'throws',
      () => {
        throw new Error('enricher failed');
      },
    ],
  ])(
    'still flushes and shuts down the exporters when an enricher %s, then reports it',
    async (_, fail) => {
      const calls: string[] = [];
      const downstream: SpanProcessor = {
        onStart() {},
        onEnd() {},
        forceFlush: async () => void calls.push('flush'),
        shutdown: async () => void calls.push('shutdown'),
      };
      const broken: SpanProcessor = {
        onStart() {},
        onEnd() {},
        forceFlush: fail as () => Promise<void>,
        shutdown: fail as () => Promise<void>,
      };
      const processor = new EnrichedSpanProcessor([broken], [downstream]);
      await expect(processor.forceFlush()).rejects.toThrow('enricher failed');
      await expect(processor.shutdown()).rejects.toThrow('enricher failed');
      expect(calls).toEqual(['flush', 'shutdown']);
    },
  );
});
