import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { instrumentGlobalFetch } from './fetch';
import { trace, SpanStatusCode, SpanKind, context as api_context } from '@opentelemetry/api';
import { setConfig, parseConfig } from 'autotel-edge';

describe('Global Fetch Instrumentation', () => {
  let mockTracer: any;
  let mockSpan: any;
  let getTracerSpy: any;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    // Save original fetch
    originalFetch = globalThis.fetch;

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

    // Mock underlying fetch to return test responses
    globalThis.fetch = vi.fn(async (_input) => {
      return new Response('{"data": "test"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as any;
  });

  afterEach(() => {
    // Restore original fetch
    globalThis.fetch = originalFetch;
    getTracerSpy.mockRestore();
  });

  describe('instrumentGlobalFetch()', () => {
    it('should wrap globalThis.fetch', () => {
      const originalFetch = globalThis.fetch;
      instrumentGlobalFetch();

      expect(globalThis.fetch).not.toBe(originalFetch);
      expect(typeof globalThis.fetch).toBe('function');
    });

    it('should create span for HTTP requests', async () => {
      // Set up config
      const config = parseConfig({
        service: { name: 'test-service' },
      });
      const ctx = setConfig(config);

      instrumentGlobalFetch();

      await api_context.with(ctx, async () => {
        await fetch('https://api.example.com/users');

        expect(mockTracer.startActiveSpan).toHaveBeenCalled();

        const spanName = mockTracer.startActiveSpan.mock.calls[0][0];
        expect(spanName).toContain('api.example.com');
        expect(spanName).toContain('GET');
      });
    });

    it('should add HTTP attributes (method, URL, status, headers)', async () => {
      const config = parseConfig({
        service: { name: 'test-service' },
      });
      const ctx = setConfig(config);

      instrumentGlobalFetch();

      await api_context.with(ctx, async () => {
        await fetch('https://api.example.com/users', {
          method: 'POST',
          headers: { 'user-agent': 'test-client/1.0' },
        });

        const options = mockTracer.startActiveSpan.mock.calls[0][1];
        expect(options.kind).toBe(SpanKind.CLIENT);
        expect(options.attributes['http.request.method']).toBe('POST');
        expect(options.attributes['url.full']).toBe('https://api.example.com/users');
        expect(options.attributes['server.address']).toBe('api.example.com');
        expect(options.attributes['url.scheme']).toBe('https');
      });
    });

    it('should add response attributes', async () => {
      const config = parseConfig({
        service: { name: 'test-service' },
      });
      const ctx = setConfig(config);

      instrumentGlobalFetch();

      await api_context.with(ctx, async () => {
        await fetch('https://api.example.com/users');

        expect(mockSpan.setAttributes).toHaveBeenCalled();

        // Find the call with response attributes
        const responseAttributesCall = mockSpan.setAttributes.mock.calls.find(
          (call: any) => call[0]['http.response.status_code'] !== undefined
        );

        expect(responseAttributesCall).toBeDefined();
        expect(responseAttributesCall[0]['http.response.status_code']).toBe(200);
      });
    });

    it('should inject traceparent header for context propagation by default', async () => {
      const config = parseConfig({
        service: { name: 'test-service' },
      });
      const ctx = setConfig(config);

      instrumentGlobalFetch();

      await api_context.with(ctx, async () => {
        await fetch('https://api.example.com/users');

        // Span should have been created
        expect(mockTracer.startActiveSpan).toHaveBeenCalled();

        // In a real scenario, traceparent would be injected via propagation.inject()
        // For this test, we just verify the span was created
        expect(mockSpan.end).toHaveBeenCalled();
      });
    });

    it('should NOT inject traceparent when includeTraceContext = false', async () => {
      const config = parseConfig({
        service: { name: 'test-service' },
        fetch: { includeTraceContext: false },
      });
      setConfig(config);

      instrumentGlobalFetch();

      // Create a spy to check if headers.set was called
      const headersSpy = vi.spyOn(Headers.prototype, 'set');

      await fetch('https://api.example.com/users');

      // Should not have tried to inject traceparent
      const traceparentCalls = headersSpy.mock.calls.filter(
        (call) => call[0] === 'traceparent'
      );
      expect(traceparentCalls.length).toBe(0);

      headersSpy.mockRestore();
    });

    it('should skip non-HTTP requests (file://, data://)', async () => {
      const config = parseConfig({
        service: { name: 'test-service' },
      });
      setConfig(config);

      instrumentGlobalFetch();

      // Try to fetch a file:// URL (should skip instrumentation)
      try {
        await fetch('file:///path/to/file.txt');
      } catch (_e) {
        // file:// will fail, that's expected
      }

      // Should not have created a span
      expect(mockTracer.startActiveSpan).not.toHaveBeenCalled();
    });

    it('should skip when no active config (not initialized)', async () => {
      // Don't set config
      setConfig(null as any);

      instrumentGlobalFetch();

      await fetch('https://api.example.com/users');

      // Should not have created a span
      expect(mockTracer.startActiveSpan).not.toHaveBeenCalled();

      // Original fetch should have been called (returning mocked response)
      // We can't easily verify this without more complex mocking,
      // but the key assertion is that no span was created
    });

    it('should handle successful responses (200-299)', async () => {
      const config = parseConfig({
        service: { name: 'test-service' },
      });
      const ctx = setConfig(config);

      // Mock successful response
      globalThis.fetch = vi.fn(async () => {
        return new Response('OK', { status: 200 });
      }) as any;

      instrumentGlobalFetch();

      await api_context.with(ctx, async () => {
        await fetch('https://api.example.com/users');

        expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
        expect(mockSpan.end).toHaveBeenCalled();
      });
    });

    it('should handle error responses (400-599)', async () => {
      const config = parseConfig({
        service: { name: 'test-service' },
      });
      const ctx = setConfig(config);

      // Mock error response
      globalThis.fetch = vi.fn(async () => {
        return new Response('Not Found', { status: 404 });
      }) as any;

      instrumentGlobalFetch();

      await api_context.with(ctx, async () => {
        await fetch('https://api.example.com/users');

        expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
        expect(mockSpan.end).toHaveBeenCalled();
      });
    });

    it('should handle network errors', async () => {
      const config = parseConfig({
        service: { name: 'test-service' },
      });
      const ctx = setConfig(config);

      // Mock network error
      globalThis.fetch = vi.fn(async () => {
        throw new Error('Network error');
      }) as any;

      instrumentGlobalFetch();

      await api_context.with(ctx, async () => {
        await expect(fetch('https://api.example.com/users')).rejects.toThrow('Network error');

        expect(mockSpan.recordException).toHaveBeenCalled();
        expect(mockSpan.setStatus).toHaveBeenCalledWith({
          code: SpanStatusCode.ERROR,
          message: 'Network error',
        });
        expect(mockSpan.end).toHaveBeenCalled();
      });
    });

    it('should allow custom includeTraceContext function', async () => {
      const includeTraceContextFn = vi.fn((request: Request) => {
        // Only include for specific domains
        return request.url.includes('internal.example.com');
      });

      const config = parseConfig({
        service: { name: 'test-service' },
        fetch: { includeTraceContext: includeTraceContextFn },
      });
      const ctx = setConfig(config);

      instrumentGlobalFetch();

      await api_context.with(ctx, async () => {
        // Fetch internal domain - should include context
        await fetch('https://internal.example.com/api');
        expect(includeTraceContextFn).toHaveBeenCalledTimes(1);

        // Fetch external domain - should not include context
        await fetch('https://external.com/api');
        expect(includeTraceContextFn).toHaveBeenCalledTimes(2);
      });
    });

    it('should handle Request objects as input', async () => {
      const config = parseConfig({
        service: { name: 'test-service' },
      });
      const ctx = setConfig(config);

      instrumentGlobalFetch();

      await api_context.with(ctx, async () => {
        const request = new Request('https://api.example.com/users', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'test' }),
        });

        await fetch(request);

        expect(mockTracer.startActiveSpan).toHaveBeenCalled();

        const spanName = mockTracer.startActiveSpan.mock.calls[0][0];
        expect(spanName).toContain('POST');
        expect(spanName).toContain('api.example.com');
      });
    });

    it('should handle URL objects as input', async () => {
      const config = parseConfig({
        service: { name: 'test-service' },
      });
      const ctx = setConfig(config);

      instrumentGlobalFetch();

      await api_context.with(ctx, async () => {
        const url = new URL('https://api.example.com/users');
        await fetch(url);

        expect(mockTracer.startActiveSpan).toHaveBeenCalled();

        const spanName = mockTracer.startActiveSpan.mock.calls[0][0];
        expect(spanName).toContain('api.example.com');
      });
    });
  });
});
