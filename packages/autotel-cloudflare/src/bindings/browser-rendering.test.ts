import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { instrumentBrowserRendering } from './browser-rendering';
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';

describe('Browser Rendering Instrumentation', () => {
  let mockTracer: any;
  let mockSpan: any;
  let getTracerSpy: any;
  let mockBrowser: any;

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

    mockBrowser = {
      fetch: vi.fn(async () => new Response('<html></html>', { status: 200 })),
      someOtherMethod: vi.fn(() => 'passthrough-value'),
    };
  });

  afterEach(() => {
    getTracerSpy.mockRestore();
  });

  describe('fetch()', () => {
    it('should create span with correct attributes', async () => {
      const instrumented = instrumentBrowserRendering(mockBrowser, 'my-browser');

      await instrumented.fetch('https://example.com/page');

      expect(mockTracer.startActiveSpan).toHaveBeenCalledTimes(1);

      const [spanName, spanOptions] = mockTracer.startActiveSpan.mock.calls[0];
      expect(spanName).toBe('BrowserRendering my-browser: fetch');
      expect(spanOptions.kind).toBe(SpanKind.CLIENT);
      expect(spanOptions.attributes['browser.system']).toBe('cloudflare-browser-rendering');
      expect(spanOptions.attributes['url.full']).toBe('https://example.com/page');
    });

    it('should record http.response.status_code', async () => {
      mockBrowser.fetch = vi.fn(async () => new Response('Not Found', { status: 404 }));

      const instrumented = instrumentBrowserRendering(mockBrowser, 'my-browser');

      await instrumented.fetch('https://example.com/missing');

      expect(mockSpan.setAttribute).toHaveBeenCalledWith('http.response.status_code', 404);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should handle errors by recording exception and rethrowing', async () => {
      const error = new Error('Browser rendering failed');
      mockBrowser.fetch = vi.fn(async () => {
        throw error;
      });

      const instrumented = instrumentBrowserRendering(mockBrowser, 'my-browser');

      await expect(instrumented.fetch('https://example.com/broken')).rejects.toThrow('Browser rendering failed');

      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'Browser rendering failed',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should use default binding name when none provided', async () => {
      const instrumented = instrumentBrowserRendering(mockBrowser);

      await instrumented.fetch('https://example.com/page');

      const spanName = mockTracer.startActiveSpan.mock.calls[0][0];
      expect(spanName).toBe('BrowserRendering browser: fetch');
    });

    it('should handle URL objects as input', async () => {
      const instrumented = instrumentBrowserRendering(mockBrowser, 'my-browser');

      const url = new URL('https://example.com/rendered-page');
      await instrumented.fetch(url);

      const spanOptions = mockTracer.startActiveSpan.mock.calls[0][1];
      expect(spanOptions.attributes['url.full']).toBe('https://example.com/rendered-page');
    });

    it('should handle Request objects as input', async () => {
      const instrumented = instrumentBrowserRendering(mockBrowser, 'my-browser');

      const request = new Request('https://example.com/request-page');
      await instrumented.fetch(request);

      const spanOptions = mockTracer.startActiveSpan.mock.calls[0][1];
      expect(spanOptions.attributes['url.full']).toBe('https://example.com/request-page');
    });

    it('should set OK status and end span on success', async () => {
      const instrumented = instrumentBrowserRendering(mockBrowser, 'my-browser');

      const result = await instrumented.fetch('https://example.com/page');

      expect(result).toBeInstanceOf(Response);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('http.response.status_code', 200);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  describe('Non-instrumented methods', () => {
    it('should pass through non-instrumented methods unchanged', () => {
      const instrumented = instrumentBrowserRendering(mockBrowser, 'my-browser');

      const result = instrumented.someOtherMethod();

      expect(result).toBe('passthrough-value');
      expect(mockBrowser.someOtherMethod).toHaveBeenCalled();
      // No span should be created for non-instrumented methods
      expect(mockTracer.startActiveSpan).not.toHaveBeenCalled();
    });
  });
});
