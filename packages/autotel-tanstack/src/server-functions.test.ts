import { describe, it, expect, vi, beforeEach } from 'vitest';
import { traceServerFn, createTracedServerFnFactory } from './server-functions';

// Mock autotel
vi.mock('autotel', () => {
  // Ambient model: trace(name|opts, fn) returns the wrapper; the body reaches
  // the span via getActiveTraceContext(). withTracing(opts)(factory) mirrors
  // that for the explicit factory form.
  const mockCtx = {
    setAttributes: vi.fn(),
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    recordError: vi.fn(),
  };
  return {
    trace: vi.fn(
      (_nameOrOpts: unknown, fn: (...a: unknown[]) => unknown) => fn,
    ),
    withTracing: vi.fn(
      () => (factory: (ctx: unknown) => (...a: unknown[]) => unknown) =>
        factory(mockCtx),
    ),
    getActiveTraceContext: vi.fn(() => mockCtx),
  };
});

describe('server-functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('traceServerFn', () => {
    it('should wrap a server function', async () => {
      const originalFn = vi.fn().mockResolvedValue({ id: '123', name: 'Test' });
      const tracedFn = traceServerFn(originalFn, { name: 'getUser' });

      const result = await tracedFn({ id: '123' });

      expect(originalFn).toHaveBeenCalledWith({ id: '123' });
      expect(result).toEqual({ id: '123', name: 'Test' });
    });

    it('should use function name if no name provided', async () => {
      async function namedFunction() {
        return 'result';
      }
      const tracedFn = traceServerFn(namedFunction);

      await tracedFn();
      expect(tracedFn).toBeDefined();
    });

    it('should propagate errors', async () => {
      const error = new Error('Test error');
      const originalFn = vi.fn().mockRejectedValue(error);
      const tracedFn = traceServerFn(originalFn, { name: 'failingFn' });

      await expect(tracedFn()).rejects.toThrow('Test error');
    });

    it('should preserve function properties', () => {
      const originalFn = Object.assign(vi.fn().mockResolvedValue('result'), {
        customProp: 'value',
      });
      const tracedFn = traceServerFn(originalFn, { name: 'testFn' });

      expect((tracedFn as any).customProp).toBe('value');
    });
  });

  describe('createTracedServerFnFactory', () => {
    it('should create a factory that wraps createServerFn', () => {
      const mockCreateServerFn = vi.fn(() => ({
        handler: vi.fn((fn) => fn),
      }));

      const tracedFactory = createTracedServerFnFactory(mockCreateServerFn);
      expect(tracedFactory).toBeDefined();
    });

    it('should wrap handler method', () => {
      const mockResult = {
        handler: vi.fn((fn: (...args: unknown[]) => unknown) => {
          // Simulate returning a callable
          return async (...args: unknown[]) => fn(...args);
        }),
      };
      const mockCreateServerFn = vi.fn(
        (_opts: { method: string }) => mockResult,
      );

      const tracedFactory = createTracedServerFnFactory(mockCreateServerFn);
      const builder = tracedFactory({ method: 'GET' });

      expect(builder.handler).toBeDefined();
    });
  });
});
