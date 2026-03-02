import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { instrumentRateLimiter } from './rate-limiter';
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';

describe('Rate Limiter Instrumentation', () => {
  let mockTracer: any;
  let mockSpan: any;
  let getTracerSpy: any;
  let mockLimiter: any;

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

    mockLimiter = {
      limit: vi.fn(async () => ({ success: true })),
      someOtherMethod: vi.fn(() => 'passthrough-value'),
    };
  });

  afterEach(() => {
    getTracerSpy.mockRestore();
  });

  describe('limit()', () => {
    it('should create span with correct attributes', async () => {
      const instrumented = instrumentRateLimiter(mockLimiter, 'my-limiter');

      await instrumented.limit({ key: 'user-123' });

      expect(mockTracer.startActiveSpan).toHaveBeenCalledTimes(1);

      const [spanName, spanOptions] = mockTracer.startActiveSpan.mock.calls[0];
      expect(spanName).toBe('RateLimiter my-limiter: limit');
      expect(spanOptions.kind).toBe(SpanKind.CLIENT);
      expect(spanOptions.attributes['rate_limiter.system']).toBe('cloudflare-rate-limiter');
      expect(spanOptions.attributes['rate_limiter.key']).toBe('user-123');
    });

    it('should record success from result', async () => {
      const instrumented = instrumentRateLimiter(mockLimiter, 'my-limiter');

      await instrumented.limit({ key: 'user-123' });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith('rate_limiter.success', true);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should record success=false when rate limited', async () => {
      mockLimiter.limit = vi.fn(async () => ({ success: false }));

      const instrumented = instrumentRateLimiter(mockLimiter, 'my-limiter');

      const result = await instrumented.limit({ key: 'user-456' });

      expect(result.success).toBe(false);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('rate_limiter.success', false);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should handle errors by recording exception and rethrowing', async () => {
      const error = new Error('Rate limiter unavailable');
      mockLimiter.limit = vi.fn(async () => {
        throw error;
      });

      const instrumented = instrumentRateLimiter(mockLimiter, 'my-limiter');

      await expect(instrumented.limit({ key: 'user-789' })).rejects.toThrow('Rate limiter unavailable');

      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'Rate limiter unavailable',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should use default binding name when none provided', async () => {
      const instrumented = instrumentRateLimiter(mockLimiter);

      await instrumented.limit({ key: 'user-123' });

      const spanName = mockTracer.startActiveSpan.mock.calls[0][0];
      expect(spanName).toBe('RateLimiter rate-limiter: limit');
    });
  });

  describe('this-binding', () => {
    it('should invoke limit() with original object as this, not the proxy', async () => {
      let receivedThis: any;
      const mockLim = {
        limit: vi.fn(async function(this: any) {
          // eslint-disable-next-line unicorn/no-this-assignment, @typescript-eslint/no-this-alias
          receivedThis = this;
          return { success: true };
        }),
      };
      const instrumented = instrumentRateLimiter(mockLim, 'test');
      await instrumented.limit({ key: 'user-123' });
      expect(receivedThis).toBe(mockLim);
    });
  });

  describe('Non-instrumented methods', () => {
    it('should pass through non-instrumented methods unchanged', () => {
      const instrumented = instrumentRateLimiter(mockLimiter, 'my-limiter');

      const result = instrumented.someOtherMethod();

      expect(result).toBe('passthrough-value');
      expect(mockLimiter.someOtherMethod).toHaveBeenCalled();
      // No span should be created for non-instrumented methods
      expect(mockTracer.startActiveSpan).not.toHaveBeenCalled();
    });
  });
});
