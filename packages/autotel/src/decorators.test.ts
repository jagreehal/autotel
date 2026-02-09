import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Trace } from './decorators';
import { configure, resetConfig } from './config';
import { trace as otelTrace, SpanStatusCode } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

describe('Decorators', () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeEach(() => {
    resetConfig();

    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    otelTrace.setGlobalTracerProvider(provider);
    const tracer = provider.getTracer('test-decorators');
    configure({ tracer });
  });

  afterEach(() => {
    exporter.reset();
    otelTrace.setGlobalTracerProvider(undefined as any);
  });

  describe('@Trace method decorator', () => {
    it('should trace a simple async method', async () => {
      class TestService {
        @Trace()
        async getData() {
          return { data: 'test' };
        }
      }

      const service = new TestService();
      const result = await service.getData();

      expect(result).toEqual({ data: 'test' });

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]?.name).toBe('getData');
    });

    it('should use custom name', async () => {
      class TestService {
        @Trace('custom.operation')
        async processData() {
          return 'processed';
        }
      }

      const service = new TestService();
      await service.processData();

      const spans = exporter.getFinishedSpans();
      expect(spans[0]?.name).toBe('custom.operation');
    });

    it('should pass options to trace', async () => {
      class TestService {
        @Trace({ name: 'test.method', withMetrics: true })
        async execute() {
          return 'done';
        }
      }

      const service = new TestService();
      await service.execute();

      const spans = exporter.getFinishedSpans();
      expect(spans[0]?.name).toBe('test.method');
    });

    it('should make ctx available via this.ctx', async () => {
      interface WithTraceContext {
        ctx?: import('./functional').TraceContext;
      }

      class TestService {
        // @ts-expect-error - Decorator type resolution issue in test environment, works in production
        @Trace()
        async createUser(data: { id: string }) {
          const ctx = (this as unknown as WithTraceContext).ctx;
          if (ctx) {
            ctx.setAttribute('user.id', data.id);
          }
          return data;
        }
      }

      const service = new TestService();
      await service.createUser({ id: '123' });

      const spans = exporter.getFinishedSpans();
      expect(spans[0]?.attributes['user.id']).toBe('123');
    });

    it('should work without accessing ctx', async () => {
      class TestService {
        @Trace()
        async simpleMethod() {
          return 'result';
        }
      }

      const service = new TestService();
      const result = await service.simpleMethod();

      expect(result).toBe('result');
      expect(exporter.getFinishedSpans()).toHaveLength(1);
    });

    it('should preserve method arguments and return values', async () => {
      class TestService {
        // @ts-expect-error - Decorator type resolution issue in test environment, works in production
        @Trace()
        async calculate(a: number, b: number) {
          return a + b;
        }
      }

      const service = new TestService();
      const result = await service.calculate(5, 3);

      expect(result).toBe(8);
    });

    it('should handle errors correctly', async () => {
      class TestService {
        @Trace()
        async failingMethod() {
          throw new Error('Test error');
        }
      }

      const service = new TestService();

      await expect(service.failingMethod()).rejects.toThrow('Test error');

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]?.status.code).toBe(SpanStatusCode.ERROR);
    });
  });
});
