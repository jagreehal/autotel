import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trace } from '@opentelemetry/api';
import { instrumentBindings } from './bindings';
import { isWrapped } from './common';

describe('instrumentBindings() caching', () => {
  let mockTracer: any;
  let mockSpan: any;
  let getTracerSpy: any;

  beforeEach(() => {
    mockSpan = {
      spanContext: () => ({
        traceId: 'test-trace-id',
        spanId: 'test-span-id',
        traceFlags: 1,
      }),
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
      isRecording: () => true,
      updateName: vi.fn(),
      addEvent: vi.fn(),
    };

    mockTracer = {
      startActiveSpan: vi.fn((name, options, fn) => {
        return fn(mockSpan);
      }),
    };

    getTracerSpy = vi.spyOn(trace, 'getTracer').mockReturnValue(mockTracer as any);
  });

  afterEach(() => {
    getTracerSpy.mockRestore();
  });

  it('should return the same instrumented object for the same env reference', () => {
    const env = {
      MY_KV: { get: vi.fn(), put: vi.fn(), delete: vi.fn(), list: vi.fn() },
    };

    const first = instrumentBindings(env);
    const second = instrumentBindings(env);

    expect(first).toBe(second);
  });

  it('should return different instrumented objects for different env references', () => {
    const env1 = {
      MY_KV: { get: vi.fn(), put: vi.fn(), delete: vi.fn(), list: vi.fn() },
    };
    const env2 = {
      MY_KV: { get: vi.fn(), put: vi.fn(), delete: vi.fn(), list: vi.fn() },
    };

    const first = instrumentBindings(env1);
    const second = instrumentBindings(env2);

    expect(first).not.toBe(second);
  });

  it('should correctly instrument bindings even when returning from cache', () => {
    const env = {
      MY_KV: { get: vi.fn(), put: vi.fn(), delete: vi.fn(), list: vi.fn() },
      API_KEY: 'secret',
    };

    const first = instrumentBindings(env);
    const second = instrumentBindings(env);

    // Cached result should have instrumented bindings
    expect(isWrapped(second.MY_KV)).toBe(true);
    // Non-object values pass through
    expect(second.API_KEY).toBe('secret');
  });
});
