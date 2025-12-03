import { describe, it, expect, vi, beforeEach } from 'vitest';
import { traceLoader, traceBeforeLoad, createTracedRoute } from './loaders';

// Mock autotel
vi.mock('autotel', () => ({
  trace: vi.fn((name, fn) =>
    fn({
      setAttributes: vi.fn(),
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
    }),
  ),
}));

describe('loaders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('traceLoader', () => {
    it('should wrap a loader function', async () => {
      const loaderFn = vi.fn().mockResolvedValue({ data: 'test' });
      const tracedLoader = traceLoader(loaderFn);

      const context = {
        params: { userId: '123' },
        route: { id: '/users/$userId' },
      };

      const result = await tracedLoader(context);

      expect(loaderFn).toHaveBeenCalledWith(context);
      expect(result).toEqual({ data: 'test' });
    });

    it('should use custom name if provided', async () => {
      const loaderFn = vi.fn().mockResolvedValue({ data: 'test' });
      const tracedLoader = traceLoader(loaderFn, { name: 'customLoader' });

      await tracedLoader({ route: { id: '/test' } });
      expect(loaderFn).toHaveBeenCalled();
    });

    it('should propagate errors', async () => {
      const error = new Error('Loader error');
      const loaderFn = vi.fn().mockRejectedValue(error);
      const tracedLoader = traceLoader(loaderFn);

      await expect(tracedLoader({})).rejects.toThrow('Loader error');
    });

    it('should handle missing route id', async () => {
      const loaderFn = vi.fn().mockResolvedValue({ data: 'test' });
      const tracedLoader = traceLoader(loaderFn);

      const result = await tracedLoader({});
      expect(result).toEqual({ data: 'test' });
    });
  });

  describe('traceBeforeLoad', () => {
    it('should wrap a beforeLoad function', async () => {
      const beforeLoadFn = vi.fn().mockResolvedValue({ auth: true });
      const tracedBeforeLoad = traceBeforeLoad(beforeLoadFn);

      const context = {
        params: { userId: '123' },
        route: { id: '/users/$userId' },
      };

      const result = await tracedBeforeLoad(context);

      expect(beforeLoadFn).toHaveBeenCalledWith(context);
      expect(result).toEqual({ auth: true });
    });

    it('should handle redirect errors gracefully', async () => {
      const redirectError = new Error('Redirect');
      redirectError.name = 'RedirectError';
      const beforeLoadFn = vi.fn().mockRejectedValue(redirectError);
      const tracedBeforeLoad = traceBeforeLoad(beforeLoadFn);

      await expect(tracedBeforeLoad({})).rejects.toThrow('Redirect');
    });

    it('should handle notFound errors gracefully', async () => {
      const notFoundError = new Error('Not Found');
      notFoundError.name = 'NotFoundError';
      const beforeLoadFn = vi.fn().mockRejectedValue(notFoundError);
      const tracedBeforeLoad = traceBeforeLoad(beforeLoadFn);

      await expect(tracedBeforeLoad({})).rejects.toThrow('Not Found');
    });
  });

  describe('createTracedRoute', () => {
    it('should create loader and beforeLoad wrappers', () => {
      const traced = createTracedRoute('/users/$userId');

      expect(traced.loader).toBeDefined();
      expect(traced.beforeLoad).toBeDefined();
    });

    it('should wrap loader with route id in span name', async () => {
      const traced = createTracedRoute('/users/$userId');
      const loaderFn = vi.fn().mockResolvedValue({ user: {} });
      const tracedLoader = traced.loader(loaderFn);

      await tracedLoader({ params: { userId: '123' } });
      expect(loaderFn).toHaveBeenCalled();
    });

    it('should wrap beforeLoad with route id in span name', async () => {
      const traced = createTracedRoute('/dashboard');
      const beforeLoadFn = vi.fn().mockResolvedValue({});
      const tracedBeforeLoad = traced.beforeLoad(beforeLoadFn);

      await tracedBeforeLoad({});
      expect(beforeLoadFn).toHaveBeenCalled();
    });
  });
});
