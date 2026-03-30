import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import { instrumentKV, instrumentR2, instrumentD1, instrumentServiceBinding } from './bindings';

describe('Bindings this-binding tests', () => {
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

  describe('KV this-binding', () => {
    it('should invoke get() with original object as this, not the proxy', async () => {
      let receivedThis: any;
      const mockKV = {
        get: vi.fn(async function(this: any) {
          // eslint-disable-next-line unicorn/no-this-assignment, @typescript-eslint/no-this-alias
          receivedThis = this;
          return 'value';
        }),
        put: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
        list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),
      } as unknown as KVNamespace;
      const instrumented = instrumentKV(mockKV, 'test');
      await instrumented.get('key');
      expect(receivedThis).toBe(mockKV);
    });

    it('should invoke put() with original object as this, not the proxy', async () => {
      let receivedThis: any;
      const mockKV = {
        get: vi.fn(async () => null),
        put: vi.fn(async function(this: any) {
          // eslint-disable-next-line unicorn/no-this-assignment, @typescript-eslint/no-this-alias
          receivedThis = this;
        }),
        delete: vi.fn(async () => undefined),
        list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),
      } as unknown as KVNamespace;
      const instrumented = instrumentKV(mockKV, 'test');
      await instrumented.put('key', 'value');
      expect(receivedThis).toBe(mockKV);
    });

    it('should invoke delete() with original object as this, not the proxy', async () => {
      let receivedThis: any;
      const mockKV = {
        get: vi.fn(async () => null),
        put: vi.fn(async () => undefined),
        delete: vi.fn(async function(this: any) {
          // eslint-disable-next-line unicorn/no-this-assignment, @typescript-eslint/no-this-alias
          receivedThis = this;
        }),
        list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),
      } as unknown as KVNamespace;
      const instrumented = instrumentKV(mockKV, 'test');
      await instrumented.delete('key');
      expect(receivedThis).toBe(mockKV);
    });

    it('should invoke list() with original object as this, not the proxy', async () => {
      let receivedThis: any;
      const mockKV = {
        get: vi.fn(async () => null),
        put: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
        list: vi.fn(async function(this: any) {
          // eslint-disable-next-line unicorn/no-this-assignment, @typescript-eslint/no-this-alias
          receivedThis = this;
          return { keys: [], list_complete: true, cacheStatus: null };
        }),
      } as unknown as KVNamespace;
      const instrumented = instrumentKV(mockKV, 'test');
      await instrumented.list();
      expect(receivedThis).toBe(mockKV);
    });
  });

  describe('R2 this-binding', () => {
    it('should invoke get() with original object as this, not the proxy', async () => {
      let receivedThis: any;
      const mockR2 = {
        get: vi.fn(async function(this: any) {
          // eslint-disable-next-line unicorn/no-this-assignment, @typescript-eslint/no-this-alias
          receivedThis = this;
          return { size: 100, etag: 'abc', httpMetadata: {} };
        }),
        put: vi.fn(async () => ({ etag: 'abc', uploaded: new Date() })),
        delete: vi.fn(async () => undefined),
        list: vi.fn(async () => ({ objects: [], truncated: false })),
        head: vi.fn(async () => null),
      } as unknown as R2Bucket;
      const instrumented = instrumentR2(mockR2, 'test');
      await instrumented.get('key');
      expect(receivedThis).toBe(mockR2);
    });

    it('should invoke put() with original object as this, not the proxy', async () => {
      let receivedThis: any;
      const mockR2 = {
        get: vi.fn(async () => null),
        put: vi.fn(async function(this: any) {
          // eslint-disable-next-line unicorn/no-this-assignment, @typescript-eslint/no-this-alias
          receivedThis = this;
          return { etag: 'abc', uploaded: new Date() };
        }),
        delete: vi.fn(async () => undefined),
        list: vi.fn(async () => ({ objects: [], truncated: false })),
        head: vi.fn(async () => null),
      } as unknown as R2Bucket;
      const instrumented = instrumentR2(mockR2, 'test');
      await instrumented.put('key', 'value');
      expect(receivedThis).toBe(mockR2);
    });

    it('should invoke delete() with original object as this, not the proxy', async () => {
      let receivedThis: any;
      const mockR2 = {
        get: vi.fn(async () => null),
        put: vi.fn(async () => ({ etag: 'abc', uploaded: new Date() })),
        delete: vi.fn(async function(this: any) {
          // eslint-disable-next-line unicorn/no-this-assignment, @typescript-eslint/no-this-alias
          receivedThis = this;
        }),
        list: vi.fn(async () => ({ objects: [], truncated: false })),
        head: vi.fn(async () => null),
      } as unknown as R2Bucket;
      const instrumented = instrumentR2(mockR2, 'test');
      await instrumented.delete('key');
      expect(receivedThis).toBe(mockR2);
    });

    it('should invoke list() with original object as this, not the proxy', async () => {
      let receivedThis: any;
      const mockR2 = {
        get: vi.fn(async () => null),
        put: vi.fn(async () => ({ etag: 'abc', uploaded: new Date() })),
        delete: vi.fn(async () => undefined),
        list: vi.fn(async function(this: any) {
          // eslint-disable-next-line unicorn/no-this-assignment, @typescript-eslint/no-this-alias
          receivedThis = this;
          return { objects: [], truncated: false };
        }),
        head: vi.fn(async () => null),
      } as unknown as R2Bucket;
      const instrumented = instrumentR2(mockR2, 'test');
      await instrumented.list();
      expect(receivedThis).toBe(mockR2);
    });
  });

  describe('D1 this-binding', () => {
    it('should invoke prepare() with original object as this, not the proxy', () => {
      let receivedThis: any;
      const mockPrepared = {
        first: vi.fn(async () => null),
        run: vi.fn(async () => ({})),
        all: vi.fn(async () => []),
        raw: vi.fn(async () => []),
        bind: vi.fn(function() { return mockPrepared; }),
      };
      const mockD1 = {
        prepare: vi.fn(function(this: any) {
          // eslint-disable-next-line unicorn/no-this-assignment, @typescript-eslint/no-this-alias
          receivedThis = this;
          return mockPrepared;
        }),
        exec: vi.fn(async () => ({ count: 0 })),
      } as unknown as D1Database;
      const instrumented = instrumentD1(mockD1, 'test');
      instrumented.prepare('SELECT 1');
      expect(receivedThis).toBe(mockD1);
    });

    it('should invoke prepared statement methods with original prepared object as this, not the proxy', async () => {
      let receivedThis: any;
      const mockPrepared = {
        first: vi.fn(async function(this: any) {
          // eslint-disable-next-line unicorn/no-this-assignment, @typescript-eslint/no-this-alias
          receivedThis = this;
          return { id: 1 };
        }),
        run: vi.fn(async () => ({})),
        all: vi.fn(async () => []),
        raw: vi.fn(async () => []),
        bind: vi.fn(function() { return mockPrepared; }),
      };
      const mockD1 = {
        prepare: vi.fn(() => mockPrepared),
        exec: vi.fn(async () => ({ count: 0 })),
      } as unknown as D1Database;
      const instrumented = instrumentD1(mockD1, 'test');
      const stmt = instrumented.prepare('SELECT * FROM users WHERE id = ?');
      await stmt.first();
      expect(receivedThis).toBe(mockPrepared);
    });

    it('should invoke exec() with original object as this, not the proxy', async () => {
      let receivedThis: any;
      const mockD1 = {
        prepare: vi.fn(() => ({ first: vi.fn(), run: vi.fn(), all: vi.fn(), raw: vi.fn() })),
        exec: vi.fn(async function(this: any) {
          // eslint-disable-next-line unicorn/no-this-assignment, @typescript-eslint/no-this-alias
          receivedThis = this;
          return { count: 1 };
        }),
      } as unknown as D1Database;
      const instrumented = instrumentD1(mockD1, 'test');
      await instrumented.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)');
      expect(receivedThis).toBe(mockD1);
    });
  });

  describe('Service Binding this-binding', () => {
    it('should invoke fetch() with original object as this, not the proxy', async () => {
      let receivedThis: any;
      const mockFetcher = {
        fetch: vi.fn(async function(this: any) {
          // eslint-disable-next-line unicorn/no-this-assignment, @typescript-eslint/no-this-alias
          receivedThis = this;
          return new Response('ok', { status: 200 });
        }),
      } as unknown as Fetcher;
      const instrumented = instrumentServiceBinding(mockFetcher, 'test');
      await instrumented.fetch('https://example.com');
      expect(receivedThis).toBe(mockFetcher);
    });

    it('should not throw "Illegal invocation" for native-like bindings that check this', async () => {
      // Simulate a native Cloudflare Fetcher that throws when `this` is wrong.
      // Native bindings use C++ checks that reject proxied `this` references.
      class NativeFetcher {
        async fetch(input: RequestInfo | URL, _init?: RequestInit): Promise<Response> {
          // Native bindings validate `this` — throw if it's not the exact instance
          if (!(this instanceof NativeFetcher)) {
            throw new TypeError('Illegal invocation: function called with incorrect `this` reference');
          }
          return new Response('ok', { status: 200 });
        }
      }

      const nativeFetcher = new NativeFetcher() as unknown as Fetcher;
      const instrumented = instrumentServiceBinding(nativeFetcher, 'native-service');

      // This should NOT throw — the fix ensures fetch() is called on the
      // original target, preserving the native `this` binding
      await expect(instrumented.fetch('https://example.com')).resolves.toBeInstanceOf(Response);
    });

    it('should bind non-fetch methods to the original target', () => {
      let receivedThis: any;
      const mockFetcher = {
        fetch: vi.fn(async () => new Response('ok', { status: 200 })),
        connect: vi.fn(function(this: any) {
          // eslint-disable-next-line unicorn/no-this-assignment, @typescript-eslint/no-this-alias
          receivedThis = this;
          return {};
        }),
      } as unknown as Fetcher;
      const instrumented = instrumentServiceBinding(mockFetcher, 'test');
      (instrumented as any).connect('https://example.com');
      expect(receivedThis).toBe(mockFetcher);
    });
  });
});
