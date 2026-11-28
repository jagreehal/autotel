import { afterEach, describe, expect, it } from 'vitest';
import { InMemorySpanExporter } from './exporters';
import {
  SimpleSpanProcessor,
  TracerProvider,
  type Span as SdkSpan,
} from '@opentelemetry/sdk-trace';
import { PreciseStartTracer, preciseNow } from './precise-start';

const exporter = new InMemorySpanExporter();
const provider = new TracerProvider({
  spanProcessors: [new SimpleSpanProcessor({ exporter })],
});

const startMs = (hr: [number, number]) => hr[0] * 1000 + hr[1] / 1e6;

afterEach(() => exporter.reset());

describe('PreciseStartTracer', () => {
  it('preserves explicit event timestamps supplied by onStart processors', () => {
    const localExporter = new InMemorySpanExporter();
    const eventTime: [number, number] = [1_700_000_000, 123_000_000];
    const localProvider = new TracerProvider({
      spanProcessors: [
        {
          onStart: (span: SdkSpan) => span.addEvent('queued', eventTime),
          onEnd: () => {},
          forceFlush: async () => {},
          shutdown: async () => {},
        },
        new SimpleSpanProcessor({ exporter: localExporter }),
      ],
    });
    new PreciseStartTracer(localProvider.getTracer('explicit-event'))
      .startSpan('work')
      .end();
    expect(localExporter.getFinishedSpans()[0]!.events[0]!.time).toEqual(
      eventTime,
    );
  });

  it('keeps processor-created events within the span', () => {
    const localExporter = new InMemorySpanExporter();
    const localProvider = new TracerProvider({
      spanProcessors: [
        {
          onStart(span) {
            span.addEvent('processor-start');
            const until = performance.now() + 5;
            while (performance.now() < until) {
              // Model synchronous processor work before startSpan returns.
            }
          },
          onEnd() {},
          forceFlush: async () => {},
          shutdown: async () => {},
        },
        new SimpleSpanProcessor({ exporter: localExporter }),
      ],
    });
    new PreciseStartTracer(localProvider.getTracer('processor-test'))
      .startSpan('work')
      .end();
    const done = localExporter.getFinishedSpans()[0]!;
    expect(startMs(done.events[0]!.time)).toBeGreaterThanOrEqual(
      startMs(done.startTime),
    );
  });

  it('orders spans that begin within the same millisecond', () => {
    const tracer = new PreciseStartTracer(provider.getTracer('test'));
    tracer.startActiveSpan('parent', (parent) => {
      for (const name of ['first', 'second', 'third']) {
        tracer.startSpan(name).end();
      }
      parent.end();
    });
    const starts = ['first', 'second', 'third'].map((name) =>
      startMs(
        exporter.getFinishedSpans().find((s) => s.name === name)!.startTime,
      ),
    );
    expect(starts[0]).toBeLessThan(starts[1]!);
    expect(starts[1]).toBeLessThan(starts[2]!);
  });

  it('keeps durations and events precise, inside their span', () => {
    const tracer = new PreciseStartTracer(provider.getTracer('test'));
    const span = tracer.startSpan('work');
    const until = performance.now() + 0.3;
    while (performance.now() < until) {
      // spin a fraction of a millisecond
    }
    span.addEvent('checkpoint');
    span.end();
    const done = exporter.getFinishedSpans()[0]!;
    const start = startMs(done.startTime);
    const duration = startMs(done.duration);
    expect(duration).toBeGreaterThan(0.25);
    expect(duration).toBeLessThan(5);
    expect(duration % 1).not.toBe(0);
    const event = startMs(done.events[0]!.time);
    expect(event).toBeGreaterThanOrEqual(start);
    expect(event).toBeLessThanOrEqual(startMs(done.endTime));
  });

  it('keeps a start time the caller chose', () => {
    const tracer = new PreciseStartTracer(provider.getTracer('test'));
    tracer.startSpan('fixed', { startTime: 1000 }).end();
    expect(startMs(exporter.getFinishedSpans()[0]!.startTime)).toBe(1000);
  });

  it('keeps times consistent when a span processor is slow to start', () => {
    const slowExporter = new InMemorySpanExporter();
    const slowProvider = new TracerProvider({
      spanProcessors: [
        {
          onStart: (span: SdkSpan) => {
            span.addEvent('from-processor');
            const until = performance.now() + 3;
            while (performance.now() < until) {
              // a processor that takes a few milliseconds
            }
          },
          onEnd: () => {},
          forceFlush: async () => {},
          shutdown: async () => {},
        },
        new SimpleSpanProcessor({ exporter: slowExporter }),
      ],
    });
    const tracer = new PreciseStartTracer(slowProvider.getTracer('test'));
    tracer.startSpan('slow-start').end();
    const endedBy = Date.now();
    const done = slowExporter.getFinishedSpans()[0]!;
    const start = startMs(done.startTime);
    expect(startMs(done.events[0]!.time)).toBeGreaterThanOrEqual(start);
    expect(startMs(done.endTime)).toBeLessThan(endedBy + 1);
    expect(startMs(done.duration)).toBeGreaterThan(2.5);
  });

  it('stays within a millisecond of Date.now()', () => {
    for (let i = 0; i < 1000; i++) {
      const before = Date.now();
      const now = preciseNow();
      const after = Date.now();
      expect(now).toBeGreaterThan(before - 1);
      expect(now).toBeLessThan(after + 1);
    }
  });
});
