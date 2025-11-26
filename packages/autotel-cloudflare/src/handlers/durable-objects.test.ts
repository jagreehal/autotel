import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { instrumentDO } from './durable-objects';
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import type { DurableObjectState } from '@cloudflare/workers-types';

describe('Durable Objects Instrumentation', () => {
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
      startActiveSpan: vi.fn((name, options, context, fn) => {
        if (typeof options === 'function') {
          return options(mockSpan);
        }
        if (typeof context === 'function') {
          return context(mockSpan);
        }
        if (typeof fn === 'function') {
          return fn(mockSpan);
        }
        return Promise.resolve();
      }),
    };

    getTracerSpy = vi.spyOn(trace, 'getTracer').mockReturnValue(mockTracer as any);
  });

  afterEach(() => {
    getTracerSpy.mockRestore();
  });

  describe('instrumentDO()', () => {
    it('should wrap DO class constructor', () => {
      class TestDO {
        constructor(public state: DurableObjectState, public env: any) {}

        async fetch(request: Request) {
          return new Response('Hello');
        }
      }

      const InstrumentedDO = instrumentDO(TestDO, {
        service: { name: 'test-do' },
      });

      expect(InstrumentedDO).toBeDefined();
      expect(typeof InstrumentedDO).toBe('function');
    });

    it('should create DO instance with instrumentation', () => {
      class TestDO {
        constructor(public state: DurableObjectState, public env: any) {}

        async fetch(request: Request) {
          return new Response('Hello');
        }
      }

      const InstrumentedDO = instrumentDO(TestDO, {
        service: { name: 'test-do' },
      });

      const mockState = {
        id: {
          toString: () => 'test-id-123',
          name: 'test-do-name',
          equals: () => false,
        },
        storage: {},
        blockConcurrencyWhile: vi.fn(),
        waitUntil: vi.fn(),
      } as unknown as DurableObjectState;

      const mockEnv = {};

      const instance = new InstrumentedDO(mockState, mockEnv);

      expect(instance).toBeDefined();
      expect(typeof instance.fetch).toBe('function');
    });

    it('should accept static config', () => {
      class TestDO {
        constructor(public state: DurableObjectState, public env: any) {}

        async fetch(request: Request) {
          return new Response('Hello');
        }
      }

      const InstrumentedDO = instrumentDO(TestDO, {
        service: { name: 'test-do', version: '1.0.0' },
        exporter: {
          url: 'http://localhost:4318/v1/traces',
        },
      });

      expect(InstrumentedDO).toBeDefined();
    });

    it('should accept config function', () => {
      class TestDO {
        constructor(public state: DurableObjectState, public env: any) {}

        async fetch(request: Request) {
          return new Response('Hello');
        }
      }

      interface Env {
        OTLP_ENDPOINT: string;
      }

      const InstrumentedDO = instrumentDO(TestDO, (env: Env) => ({
        service: { name: 'test-do' },
        exporter: {
          url: env.OTLP_ENDPOINT,
        },
      }));

      expect(InstrumentedDO).toBeDefined();
    });
  });

  describe('fetch() instrumentation', () => {
    it('should create span for fetch() calls', async () => {
      class TestDO {
        constructor(public state: DurableObjectState, public env: any) {}

        async fetch(request: Request) {
          return new Response('Hello from DO');
        }
      }

      const InstrumentedDO = instrumentDO(TestDO, {
        service: { name: 'test-do' },
      });

      const mockState = {
        id: {
          toString: () => 'test-id-123',
          name: 'test-do-name',
          equals: () => false,
        },
        storage: {},
        blockConcurrencyWhile: vi.fn(),
        waitUntil: vi.fn(),
      } as unknown as DurableObjectState;

      const instance = new InstrumentedDO(mockState, {});
      const request = new Request('http://example.com/test');
      const response = await instance.fetch(request);

      expect(mockTracer.startActiveSpan).toHaveBeenCalled();

      const spanName = mockTracer.startActiveSpan.mock.calls[0][0];
      expect(spanName).toContain('DO');
      expect(spanName).toContain('test-do-name');
      expect(spanName).toContain('GET');

      const text = await response.text();
      expect(text).toBe('Hello from DO');
    });

    it('should add HTTP attributes (method, URL, status)', async () => {
      class TestDO {
        constructor(public state: DurableObjectState, public env: any) {}

        async fetch(request: Request) {
          return new Response('OK', { status: 200 });
        }
      }

      const InstrumentedDO = instrumentDO(TestDO, {
        service: { name: 'test-do' },
      });

      const mockState = {
        id: {
          toString: () => 'test-id-123',
          name: 'counter',
          equals: () => false,
        },
        storage: {},
        blockConcurrencyWhile: vi.fn(),
        waitUntil: vi.fn(),
      } as unknown as DurableObjectState;

      const instance = new InstrumentedDO(mockState, {});
      const request = new Request('http://example.com/increment', { method: 'POST' });
      await instance.fetch(request);

      const options = mockTracer.startActiveSpan.mock.calls[0][1];
      expect(options.kind).toBe(SpanKind.SERVER);
      expect(options.attributes['http.request.method']).toBe('POST');
      expect(options.attributes['url.full']).toBe('http://example.com/increment');
    });

    it('should add DO-specific attributes (do.id, do.id.name)', async () => {
      class TestDO {
        constructor(public state: DurableObjectState, public env: any) {}

        async fetch(request: Request) {
          return new Response('OK');
        }
      }

      const InstrumentedDO = instrumentDO(TestDO, {
        service: { name: 'test-do' },
      });

      const mockState = {
        id: {
          toString: () => 'unique-do-id-456',
          name: 'my-counter',
          equals: () => false,
        },
        storage: {},
        blockConcurrencyWhile: vi.fn(),
        waitUntil: vi.fn(),
      } as unknown as DurableObjectState;

      const instance = new InstrumentedDO(mockState, {});
      const request = new Request('http://example.com/test');
      await instance.fetch(request);

      const options = mockTracer.startActiveSpan.mock.calls[0][1];
      expect(options.attributes['do.id']).toBe('unique-do-id-456');
      expect(options.attributes['do.id.name']).toBe('my-counter');
      expect(options.attributes['faas.trigger']).toBe('http');
    });

    it('should track cold starts (first call = true, subsequent = false)', async () => {
      class TestDO {
        constructor(public state: DurableObjectState, public env: any) {}

        async fetch(request: Request) {
          return new Response('OK');
        }
      }

      const InstrumentedDO = instrumentDO(TestDO, {
        service: { name: 'test-do' },
      });

      const mockState = {
        id: {
          toString: () => 'test-id',
          name: 'test',
          equals: () => false,
        },
        storage: {},
        blockConcurrencyWhile: vi.fn(),
        waitUntil: vi.fn(),
      } as unknown as DurableObjectState;

      const instance = new InstrumentedDO(mockState, {});
      const request = new Request('http://example.com/test');

      // First call - should be cold start
      await instance.fetch(request);
      const firstCallOptions = mockTracer.startActiveSpan.mock.calls[0][1];
      expect(firstCallOptions.attributes['faas.coldstart']).toBe(true);

      // Second call - should NOT be cold start
      await instance.fetch(request);
      const secondCallOptions = mockTracer.startActiveSpan.mock.calls[1][1];
      expect(secondCallOptions.attributes['faas.coldstart']).toBe(false);
    });

    it('should handle fetch() errors', async () => {
      class TestDO {
        constructor(public state: DurableObjectState, public env: any) {}

        async fetch(request: Request) {
          throw new Error('DO error');
        }
      }

      const InstrumentedDO = instrumentDO(TestDO, {
        service: { name: 'test-do' },
      });

      const mockState = {
        id: {
          toString: () => 'test-id',
          name: 'test',
          equals: () => false,
        },
        storage: {},
        blockConcurrencyWhile: vi.fn(),
        waitUntil: vi.fn(),
      } as unknown as DurableObjectState;

      const instance = new InstrumentedDO(mockState, {});
      const request = new Request('http://example.com/test');

      await expect(instance.fetch(request)).rejects.toThrow('DO error');

      expect(mockSpan.recordException).toHaveBeenCalled();
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'DO error',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should preserve "this" binding', async () => {
      class TestDO {
        private counter = 0;

        constructor(public state: DurableObjectState, public env: any) {}

        async fetch(request: Request) {
          this.counter++;
          return new Response(`Count: ${this.counter}`);
        }
      }

      const InstrumentedDO = instrumentDO(TestDO, {
        service: { name: 'test-do' },
      });

      const mockState = {
        id: {
          toString: () => 'test-id',
          name: 'test',
          equals: () => false,
        },
        storage: {},
        blockConcurrencyWhile: vi.fn(),
        waitUntil: vi.fn(),
      } as unknown as DurableObjectState;

      const instance = new InstrumentedDO(mockState, {});

      const response1 = await instance.fetch(new Request('http://example.com/test'));
      const text1 = await response1.text();
      expect(text1).toBe('Count: 1');

      const response2 = await instance.fetch(new Request('http://example.com/test'));
      const text2 = await response2.text();
      expect(text2).toBe('Count: 2');
    });
  });

  describe('alarm() instrumentation', () => {
    it('should create span for alarm() calls', async () => {
      class TestDO {
        constructor(public state: DurableObjectState, public env: any) {}

        async fetch(request: Request) {
          return new Response('OK');
        }

        async alarm() {
          // Alarm logic
        }
      }

      const InstrumentedDO = instrumentDO(TestDO, {
        service: { name: 'test-do' },
      });

      const mockState = {
        id: {
          toString: () => 'test-id-alarm',
          name: 'alarm-do',
          equals: () => false,
        },
        storage: {},
        blockConcurrencyWhile: vi.fn(),
        waitUntil: vi.fn(),
      } as unknown as DurableObjectState;

      const instance = new InstrumentedDO(mockState, {});
      await instance.alarm();

      expect(mockTracer.startActiveSpan).toHaveBeenCalled();

      const spanName = mockTracer.startActiveSpan.mock.calls[0][0];
      expect(spanName).toContain('DO');
      expect(spanName).toContain('alarm-do');
      expect(spanName).toContain('alarm');
    });

    it('should add DO-specific attributes for alarm()', async () => {
      class TestDO {
        constructor(public state: DurableObjectState, public env: any) {}

        async fetch(request: Request) {
          return new Response('OK');
        }

        async alarm() {
          // Alarm logic
        }
      }

      const InstrumentedDO = instrumentDO(TestDO, {
        service: { name: 'test-do' },
      });

      const mockState = {
        id: {
          toString: () => 'alarm-id-123',
          name: 'cleanup-do',
          equals: () => false,
        },
        storage: {},
        blockConcurrencyWhile: vi.fn(),
        waitUntil: vi.fn(),
      } as unknown as DurableObjectState;

      const instance = new InstrumentedDO(mockState, {});
      await instance.alarm();

      const options = mockTracer.startActiveSpan.mock.calls[0][1];
      expect(options.kind).toBe(SpanKind.INTERNAL);
      expect(options.attributes['do.id']).toBe('alarm-id-123');
      expect(options.attributes['do.id.name']).toBe('cleanup-do');
      expect(options.attributes['faas.trigger']).toBe('timer');
    });

    it('should track cold starts for alarm()', async () => {
      class TestDO {
        constructor(public state: DurableObjectState, public env: any) {}

        async fetch(request: Request) {
          return new Response('OK');
        }

        async alarm() {
          // Alarm logic
        }
      }

      const InstrumentedDO = instrumentDO(TestDO, {
        service: { name: 'test-do' },
      });

      const mockState = {
        id: {
          toString: () => 'test-id',
          name: 'test',
          equals: () => false,
        },
        storage: {},
        blockConcurrencyWhile: vi.fn(),
        waitUntil: vi.fn(),
      } as unknown as DurableObjectState;

      const instance = new InstrumentedDO(mockState, {});

      // First alarm call - should be cold start
      await instance.alarm();
      const firstCallOptions = mockTracer.startActiveSpan.mock.calls[0][1];
      expect(firstCallOptions.attributes['faas.coldstart']).toBe(true);

      // Second alarm call - should NOT be cold start
      await instance.alarm();
      const secondCallOptions = mockTracer.startActiveSpan.mock.calls[1][1];
      expect(secondCallOptions.attributes['faas.coldstart']).toBe(false);
    });

    it('should handle alarm() errors', async () => {
      class TestDO {
        constructor(public state: DurableObjectState, public env: any) {}

        async fetch(request: Request) {
          return new Response('OK');
        }

        async alarm() {
          throw new Error('Alarm failed');
        }
      }

      const InstrumentedDO = instrumentDO(TestDO, {
        service: { name: 'test-do' },
      });

      const mockState = {
        id: {
          toString: () => 'test-id',
          name: 'test',
          equals: () => false,
        },
        storage: {},
        blockConcurrencyWhile: vi.fn(),
        waitUntil: vi.fn(),
      } as unknown as DurableObjectState;

      const instance = new InstrumentedDO(mockState, {});

      await expect(instance.alarm()).rejects.toThrow('Alarm failed');

      expect(mockSpan.recordException).toHaveBeenCalled();
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'Alarm failed',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });
  });
});
