import { describe, it, expect, vi } from 'vitest';
import { context as api_context, SpanStatusCode } from '@opentelemetry/api';
import type { Attributes } from '@opentelemetry/api';
import type { AttributeValue } from '@opentelemetry/api';
import {
  withNativeTracer,
  getActiveNativeTracer,
  createNativeTraceContext,
  createNativeSpanShim,
  type NativeTracer,
  type NativeSpanHandle,
} from './native-bridge';

function fakeSpan(isTraced = true) {
  const attributes: Attributes = {};
  const span = {
    isTraced,
    attributes,
    setAttribute(key: string, value: string | number | boolean | undefined) {
      // Cloudflare semantics: undefined is a no-op.
      if (value !== undefined) {
        attributes[key] = value;
      }
    },
    setAttributes: vi.fn(
      (attrs: Record<string, string | number | boolean | undefined>) => {
        for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
      },
    ),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    updateName: vi.fn(),
  } satisfies NativeSpanHandle & { attributes: Attributes };
  return span;
}

function fakeTracer(
  span: NativeSpanHandle,
): NativeTracer & { names: string[] } {
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
    // Deliberately pass non-AttributeValue members (an object and undefined)
    // to exercise the bridge's runtime coercion; the API type correctly forbids
    // them, so opt out of that check at this one boundary.
    const attrs: Record<string, unknown> = {
      b: 'x',
      c: true,
      d: { nested: 1 },
      e: undefined,
    };
    ctx.setAttributes(attrs as Record<string, AttributeValue>);

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
    expect(createNativeTraceContext(fakeSpan(true), 'w').isRecording()).toBe(
      true,
    );
    expect(createNativeTraceContext(fakeSpan(false), 'w').isRecording()).toBe(
      false,
    );
  });

  it('emits events via console.log (platform-attributed)', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const ctx = createNativeTraceContext(fakeSpan(), 'work');
    ctx.addEvent('checkpoint', { step: 1 });
    expect(logSpy).toHaveBeenCalledWith('checkpoint', { step: 1 });
    logSpy.mockRestore();
  });

  it('treats addLink/addLinks as no-ops', () => {
    const ctx = createNativeTraceContext(fakeSpan(), 'work');
    expect(() => {
      ctx.addLink({ context: { traceId: '', spanId: '', traceFlags: 0 } });
      ctx.addLinks([]);
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

describe('native-bridge: native Span methods', () => {
  it('routes status, exceptions, bulk attributes and renames to the native span', () => {
    const span = fakeSpan();
    const ctx = createNativeTraceContext(span, 'work');
    ctx.setAttributes({ a: 1, tags: ['x'] });
    ctx.setStatus({ code: SpanStatusCode.ERROR, message: 'boom' });
    ctx.recordException(new TypeError('nope'));
    ctx.updateName('renamed');

    expect(span.setAttributes).toHaveBeenCalledWith({ a: 1, tags: '["x"]' });
    expect(span.setStatus).toHaveBeenCalledWith({
      code: 'error',
      message: 'boom',
    });
    expect(span.recordException).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'TypeError', message: 'nope' }),
    );
    expect(span.updateName).toHaveBeenCalledWith('renamed');
  });

  it('shim maps OK status to native ok', () => {
    const span = fakeSpan();
    createNativeSpanShim(span).setStatus({ code: SpanStatusCode.OK });
    expect(span.setStatus).toHaveBeenCalledWith({
      code: 'ok',
      message: undefined,
    });
  });
});
