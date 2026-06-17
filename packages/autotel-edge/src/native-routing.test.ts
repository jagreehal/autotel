import { describe, it, expect } from 'vitest';
import { context as api_context } from '@opentelemetry/api';
import { trace, span, enterSpan } from './functional';
import {
  withNativeTracer,
  type NativeTracer,
  type NativeSpanHandle,
} from './core/native-bridge';

interface RecordedSpan {
  name: string;
  attributes: Record<string, unknown>;
}

function recordingTracer(): NativeTracer & { spans: RecordedSpan[] } {
  const spans: RecordedSpan[] = [];
  return {
    spans,
    enterSpan<T>(name: string, callback: (s: NativeSpanHandle) => T): T {
      const record: RecordedSpan = { name, attributes: {} };
      spans.push(record);
      const handle: NativeSpanHandle = {
        isTraced: true,
        setAttribute(key, value) {
          if (value !== undefined) record.attributes[key] = value;
        },
      };
      return callback(handle);
    },
  };
}

function withNative<T>(tracer: NativeTracer, fn: () => T): T {
  return api_context.with(withNativeTracer(tracer), fn);
}

describe('span()/trace()/enterSpan() route to the native tracer when active', () => {
  it('span() creates a native span and applies attributes', async () => {
    const tracer = recordingTracer();
    const result = await withNative(tracer, () =>
      span({ name: 'cache.check', attributes: { 'cache.key': 'k' } }, (s) => {
        s.setAttribute('cache.hit', true);
        return 42;
      }),
    );
    expect(result).toBe(42);
    expect(tracer.spans).toHaveLength(1);
    expect(tracer.spans[0]!.name).toBe('cache.check');
    expect(tracer.spans[0]!.attributes['cache.key']).toBe('k');
    expect(tracer.spans[0]!.attributes['cache.hit']).toBe(true);
  });

  it('trace() (async factory) routes to native and maps arg attributes', async () => {
    const tracer = recordingTracer();
    const processPayment = trace(
      {
        name: 'payment.process',
        attributesFromArgs: ([amount]) => ({ 'payment.amount': amount }),
      },
      (ctx) =>
        async function processPayment(amount: number) {
          ctx.setAttribute('payment.ok', true);
          return amount * 2;
        },
    );

    const out = await withNative(tracer, () => processPayment(21));
    expect(out).toBe(42);
    expect(tracer.spans[0]!.name).toBe('payment.process');
    expect(tracer.spans[0]!.attributes['payment.amount']).toBe(21);
    expect(tracer.spans[0]!.attributes['payment.ok']).toBe(true);
    expect(tracer.spans[0]!.attributes['code.function']).toBe('payment.process');
  });

  it('trace() error path marks error attributes and rethrows', async () => {
    const tracer = recordingTracer();
    const boom = trace('boom', async () => {
      throw new Error('kaboom');
    });
    await expect(withNative(tracer, () => boom())).rejects.toThrow('kaboom');
    expect(tracer.spans[0]!.attributes['error']).toBe(true);
    expect(tracer.spans[0]!.attributes['otel.status_code']).toBe('ERROR');
    expect(tracer.spans[0]!.attributes['exception.message']).toBe('kaboom');
  });

  it('enterSpan() is a native-aware alias for span()', () => {
    const tracer = recordingTracer();
    const v = withNative(tracer, () =>
      enterSpan('parse', (s) => {
        s.setAttribute('format', 'json');
        return 'ok';
      }),
    );
    expect(v).toBe('ok');
    expect(tracer.spans[0]!.name).toBe('parse');
    expect(tracer.spans[0]!.attributes['format']).toBe('json');
  });
});
