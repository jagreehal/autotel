import { describe, it, expect } from 'vitest';
import * as serverContext from './context';
import * as browserContext from './browser/context';
import {
  extractContextFromRequest,
  injectContextToHeaders,
  createTracedHeaders,
} from './context';

describe('context', () => {
  describe('extractContextFromRequest', () => {
    it('should return context from request with traceparent header', () => {
      const traceparent =
        '00-12345678901234567890123456789012-1234567890123456-01';
      const request = new Request('http://localhost/test', {
        headers: { traceparent },
      });

      const ctx = extractContextFromRequest(request);
      expect(ctx).toBeDefined();
    });

    it('should handle request without trace headers', () => {
      const request = new Request('http://localhost/test');
      const ctx = extractContextFromRequest(request);
      expect(ctx).toBeDefined(); // Should return ROOT_CONTEXT
    });

    it('should extract tracestate if present', () => {
      const request = new Request('http://localhost/test', {
        headers: {
          traceparent:
            '00-12345678901234567890123456789012-1234567890123456-01',
          tracestate: 'vendor=value',
        },
      });

      const ctx = extractContextFromRequest(request);
      expect(ctx).toBeDefined();
    });

    it('should extract baggage if present', () => {
      const request = new Request('http://localhost/test', {
        headers: {
          traceparent:
            '00-12345678901234567890123456789012-1234567890123456-01',
          baggage: 'userId=123,sessionId=abc',
        },
      });

      const ctx = extractContextFromRequest(request);
      expect(ctx).toBeDefined();
    });
  });

  describe('injectContextToHeaders', () => {
    it('should inject context into headers', () => {
      const headers = new Headers();
      const result = injectContextToHeaders(headers);
      expect(result).toBe(headers); // Returns same headers object
    });

    it('should work with existing headers', () => {
      const headers = new Headers({ 'Content-Type': 'application/json' });
      injectContextToHeaders(headers);
      expect(headers.get('Content-Type')).toBe('application/json');
    });
  });

  describe('createTracedHeaders', () => {
    it('should create headers with trace context', () => {
      const headers = createTracedHeaders();
      expect(headers).toBeInstanceOf(Headers);
    });

    it('should include existing headers', () => {
      const headers = createTracedHeaders({
        'Content-Type': 'application/json',
      });
      expect(headers.get('Content-Type')).toBe('application/json');
    });

    it('should work with HeadersInit object', () => {
      const headers = createTracedHeaders({
        'Content-Type': 'application/json',
        'X-Custom': 'value',
      });
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(headers.get('X-Custom')).toBe('value');
    });
  });

  // The browser build is swapped in via package.json "browser" exports, so an
  // export present in only one half is a runtime crash on the other.
  it('server and browser builds expose the same exports', () => {
    expect(Object.keys(serverContext).sort()).toEqual(
      Object.keys(browserContext).sort(),
    );
  });

  describe('active-context accessors outside a span', () => {
    it('return empty/undefined rather than throwing', () => {
      expect(serverContext.getTraceParent()).toBe('');
      expect(serverContext.getTraceState()).toBe('');
      expect(serverContext.getCurrentTraceId()).toBeUndefined();
      expect(serverContext.getCurrentSpanId()).toBeUndefined();
    });
  });
});
