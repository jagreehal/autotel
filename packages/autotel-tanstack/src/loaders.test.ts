import { describe, it, expect, vi, beforeEach } from 'vitest';
import { traceLoader, traceBeforeLoad, createTracedRoute } from './loaders';

// Mock autotel
vi.mock('autotel', () => {
  // Public call shapes: trace(fn) wraps; trace(name|opts, operation) executes
  // immediately with context.
  const mockCtx = {
    setAttributes: vi.fn(),
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    recordError: vi.fn(),
  };
  return {
    // Mirrors the real shapes: every trace(...) form wraps, trace.run(...) runs.
    trace: Object.assign(
      vi.fn((first: unknown, maybeFn?: (...a: unknown[]) => unknown) =>
        typeof first === 'function' ? first : (maybeFn ?? ((f: unknown) => f)),
      ),
      {
        run: vi.fn((_first: unknown, operation: (ctx: unknown) => unknown) =>
          operation(mockCtx),
        ),
      },
    ),
    withTracing: vi.fn(
      () => (factory: (ctx: unknown) => (...a: unknown[]) => unknown) =>
        factory(mockCtx),
    ),
    getActiveTraceContext: vi.fn(() => mockCtx),
  };
});

describe('loaders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('traceLoader', () => {
    it('should trace a loader and return its result', async () => {
      const loaderFn = vi.fn().mockResolvedValue({ data: 'test' });
      const context = {
        params: { userId: '123' },
        route: { id: '/users/$userId' },
      };

      const result = await traceLoader(context, loaderFn);

      expect(loaderFn).toHaveBeenCalledWith(context);
      expect(result).toEqual({ data: 'test' });
    });

    it('should use custom name if provided', async () => {
      const loaderFn = vi.fn().mockResolvedValue({ data: 'test' });
      await traceLoader({ route: { id: '/test' } }, loaderFn, {
        name: 'customLoader',
      });
      expect(loaderFn).toHaveBeenCalled();
    });

    it('should propagate errors', async () => {
      const error = new Error('Loader error');
      const loaderFn = vi.fn().mockRejectedValue(error);
      await expect(traceLoader({}, loaderFn)).rejects.toThrow('Loader error');
    });

    it('should handle missing route id', async () => {
      const loaderFn = vi.fn().mockResolvedValue({ data: 'test' });
      const result = await traceLoader({}, loaderFn);
      expect(result).toEqual({ data: 'test' });
    });
  });

  describe('traceBeforeLoad', () => {
    it('should trace a beforeLoad and return its result', async () => {
      const beforeLoadFn = vi.fn().mockResolvedValue({ auth: true });
      const context = {
        params: { userId: '123' },
        route: { id: '/users/$userId' },
      };

      const result = await traceBeforeLoad(context, beforeLoadFn);

      expect(beforeLoadFn).toHaveBeenCalledWith(context);
      expect(result).toEqual({ auth: true });
    });

    it('should handle redirect errors gracefully', async () => {
      const redirectError = new Error('Redirect');
      redirectError.name = 'RedirectError';
      const beforeLoadFn = vi.fn().mockRejectedValue(redirectError);

      await expect(traceBeforeLoad({}, beforeLoadFn)).rejects.toThrow(
        'Redirect',
      );
    });

    it('should handle notFound errors gracefully', async () => {
      const notFoundError = new Error('Not Found');
      notFoundError.name = 'NotFoundError';
      const beforeLoadFn = vi.fn().mockRejectedValue(notFoundError);

      await expect(traceBeforeLoad({}, beforeLoadFn)).rejects.toThrow(
        'Not Found',
      );
    });
  });

  describe('createTracedRoute', () => {
    it('should create loader and beforeLoad tracers', () => {
      const traced = createTracedRoute('/users/$userId');

      expect(traced.loader).toBeDefined();
      expect(traced.beforeLoad).toBeDefined();
    });

    it('should trace loader with route id in span name', async () => {
      const traced = createTracedRoute('/users/$userId');
      const loaderFn = vi.fn().mockResolvedValue({ user: {} });
      await traced.loader({ params: { userId: '123' } }, loaderFn);
      expect(loaderFn).toHaveBeenCalled();
    });

    it('should trace beforeLoad with route id in span name', async () => {
      const traced = createTracedRoute('/dashboard');
      const beforeLoadFn = vi.fn().mockResolvedValue({});
      await traced.beforeLoad({}, beforeLoadFn);
      expect(beforeLoadFn).toHaveBeenCalled();
    });
  });
});
