import { describe, it, expect, vi } from 'vitest';
import {
  isNativeTracingAvailable,
  getNativeTracerFromCtx,
} from './native-tracing';

function ctxWithTracing() {
  const enterSpan = vi.fn((_name: string, cb: (s: any) => unknown) =>
    cb({ isTraced: true, setAttribute: vi.fn() }),
  );
  return { tracing: { enterSpan }, waitUntil() {}, passThroughOnException() {} };
}

describe('isNativeTracingAvailable', () => {
  it('is true when ctx.tracing.enterSpan is a function', () => {
    expect(isNativeTracingAvailable(ctxWithTracing())).toBe(true);
  });

  it('is false for a plain ExecutionContext (tracing disabled / old runtime)', () => {
    expect(isNativeTracingAvailable({ waitUntil() {} })).toBe(false);
  });

  it('is false for null/undefined or malformed tracing', () => {
    expect(isNativeTracingAvailable(undefined)).toBe(false);
    expect(isNativeTracingAvailable(null)).toBe(false);
    expect(isNativeTracingAvailable({ tracing: {} })).toBe(false);
    expect(isNativeTracingAvailable({ tracing: { enterSpan: 123 } })).toBe(false);
  });
});

describe('getNativeTracerFromCtx', () => {
  it('returns null when native tracing is unavailable', () => {
    expect(getNativeTracerFromCtx({ waitUntil() {} })).toBeNull();
  });

  it('wraps ctx.tracing.enterSpan as a NativeTracer', () => {
    const ctx = ctxWithTracing();
    const tracer = getNativeTracerFromCtx(ctx);
    expect(tracer).not.toBeNull();

    const result = tracer!.enterSpan('work', (span) => {
      span.setAttribute('k', 'v');
      return 7;
    });

    expect(result).toBe(7);
    expect(ctx.tracing.enterSpan).toHaveBeenCalledWith('work', expect.any(Function));
  });

  it('attaches the supplied correlation id to the tracer', () => {
    const tracer = getNativeTracerFromCtx(ctxWithTracing(), 'ray-xyz');
    expect(tracer?.correlationId).toBe('ray-xyz');
  });
});
