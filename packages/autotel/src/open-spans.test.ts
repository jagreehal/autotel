import { describe, expect, it } from 'vitest';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import { OpenSpanTracker } from './open-spans';

describe('OpenSpanTracker', () => {
  it('ends open spans on a crash, children first, with the error on the root', () => {
    const exporter = new InMemorySpanExporter();
    const tracker = new OpenSpanTracker();
    const tracer = new BasicTracerProvider({
      spanProcessors: [tracker, new SimpleSpanProcessor(exporter)],
    }).getTracer('t');
    const job = tracer.startSpan('job');
    const done = tracer.startSpan('done');
    done.end();
    tracer.startSpan('step', {}, trace.setSpan(context.active(), job));

    tracker.endAll({ error: new TypeError('boom') });

    const spans = exporter.getFinishedSpans();
    expect(spans.map((s) => s.name)).toEqual(['done', 'step', 'job']);
    for (const span of spans.slice(1)) {
      expect(span.status).toEqual({
        code: SpanStatusCode.ERROR,
        message: 'Process exiting on an uncaught error',
      });
      expect(span.attributes['error.type']).toBe('TypeError');
    }
    const events = (name: string) =>
      spans.find((s) => s.name === name)?.events.map((e) => e.name);
    expect(events('job')).toEqual(['exception']);
    expect(events('step')).toEqual([]);
  });
});
