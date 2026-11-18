// @vitest-environment jsdom
/**
 * The options that let full mode replace a hand-built Web SDK setup: a
 * propagator other than W3C, exporters beside the OTLP endpoint, and a span
 * handle that still names its span after an `await`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TextMapPropagator } from '@opentelemetry/api';
import { ProxyTracerProvider, trace as otelTrace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace';
import { initFull, resetFullForTesting, span } from './full';
import {
  resetEventSinkForTesting,
  setEventSink,
  type EventAttributes,
  type EventTrace,
} from './emit-event';
import { resetSessionForTesting } from './session';

afterEach(() => {
  resetFullForTesting();
  resetEventSinkForTesting();
  resetSessionForTesting();
  vi.unstubAllGlobals();
});

const quiet = {
  service: 'web',
  captureNavigation: false,
  captureXHR: false,
  captureWebVitals: false,
  captureErrors: false,
  captureNetworkTiming: false,
} as const;

/** A fetch that records the headers each request was sent with. */
function stubFetch(): Headers[] {
  const sent: Headers[] = [];
  vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(new Headers(init?.headers));
    return Promise.resolve(new Response('ok'));
  });
  return sent;
}

/** Writes the active trace id under its own header name, and nothing else. */
/** Fetch instrumentation injects into a plain header record. */
const customPropagator: TextMapPropagator<Record<string, string>> = {
  inject(context, carrier, setter) {
    const traceId = otelTrace.getSpanContext(context)?.traceId;
    if (traceId) setter.set(carrier, 'x-custom-trace', traceId);
  },
  extract: (context) => context,
  fields: () => ['x-custom-trace'],
};

describe('propagator', () => {
  it('writes trace context in the configured format instead of traceparent', async () => {
    const sent = stubFetch();
    initFull({ ...quiet, propagator: customPropagator });

    await fetch('/api/orders');

    expect(sent[0]?.get('x-custom-trace')).toMatch(/^[0-9a-f]{32}$/);
    expect(sent[0]?.has('traceparent')).toBe(false);
  });

  it('defaults to W3C traceparent', async () => {
    const sent = stubFetch();
    initFull(quiet);

    await fetch('/api/orders');

    expect(sent[0]?.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-/);
  });

  it('is replaced by the next initFull, not kept from the first', async () => {
    // The API refuses to overwrite a registered propagator; without the reset
    // releasing it, a second setup silently keeps the first one's format.
    stubFetch();
    initFull({ ...quiet, propagator: customPropagator });
    resetFullForTesting();
    const sent = stubFetch();
    initFull(quiet);

    await fetch('/api/orders');

    expect(sent[0]?.has('x-custom-trace')).toBe(false);
    expect(sent[0]?.has('traceparent')).toBe(true);
  });
});

/** Push every batched span out to its exporters now. */
async function flushAll(): Promise<void> {
  const registered = otelTrace.getTracerProvider();
  const provider =
    registered instanceof ProxyTracerProvider
      ? registered.getDelegate()
      : registered;
  if (!(provider instanceof TracerProvider)) {
    throw new Error('initFull registered no SDK tracer provider');
  }
  // A failing exporter rejects the whole flush; the tests assert on what each
  // exporter received, not on the flush.
  await provider.forceFlush().catch(() => undefined);
}

const names = (spans: ReadableSpan[]) => spans.map((s) => s.name);

describe('spanExporters', () => {
  it('sends every span to each exporter, beside one another', async () => {
    const first = new InMemorySpanExporter();
    const second = new InMemorySpanExporter();
    initFull({ ...quiet, captureFetch: false, spanExporters: [first, second] });

    span('checkout', () => undefined);
    await flushAll();

    expect(names(first.getFinishedSpans())).toEqual(['checkout']);
    expect(names(second.getFinishedSpans())).toEqual(['checkout']);
  });

  it('keeps delivering to one exporter while another fails', async () => {
    const healthy = new InMemorySpanExporter();
    const failing: SpanExporter = {
      export: (_spans, done) => done({ code: 1, error: new Error('down') }),
      shutdown: () => Promise.resolve(),
    };
    initFull({
      ...quiet,
      captureFetch: false,
      spanExporters: [failing, healthy],
    });

    span('first', () => undefined);
    await flushAll();
    span('second', () => undefined);
    await flushAll();

    expect(names(healthy.getFinishedSpans())).toEqual(['first', 'second']);
  });

  it('is ignored when spanProcessor replaces the pipeline', async () => {
    const replaced = new InMemorySpanExporter();
    const own = new InMemorySpanExporter();
    initFull({
      ...quiet,
      captureFetch: false,
      spanExporters: [replaced],
      spanProcessor: new SimpleSpanProcessor({ exporter: own }),
    });

    span('checkout', () => undefined);
    await flushAll();

    expect(names(own.getFinishedSpans())).toEqual(['checkout']);
    expect(replaced.getFinishedSpans()).toEqual([]);
  });
});

describe('span handle', () => {
  it("emits a log-based event under its own span's ids after an await", async () => {
    // Without Zone.js the active span is gone once the callback awaits, so a
    // lookup by "active span" lands nowhere. The handle does not look anything up.
    const exporter = new InMemorySpanExporter();
    initFull({
      ...quiet,
      captureFetch: false,
      spanProcessor: new SimpleSpanProcessor({ exporter }),
    });
    const events: Array<[string, EventAttributes, EventTrace | undefined]> = [];
    setEventSink((name, attributes, trace) =>
      events.push([name, attributes, trace]),
    );

    await span('load-user', async (s) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      s.event('user.loaded', { status: 200 });
    });

    const [loaded] = exporter.getFinishedSpans();
    // A log record, not a span event.
    expect(loaded?.events).toEqual([]);
    expect(events).toEqual([
      [
        'user.loaded',
        { status: 200 },
        {
          traceId: loaded!.spanContext().traceId,
          spanId: loaded!.spanContext().spanId,
        },
      ],
    ]);
  });

  it('ends the span once the returned promise settles, after what it did', async () => {
    const exporter = new InMemorySpanExporter();
    initFull({
      ...quiet,
      captureFetch: false,
      spanProcessor: new SimpleSpanProcessor({ exporter }),
    });

    const pending = span('slow', (s) =>
      Promise.resolve().then(() => s.setAttribute('done', true)),
    );
    expect(exporter.getFinishedSpans()).toEqual([]);
    await pending;

    expect(exporter.getFinishedSpans()[0]?.attributes.done).toBe(true);
  });
});
