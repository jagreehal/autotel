import { describe, it, expect, vi } from 'vitest';
import { context as api_context, trace } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { WorkerTracer } from './tracer';
import { WorkerTracerProvider } from './provider';
import {
  withNativeTracer,
  type NativeSpanHandle,
  type NativeTracer,
} from './native-bridge';

/** Records what a native runtime would: names, attributes, nesting, end. */
function fakeRuntime() {
  const spans: Array<{
    name: string;
    attrs: Partial<Record<string, string | number | boolean>>;
    ended: boolean;
    parent?: string;
  }> = [];
  let active: string | undefined;
  const handle = (name: string): NativeSpanHandle => {
    const rec: (typeof spans)[number] = {
      name,
      attrs: {},
      ended: false,
      parent: active,
    };
    spans.push(rec);
    return {
      isTraced: true,
      setAttribute: (k, v) => void (rec.attrs[k] = v),
      end: () => void (rec.ended = true),
    };
  };
  const tracer: NativeTracer = {
    correlationId: 'ray-1',
    enterSpan: (name, cb) => cb(handle(name)),
    startSpan: handle,
    startActiveSpan: (name, cb) => {
      const previous = active;
      const h = handle(name);
      active = name;
      try {
        return cb(h);
      } finally {
        active = previous;
      }
    },
  };
  return { spans, tracer };
}

function processor(): SpanProcessor {
  return {
    onStart: vi.fn(),
    onEnd: vi.fn(),
    shutdown: async () => {},
    forceFlush: async () => {},
  };
}

describe('WorkerTracer under a native tracer', () => {
  it('routes OpenTelemetry API spans to the native runtime, not OTLP', () => {
    const { spans, tracer: native } = fakeRuntime();
    const otlp = processor();
    const tracer = new WorkerTracer([otlp], resourceFromAttributes({}));

    api_context.with(withNativeTracer(native), () => {
      tracer.startActiveSpan(
        'ai.generateText',
        { attributes: { 'gen_ai.request.model': 'm' } },
        (span) => {
          tracer.startSpan('child').end();
          span.end();
        },
      );
    });

    expect(spans).toEqual([
      {
        name: 'ai.generateText',
        parent: undefined,
        ended: true,
        attrs: { 'gen_ai.request.model': 'm', 'correlation.id': 'ray-1' },
      },
      {
        name: 'child',
        parent: 'ai.generateText',
        ended: true,
        attrs: { 'correlation.id': 'ray-1' },
      },
    ]);
    expect(otlp.onStart).not.toHaveBeenCalled();
  });

  it('falls back to enterSpan, and to a non-recording span, on older runtimes', () => {
    const { spans, tracer: full } = fakeRuntime();
    const old: NativeTracer = { enterSpan: full.enterSpan };
    const tracer = new WorkerTracer([], resourceFromAttributes({}));

    api_context.with(withNativeTracer(old), () => {
      expect(tracer.startActiveSpan('a', () => 'ok')).toBe('ok');
      expect(tracer.startSpan('b').isRecording()).toBe(false);
    });
    expect(spans.map((s) => s.name)).toEqual(['a']);
  });

  it('returns a non-recording span before any OTLP pipeline is configured', () => {
    const tracer = new WorkerTracer([], resourceFromAttributes({}));
    expect(tracer.startSpan('x').isRecording()).toBe(false);
  });
});

describe('WorkerTracerProvider.register', () => {
  it('reconfigures the installed tracer instead of being refused', () => {
    trace.disable();
    new WorkerTracerProvider([], resourceFromAttributes({})).register();
    const first = trace.getTracer('any');
    const otlp = processor();
    new WorkerTracerProvider([otlp], resourceFromAttributes({})).register();

    expect(trace.getTracer('any')).toBe(first);
    // SAFETY: register() installed a WorkerTracer just above.
    (first as WorkerTracer).setHeadSampler({
      shouldSample: () => ({ decision: 2 }),
    });
    first.startSpan('s').end();
    expect(otlp.onEnd).toHaveBeenCalledTimes(1);
    trace.disable();
  });
});
