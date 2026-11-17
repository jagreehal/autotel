// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  InMemorySpanExporter,
  TracerProvider,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace';
import { exportProcessors, withoutExportRequests } from './full-export';
import { initFull, resetFullForTesting } from './full';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace';

afterEach(() => {
  resetFullForTesting();
  vi.restoreAllMocks();
});

/** An exporter that, like a networked one, starts a request (a span) as it sends. */
function networkedExporter(startRequest: () => boolean) {
  const recorded: boolean[] = [];
  const exporter: SpanExporter = {
    export(_spans: ReadableSpan[], done) {
      recorded.push(startRequest());
      done({ code: 0 });
    },
    shutdown: () => Promise.resolve(),
  };
  return { exporter, recorded };
}

interface ProviderRef {
  current?: TracerProvider;
}

describe('exportProcessors', () => {
  it("keeps an extra exporter's own request out of the traces it sends", async () => {
    const sink = new InMemorySpanExporter();
    // The exporter needs the provider it is part of; filled in just below.
    const providerRef: ProviderRef = {};
    const { exporter, recorded } = networkedExporter(() => {
      const request = providerRef.current!.getTracer('fetch').startSpan('POST');
      request.end();
      return request.isRecording();
    });
    const tracerProvider = new TracerProvider({
      sampler: withoutExportRequests(),
      spanProcessors: [
        ...exportProcessors(undefined, [exporter]),
        new SimpleSpanProcessor({ exporter: sink }),
      ],
    });
    providerRef.current = tracerProvider;

    tracerProvider.getTracer('app').startSpan('checkout').end();
    await tracerProvider.forceFlush();

    expect(recorded).toEqual([false]);
    // Spans outside an export are recorded as usual.
    expect(sink.getFinishedSpans().map((s) => s.name)).toEqual(['checkout']);
  });

  it('builds one processor per destination, none without one', () => {
    const { exporter } = networkedExporter(() => false);
    expect(exportProcessors(undefined)).toHaveLength(0);
    expect(
      exportProcessors('https://otel.example.com', [exporter]),
    ).toHaveLength(2);
  });
});

describe('spanProcessor beside spanExporters', () => {
  it('says the exporters are ignored rather than dropping them silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { exporter } = networkedExporter(() => false);
    initFull({
      service: 'web',
      captureNavigation: false,
      captureFetch: false,
      captureXHR: false,
      spanProcessor: new SimpleSpanProcessor({
        exporter: new InMemorySpanExporter(),
      }),
      spanExporters: [exporter],
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('spanExporters are ignored'),
    );
  });
});
