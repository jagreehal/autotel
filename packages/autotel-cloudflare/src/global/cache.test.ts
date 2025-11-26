import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { instrumentGlobalCache } from './cache';
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';

describe('Global Cache Instrumentation', () => {
  let mockTracer: any;
  let mockSpan: any;
  let getTracerSpy: any;
  let originalCaches: typeof globalThis.caches;

  beforeEach(() => {
    // Save original caches
    originalCaches = globalThis.caches;

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

    // Mock caches API
    const mockCache = {
      match: vi.fn(async (key) => {
        // Simulate cache hit/miss
        const url = key instanceof Request ? key.url : key;
        if (typeof url === 'string' && url.includes('cached')) {
          return new Response('cached data');
        }
        return undefined;
      }),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => true),
      keys: vi.fn(async () => []),
      add: vi.fn(async () => {}),
      addAll: vi.fn(async () => {}),
    };

    (globalThis as any).caches = {
      default: mockCache,
      open: vi.fn(async (name: string) => mockCache),
    };
  });

  afterEach(() => {
    // Restore original caches
    (globalThis as any).caches = originalCaches;
    getTracerSpy.mockRestore();
  });

  describe('instrumentGlobalCache()', () => {
    it('should wrap globalThis.caches', () => {
      const originalCaches = globalThis.caches;
      instrumentGlobalCache();

      expect(globalThis.caches).not.toBe(originalCaches);
      expect(globalThis.caches.default).toBeDefined();
    });

    it('should instrument caches.default', async () => {
      instrumentGlobalCache();

      const request = new Request('https://example.com/test');
      await caches.default.match(request);

      expect(mockTracer.startActiveSpan).toHaveBeenCalled();

      const spanName = mockTracer.startActiveSpan.mock.calls[0][0];
      expect(spanName).toContain('Cache');
      expect(spanName).toContain('default');
      expect(spanName).toContain('match');
    });
  });

  describe('cache.match() instrumentation', () => {
    it('should create span for cache.match()', async () => {
      instrumentGlobalCache();

      const request = new Request('https://example.com/api/data');
      await caches.default.match(request);

      expect(mockTracer.startActiveSpan).toHaveBeenCalled();

      const spanName = mockTracer.startActiveSpan.mock.calls[0][0];
      expect(spanName).toBe('Cache default.match');
    });

    it('should record cache hit (result found)', async () => {
      instrumentGlobalCache();

      const request = new Request('https://example.com/cached/data');
      const result = await caches.default.match(request);

      expect(result).toBeDefined();
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('cache.hit', true);
    });

    it('should record cache miss (result not found)', async () => {
      // Create a mock that explicitly returns undefined
      const missCache = {
        match: vi.fn(async () => undefined),
        put: vi.fn(async () => {}),
        delete: vi.fn(async () => true),
      };

      (globalThis as any).caches = {
        default: missCache,
        open: vi.fn(),
      };

      instrumentGlobalCache();

      const request = new Request('https://example.com/uncached/data');
      const result = await caches.default.match(request);

      expect(result).toBeUndefined();
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('cache.hit', false);
    });

    it('should sanitize URL in attributes', async () => {
      instrumentGlobalCache();

      const request = new Request('https://example.com/api/data?secret=123&token=abc');
      await caches.default.match(request);

      const options = mockTracer.startActiveSpan.mock.calls[0][1];

      // URL should be sanitized (query params removed)
      expect(options.attributes['cache.key']).toBe('https://example.com/api/data');
      expect(options.attributes['cache.key']).not.toContain('secret');
      expect(options.attributes['cache.key']).not.toContain('token');
    });

    it('should add cache operation attributes', async () => {
      instrumentGlobalCache();

      const request = new Request('https://example.com/test');
      await caches.default.match(request);

      const options = mockTracer.startActiveSpan.mock.calls[0][1];
      expect(options.kind).toBe(SpanKind.CLIENT);
      expect(options.attributes['cache.name']).toBe('default');
      expect(options.attributes['cache.operation']).toBe('match');
    });
  });

  describe('cache.put() instrumentation', () => {
    it('should create span for cache.put()', async () => {
      instrumentGlobalCache();

      const request = new Request('https://example.com/test');
      const response = new Response('data');
      await caches.default.put(request, response);

      expect(mockTracer.startActiveSpan).toHaveBeenCalled();

      const spanName = mockTracer.startActiveSpan.mock.calls[0][0];
      expect(spanName).toBe('Cache default.put');
    });

    it('should add cache name and operation attributes', async () => {
      instrumentGlobalCache();

      const request = new Request('https://example.com/test');
      const response = new Response('data');
      await caches.default.put(request, response);

      const options = mockTracer.startActiveSpan.mock.calls[0][1];
      expect(options.attributes['cache.name']).toBe('default');
      expect(options.attributes['cache.operation']).toBe('put');
    });

    it('should handle errors in cache.put()', async () => {
      const errorCache = {
        ...globalThis.caches.default,
        put: vi.fn(async () => {
          throw new Error('Cache error');
        }),
      };

      (globalThis as any).caches = {
        default: errorCache,
        open: vi.fn(),
      };

      instrumentGlobalCache();

      const request = new Request('https://example.com/test');
      const response = new Response('data');

      await expect(caches.default.put(request, response)).rejects.toThrow('Cache error');

      expect(mockSpan.recordException).toHaveBeenCalled();
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'Cache error',
      });
    });
  });

  describe('cache.delete() instrumentation', () => {
    it('should create span for cache.delete()', async () => {
      instrumentGlobalCache();

      const request = new Request('https://example.com/test');
      await caches.default.delete(request);

      expect(mockTracer.startActiveSpan).toHaveBeenCalled();

      const spanName = mockTracer.startActiveSpan.mock.calls[0][0];
      expect(spanName).toBe('Cache default.delete');
    });

    it('should add cache operation attributes for delete', async () => {
      instrumentGlobalCache();

      const request = new Request('https://example.com/test');
      await caches.default.delete(request);

      const options = mockTracer.startActiveSpan.mock.calls[0][1];
      expect(options.attributes['cache.name']).toBe('default');
      expect(options.attributes['cache.operation']).toBe('delete');
    });
  });

  describe('caches.open() instrumentation', () => {
    it('should wrap caches.open() to instrument named caches', async () => {
      instrumentGlobalCache();

      const namedCache = await caches.open('my-cache');

      // After instrumentation, caches.open is wrapped
      // The key is that we can still call it and get a cache back
      expect(namedCache).toBeDefined();
      expect(typeof namedCache.match).toBe('function');
    });

    it('should instrument operations on named caches', async () => {
      instrumentGlobalCache();

      const namedCache = await caches.open('my-custom-cache');
      const request = new Request('https://example.com/test');
      await namedCache.match(request);

      expect(mockTracer.startActiveSpan).toHaveBeenCalled();

      const spanName = mockTracer.startActiveSpan.mock.calls[0][0];
      expect(spanName).toBe('Cache my-custom-cache.match');
    });
  });

  describe('Edge cases', () => {
    it('should handle string keys for match()', async () => {
      instrumentGlobalCache();

      // Some implementations allow string keys
      await caches.default.match('https://example.com/test');

      expect(mockTracer.startActiveSpan).toHaveBeenCalled();

      const options = mockTracer.startActiveSpan.mock.calls[0][1];
      expect(options.attributes['cache.key']).toBe('https://example.com/test');
    });

    it('should set OK status on successful operations', async () => {
      instrumentGlobalCache();

      const request = new Request('https://example.com/test');
      await caches.default.match(request);

      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
      expect(mockSpan.end).toHaveBeenCalled();
    });
  });
});
