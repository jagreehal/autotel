import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createTracingMiddleware,
  tracingMiddleware,
  functionTracingMiddleware,
} from './middleware';

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

// Mock context module
vi.mock('./context.js', () => ({
  extractContextFromRequest: vi.fn(() => ({})),
}));

describe('middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createTracingMiddleware', () => {
    it('should create request middleware by default', async () => {
      const middleware = createTracingMiddleware();
      const request = new Request('http://localhost/api/users');
      const next = vi.fn().mockResolvedValue({ status: 200 });

      await middleware({
        next,
        request,
        pathname: '/api/users',
        context: {},
      });

      expect(next).toHaveBeenCalled();
    });

    it('should create function middleware when type is "function"', async () => {
      const middleware = createTracingMiddleware({ type: 'function' });
      const next = vi.fn().mockResolvedValue({ data: 'test' });

      await middleware({
        next,
        context: {},
        data: { id: '123' },
        functionId: 'getUser',
        method: 'GET',
      });

      expect(next).toHaveBeenCalled();
    });

    it('should skip excluded paths', async () => {
      const middleware = createTracingMiddleware({
        excludePaths: ['/health', '/metrics'],
      });
      const request = new Request('http://localhost/health');
      const next = vi.fn().mockResolvedValue({ status: 200 });

      await middleware({
        next,
        request,
        pathname: '/health',
        context: {},
      });

      expect(next).toHaveBeenCalled();
    });

    it('should handle glob patterns in excludePaths', async () => {
      const middleware = createTracingMiddleware({
        excludePaths: ['/api/internal/*'],
      });
      const request = new Request('http://localhost/api/internal/debug');
      const next = vi.fn().mockResolvedValue({ status: 200 });

      await middleware({
        next,
        request,
        pathname: '/api/internal/debug',
        context: {},
      });

      expect(next).toHaveBeenCalled();
    });

    it('should handle regex patterns in excludePaths', async () => {
      const middleware = createTracingMiddleware({
        excludePaths: [/^\/api\/v\d+\/health$/],
      });
      const request = new Request('http://localhost/api/v1/health');
      const next = vi.fn().mockResolvedValue({ status: 200 });

      await middleware({
        next,
        request,
        pathname: '/api/v1/health',
        context: {},
      });

      expect(next).toHaveBeenCalled();
    });

    it('should propagate errors from next()', async () => {
      const middleware = createTracingMiddleware();
      const error = new Error('Handler error');
      const next = vi.fn().mockRejectedValue(error);
      const request = new Request('http://localhost/api/users');

      await expect(
        middleware({
          next,
          request,
          pathname: '/api/users',
          context: {},
        }),
      ).rejects.toThrow('Handler error');
    });

    it('should pass through when no request is available', async () => {
      const middleware = createTracingMiddleware();
      const next = vi.fn().mockResolvedValue({ data: 'test' });

      const result = await middleware({
        next,
        context: {},
      });

      expect(next).toHaveBeenCalled();
      expect(result).toEqual({ data: 'test' });
    });
  });

  describe('tracingMiddleware', () => {
    it('should create middleware with sensible defaults', async () => {
      const middleware = tracingMiddleware();
      expect(middleware).toBeDefined();
    });

    it('should exclude common health check paths', async () => {
      const middleware = tracingMiddleware();
      const request = new Request('http://localhost/healthz');
      const next = vi.fn().mockResolvedValue({ status: 200 });

      await middleware({
        next,
        request,
        pathname: '/healthz',
        context: {},
      });

      expect(next).toHaveBeenCalled();
    });

    it('should allow config overrides', async () => {
      const middleware = tracingMiddleware({
        captureHeaders: ['x-custom-header'],
      });
      expect(middleware).toBeDefined();
    });
  });

  describe('functionTracingMiddleware', () => {
    it('should create function middleware', async () => {
      const middleware = functionTracingMiddleware();
      const next = vi.fn().mockResolvedValue({ data: 'test' });

      await middleware({
        next,
        context: {},
        data: { id: '123' },
        functionId: 'testFn',
      });

      expect(next).toHaveBeenCalled();
    });

    it('should not require type in config', () => {
      const middleware = functionTracingMiddleware({ captureArgs: false });
      expect(middleware).toBeDefined();
    });
  });
});
