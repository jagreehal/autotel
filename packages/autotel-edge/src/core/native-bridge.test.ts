import { describe, it, expect, vi } from 'vitest';
import { context as api_context, SpanStatusCode } from '@opentelemetry/api';
import {
  withNativeTracer,
  getActiveNativeTracer,
  createNativeTraceContext,
  createNativeSpanShim,
  type NativeTracer,
  type NativeSpanHandle,
} from './native-bridge';

function fakeSpan(isTraced = true): NativeSpanHandle & {
  attributes: Record<string, unknown>;
} {
  const attributes: Record<string, unknown> = {};
  return {
    isTraced,
    attributes,
    setAttribute(key, value) {
      // Cloudflare semantics: undefined is a no-op.
      if (value !== undefined) {
        attributes[key] = value;
      }
    },
  };
}

function fakeTracer(span: NativeSpanHandle): NativeTracer & { names: string[] } {
  const names: string[] = [];
  return {
    names,
    enterSpan(name, callback) {
      names.push(name);
      return callback(span);
    },
  };
}

describe('native-bridge: context plumbing', () => {
  it('returns null when no native tracer is installed', () => {
    expect(getActiveNativeTracer()).toBeNull();
  });

  it('exposes the installed tracer within the context scope', () => {
    const tracer = fakeTracer(fakeSpan());
    const ctx = withNativeTracer(tracer);
    api_context.with(ctx, () => {
      expect(getActiveNativeTracer()).toBe(tracer);
    });
    // ...and is gone once the scope ends.
    expect(getActiveNativeTracer()).toBeNull();
  });
});

describe('native-bridge: createNativeTraceContext', () => {
  it('maps attributes and coerces non-primitives', () => {
    const span = fakeSpan();
    const ctx = createNativeTraceContext(span, 'work');

    ctx.setAttribute('a', 1);
    ctx.setAttributes({ b: 'x', c: true, d: { nested: 1 }, e: undefined as never });

    expect(span.attributes).toEqual({
      a: 1,
      b: 'x',
      c: true,
      d: JSON.stringify({ nested: 1 }),
    });
  });

  it('reports trace ids as empty when no spanContext and no correlation id', () => {
    const ctx = createNativeTraceContext(fakeSpan(), 'work');
    expect(ctx.traceId).toBe('');
    expect(ctx.spanId).toBe('');
    expect(ctx.correlationId).toBe('');
    expect(ctx['code.function']).toBe('work');
  });

  it('surfaces a supplied correlation id and writes it as a span attribute', () => {
    const span = fakeSpan();
    const ctx = createNativeTraceContext(span, 'work', 'ray-abc123');
    expect(ctx.correlationId).toBe('ray-abc123');
    expect(ctx.traceId).toBe(''); // still no real id from the platform
    expect(span.attributes['correlation.id']).toBe('ray-abc123');
  });

  it('auto-upgrades to real trace/span ids when the platform exposes spanContext()', () => {
    // Forward-compat: simulate a future Cloudflare span exposing spanContext().
    const base = fakeSpan();
    const span = Object.assign(base, {
      spanContext: () => ({
        traceId: 'abcdef0123456789abcdef0123456789',
        spanId: '0123456789abcdef',
        traceFlags: 1,
      }),
    });
    // Real ids take precedence over the supplied fallback correlation id.
    const ctx = createNativeTraceContext(span, 'work', 'ray-ignored');
    expect(ctx.traceId).toBe('abcdef0123456789abcdef0123456789');
    expect(ctx.spanId).toBe('0123456789abcdef');
    expect(ctx.correlationId).toBe('abcdef0123456789'); // first 16 of traceId
  });

  it('mirrors isRecording from isTraced', () => {
    expect(createNativeTraceContext(fakeSpan(true), 'w').isRecording()).toBe(true);
    expect(createNativeTraceContext(fakeSpan(false), 'w').isRecording()).toBe(false);
  });

  it('records error status as attributes', () => {
    const span = fakeSpan();
    const ctx = createNativeTraceContext(span, 'work');
    ctx.setStatus({ code: SpanStatusCode.ERROR, message: 'boom' });
    expect(span.attributes['otel.status_code']).toBe('ERROR');
    expect(span.attributes['error']).toBe(true);
    expect(span.attributes['otel.status_description']).toBe('boom');
  });

  it('ignores OK status (platform marks success automatically)', () => {
    const span = fakeSpan();
    const ctx = createNativeTraceContext(span, 'work');
    ctx.setStatus({ code: SpanStatusCode.OK });
    expect(span.attributes['otel.status_code']).toBeUndefined();
  });

  it('records exceptions as attributes and console.error', () => {
    const span = fakeSpan();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = createNativeTraceContext(span, 'work');
    ctx.recordException(new TypeError('nope'));
    expect(span.attributes['exception.type']).toBe('TypeError');
    expect(span.attributes['exception.message']).toBe('nope');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('emits events via console.log (platform-attributed)', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const ctx = createNativeTraceContext(fakeSpan(), 'work');
    ctx.addEvent('checkpoint', { step: 1 });
    expect(logSpy).toHaveBeenCalledWith('checkpoint', { step: 1 });
    logSpy.mockRestore();
  });

  it('treats addLink/addLinks/updateName as no-ops', () => {
    const ctx = createNativeTraceContext(fakeSpan(), 'work');
    expect(() => {
      ctx.addLink({ context: { traceId: '', spanId: '', traceFlags: 0 } });
      ctx.addLinks([]);
      ctx.updateName('renamed');
    }).not.toThrow();
  });
});

describe('native-bridge: createNativeSpanShim', () => {
  it('supports chained attribute setters and returns a span-like object', () => {
    const span = fakeSpan();
    const shim = createNativeSpanShim(span);
    const ret = shim.setAttribute('k', 'v').setAttributes({ n: 2 });
    expect(ret).toBe(shim);
    expect(span.attributes).toEqual({ k: 'v', n: 2 });
  });

  it('writes the correlation id as an attribute when provided', () => {
    const span = fakeSpan();
    createNativeSpanShim(span, 'ray-77');
    expect(span.attributes['correlation.id']).toBe('ray-77');
  });

  it('end() is a no-op and spanContext() is invalid', () => {
    const shim = createNativeSpanShim(fakeSpan());
    expect(() => shim.end()).not.toThrow();
    const sc = shim.spanContext();
    expect(sc.traceId).toBe('00000000000000000000000000000000');
    expect(sc.spanId).toBe('0000000000000000');
  });
});
