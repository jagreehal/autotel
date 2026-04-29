import { describe, it, expect } from 'vitest';
import { trace as otelTraceApi } from '@opentelemetry/api';
import { trace } from './trace-hybrid';

describe('hybrid trace', () => {
  it('is callable like autotel trace', () => {
    expect(typeof trace).toBe('function');

    const wrapped = trace(async (x: number) => x * 2);
    expect(typeof wrapped).toBe('function');
  });

  it('exposes the OTel TraceAPI surface', () => {
    expect(typeof trace.getActiveSpan).toBe('function');
    expect(typeof trace.getTracer).toBe('function');
    expect(typeof trace.getTracerProvider).toBe('function');
    expect(typeof trace.setSpan).toBe('function');
    expect(typeof trace.getSpan).toBe('function');
    expect(typeof trace.setSpanContext).toBe('function');
    expect(typeof trace.getSpanContext).toBe('function');
    expect(typeof trace.deleteSpan).toBe('function');
    expect(typeof trace.wrapSpanContext).toBe('function');
    expect(typeof trace.isSpanContextValid).toBe('function');
    expect(typeof trace.disable).toBe('function');
    expect(typeof trace.setGlobalTracerProvider).toBe('function');
  });

  it('forwards getActiveSpan / getTracerProvider to the OTel singleton', () => {
    expect(trace.getActiveSpan()).toBe(otelTraceApi.getActiveSpan());
    // Same TracerProvider singleton — guarantees getTracer goes through one
    // place. (Tracer instances themselves may not be referentially identical
    // because the proxy creates a new wrapper per call.)
    expect(trace.getTracerProvider()).toBe(otelTraceApi.getTracerProvider());
  });

  it('preserves `this` for class methods (no unbound-this errors)', () => {
    // setGlobalTracerProvider/getTracerProvider rely on `this._proxyTracerProvider`.
    // Calling through the destructured reference must not throw.
    const { getTracerProvider } = trace;
    expect(() => getTracerProvider()).not.toThrow();
  });
});
