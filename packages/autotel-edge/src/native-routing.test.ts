import { describe, it, expect } from 'vitest';
import { getExecutionLogger } from './execution-logger';
import { context as api_context } from '@opentelemetry/api';
import type { Attributes } from '@opentelemetry/api';
import {
  trace,
  withTracing,
  span,
  enterSpan,
  getActiveTraceContext,
} from './functional';
import {
  withNativeTracer,
  setDefaultNativeTracer,
  withoutNativeTracer,
  type NativeTracer,
  type NativeSpanHandle,
} from './core/native-bridge';

interface RecordedSpan {
  name: string;
  attributes: Attributes;
  status?: { code: string; message?: string };
  exceptions: { name?: string; message?: string }[];
}

function recordingTracer(): NativeTracer & { spans: RecordedSpan[] } {
  const spans: RecordedSpan[] = [];
  return {
    spans,
    enterSpan<T>(name: string, callback: (s: NativeSpanHandle) => T): T {
      const record: RecordedSpan = { name, attributes: {}, exceptions: [] };
      spans.push(record);
      const handle: NativeSpanHandle = {
        isTraced: true,
        setAttribute(key, value) {
          if (value !== undefined) record.attributes[key] = value;
        },
        setAttributes(attrs) {
          for (const [k, v] of Object.entries(attrs)) handle.setAttribute(k, v);
        },
        setStatus(status) {
          record.status = status;
        },
        recordException(exception) {
          record.exceptions.push(exception);
        },
        updateName(newName) {
          record.name = newName;
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
    const processPayment = withTracing({
      name: 'payment.process',
      attributesFromArgs: ([amount]) => ({ 'payment.amount': amount }),
    })(
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
    expect(tracer.spans[0]!.attributes['code.function']).toBe(
      'payment.process',
    );
  });

  it('exposes the native span through getActiveTraceContext()', () => {
    const tracer = recordingTracer();
    const handler = withTracing({ name: 'native.ambient' })(() => () => {
      const ctx = getActiveTraceContext();
      ctx?.setAttribute('ambient.available', true);
      return ctx?.correlationId;
    });

    const correlationId = withNative(
      { ...tracer, correlationId: 'ray-123' },
      () => handler(),
    );

    expect(correlationId).toBe('ray-123');
    expect(tracer.spans[0]!.attributes['ambient.available']).toBe(true);
  });

  it('trace() error path sets native error status, records the exception, rethrows', async () => {
    const tracer = recordingTracer();
    const boom = withTracing({ name: 'boom' })(() => async () => {
      throw new Error('kaboom');
    });
    await expect(withNative(tracer, () => boom())).rejects.toThrow('kaboom');
    expect(tracer.spans[0]!.status).toEqual({
      code: 'error',
      message: 'kaboom',
    });
    expect(tracer.spans[0]!.exceptions[0]).toMatchObject({
      name: 'Error',
      message: 'kaboom',
    });
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

describe('default native tracer', () => {
  it('routes span() outside any wrapper, unless the context opts out', () => {
    const tracer = recordingTracer();
    setDefaultNativeTracer(tracer);
    try {
      span({ name: 'unwrapped' }, () => 1);
      api_context.with(withoutNativeTracer(), () =>
        span({ name: 'otlp-mode' }, () => 2),
      );
      expect(tracer.spans.map((s) => s.name)).toEqual(['unwrapped']);
    } finally {
      setDefaultNativeTracer(null);
    }
  });
});

describe('native spans with only the platform-documented API', () => {
  // Cloudflare documents isTraced, setAttribute, setAttributes,
  // recordException and end; older runtimes have only the first two. A
  // method autotel would like but the platform lacks must degrade, never throw.
  function documentedTracer(surface: 'documented' | 'minimal') {
    const spans: Array<{
      name: string;
      attributes: Record<string, unknown>;
      exceptions: unknown[];
    }> = [];
    const tracer: NativeTracer = {
      enterSpan(name, callback) {
        const record = {
          name,
          attributes: {} as Record<string, unknown>,
          exceptions: [] as unknown[],
        };
        spans.push(record);
        const handle = {
          isTraced: true,
          setAttribute(key: string, value: unknown) {
            if (value !== undefined) record.attributes[key] = value;
          },
          ...(surface === 'documented'
            ? {
                setAttributes(attrs: Record<string, unknown>) {
                  Object.assign(record.attributes, attrs);
                },
                recordException(exception: unknown) {
                  record.exceptions.push(exception);
                },
                end() {},
              }
            : {}),
        };
        return callback(handle as NativeSpanHandle);
      },
    };
    return { tracer, spans };
  }

  for (const surface of ['documented', 'minimal'] as const) {
    it(`${surface}: a successful span() returns, and rename/status are safe`, () => {
      const { tracer, spans } = documentedTracer(surface);
      const value = withNative(tracer, () =>
        span({ name: 'work', attributes: { a: 1 } }, (s) => {
          s.setStatus({ code: 1 });
          s.updateName('renamed');
          return 42;
        }),
      );
      expect(value).toBe(42);
      expect(spans[0]!.attributes.a).toBe(1);
    });

    it(`${surface}: a failing trace.run rethrows the original error`, async () => {
      const { tracer, spans } = documentedTracer(surface);
      const original = new TypeError('card declined');
      await expect(
        withNative(tracer, () =>
          trace.run('pay', async () => {
            throw original;
          }),
        ),
      ).rejects.toBe(original);
      expect(spans[0]!.attributes['otel.status_code']).toBe('ERROR');
      if (surface === 'documented') {
        expect(spans[0]!.exceptions).toMatchObject([
          { name: 'TypeError', message: 'card declined' },
        ]);
      } else {
        expect(spans[0]!.attributes['exception.message']).toBe('card declined');
      }
    });
  }
});

describe('default native tracer outside any wrapper (native DO / Workflow)', () => {
  it('registers a context manager, so ambient ctx and the logger work in trace.run', async () => {
    // A fresh isolate: nothing has registered a context manager yet.
    api_context.disable();
    const tracer = recordingTracer();
    setDefaultNativeTracer(tracer);
    try {
      const seen = await trace.run('alarm.work', async () => {
        await Promise.resolve();
        const ctx = getActiveTraceContext();
        ctx?.setAttribute('ambient.after_await', true);
        getExecutionLogger().set({ step: 'reached' });
        return ctx !== undefined;
      });
      expect(seen).toBe(true);
      expect(tracer.spans[0]!.attributes['ambient.after_await']).toBe(true);
    } finally {
      setDefaultNativeTracer(null);
    }
  });
});
