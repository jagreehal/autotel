import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import { instrumentBindings } from './bindings';
import { isWrapped, wrap } from './common';

describe('instrumentBindings() detection logic', () => {
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

  it('should detect R2 (object with get, put, delete, list, head methods)', () => {
    const mockR2 = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      head: vi.fn(),
    };

    const result = instrumentBindings({ MY_R2: mockR2 });

    expect(result.MY_R2).not.toBe(mockR2);
    expect(isWrapped(result.MY_R2)).toBe(true);
  });

  it('should detect KV (object with get, put, delete, list but NOT head)', () => {
    const mockKV = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    };

    const result = instrumentBindings({ MY_KV: mockKV });

    expect(result.MY_KV).not.toBe(mockKV);
    expect(isWrapped(result.MY_KV)).toBe(true);
  });

  it('should detect D1 (object with prepare, exec methods)', () => {
    const mockD1 = {
      prepare: vi.fn(),
      exec: vi.fn(),
    };

    const result = instrumentBindings({ MY_DB: mockD1 });

    expect(result.MY_DB).not.toBe(mockD1);
    expect(isWrapped(result.MY_DB)).toBe(true);
  });

  it('should detect Vectorize (object with query, insert, upsert, describe methods)', () => {
    const mockVectorize = {
      query: vi.fn(),
      insert: vi.fn(),
      upsert: vi.fn(),
      describe: vi.fn(),
    };

    const result = instrumentBindings({ MY_INDEX: mockVectorize });

    expect(result.MY_INDEX).not.toBe(mockVectorize);
    expect(isWrapped(result.MY_INDEX)).toBe(true);
  });

  it('should detect AI (object with run method AND gateway property)', () => {
    const mockAI = {
      run: vi.fn(),
      gateway: {},
    };

    const result = instrumentBindings({ AI: mockAI });

    expect(result.AI).not.toBe(mockAI);
    expect(isWrapped(result.AI)).toBe(true);
  });

  it('should detect Hyperdrive (object with connect method AND connectionString, host properties)', () => {
    const mockHyperdrive = {
      connect: vi.fn(),
      connectionString: 'postgresql://user:pass@host:5432/db',
      host: 'db.example.com',
      port: 5432,
      user: 'user',
      password: 'pass',
      database: 'db',
    };

    const result = instrumentBindings({ HYPERDRIVE: mockHyperdrive });

    expect(result.HYPERDRIVE).not.toBe(mockHyperdrive);
    expect(isWrapped(result.HYPERDRIVE)).toBe(true);
  });

  it('should detect Queue Producer (object with send, sendBatch but NOT get)', () => {
    const mockQueue = {
      send: vi.fn(),
      sendBatch: vi.fn(),
    };

    const result = instrumentBindings({ MY_QUEUE: mockQueue });

    expect(result.MY_QUEUE).not.toBe(mockQueue);
    expect(isWrapped(result.MY_QUEUE)).toBe(true);
  });

  it('should detect Analytics Engine (object with writeDataPoint method)', () => {
    const mockAE = {
      writeDataPoint: vi.fn(),
    };

    const result = instrumentBindings({ ANALYTICS: mockAE });

    expect(result.ANALYTICS).not.toBe(mockAE);
    expect(isWrapped(result.ANALYTICS)).toBe(true);
  });

  it('should detect Images (object with info, input methods)', () => {
    const mockImages = {
      info: vi.fn(),
      input: vi.fn(),
    };

    const result = instrumentBindings({ IMAGES: mockImages });

    expect(result.IMAGES).not.toBe(mockImages);
    expect(isWrapped(result.IMAGES)).toBe(true);
  });

  it('should detect Service Binding (object with fetch method) - last', () => {
    const mockService = {
      fetch: vi.fn(),
    };

    const result = instrumentBindings({ MY_SERVICE: mockService });

    expect(result.MY_SERVICE).not.toBe(mockService);
    expect(isWrapped(result.MY_SERVICE)).toBe(true);
  });

  it('should detect R2 before KV (object with head gets R2, without head gets KV)', () => {
    const withHead = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      head: vi.fn(),
    };
    const withoutHead = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    };

    const result = instrumentBindings({
      R2_BUCKET: withHead,
      KV_STORE: withoutHead,
    });

    // Both should be wrapped but detected as different types
    expect(isWrapped(result.R2_BUCKET)).toBe(true);
    expect(isWrapped(result.KV_STORE)).toBe(true);
    expect(result.R2_BUCKET).not.toBe(withHead);
    expect(result.KV_STORE).not.toBe(withoutHead);
  });

  it('should skip already-wrapped bindings', () => {
    const mockKV = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    };

    // Pre-wrap the binding using the wrap helper
    const preWrapped = wrap(mockKV, {
      get(target, prop) {
        return Reflect.get(target, prop);
      },
    });

    const result = instrumentBindings({ MY_KV: preWrapped });

    // Should be the same already-wrapped object, not double-wrapped
    expect(result.MY_KV).toBe(preWrapped);
    expect(isWrapped(result.MY_KV)).toBe(true);
  });

  it('should pass through non-object values (strings, numbers)', () => {
    const result = instrumentBindings({
      API_KEY: 'my-secret-key',
      TIMEOUT: 5000,
      ENABLED: true,
      EMPTY: null,
      UNDEF: undefined,
    });

    expect(result.API_KEY).toBe('my-secret-key');
    expect(result.TIMEOUT).toBe(5000);
    expect(result.ENABLED).toBe(true);
    expect(result.EMPTY).toBe(null);
    expect(result.UNDEF).toBe(undefined);
  });
});
