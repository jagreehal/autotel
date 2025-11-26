import { describe, it, expect, beforeEach } from 'vitest';
import { context, propagation, trace, type Span } from '@opentelemetry/api';
import {
  extractOtelContextFromMeta,
  injectOtelContextToMeta,
  activateTraceContext,
} from './context.js';

describe('Context Utilities', () => {
  describe('extractOtelContextFromMeta', () => {
    it('should return active context when meta is undefined', () => {
      const activeContext = context.active();
      const extracted = extractOtelContextFromMeta();
      expect(extracted).toBe(activeContext);
    });

    it('should return active context when meta is empty', () => {
      const activeContext = context.active();
      const extracted = extractOtelContextFromMeta({});
      expect(extracted).toBe(activeContext);
    });

    it('should return active context when meta is not an object', () => {
      const activeContext = context.active();
      const extracted = extractOtelContextFromMeta('not an object' as any);
      expect(extracted).toBe(activeContext);
    });

    it('should extract context from traceparent field', () => {
      const meta = {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      };

      const extracted = extractOtelContextFromMeta(meta);
      expect(extracted).toBeDefined();
      expect(extracted).not.toBe(context.active());
    });

    it('should extract context with tracestate', () => {
      const meta = {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
        tracestate: 'vendor1=value1,vendor2=value2',
      };

      const extracted = extractOtelContextFromMeta(meta);
      expect(extracted).toBeDefined();
    });

    it('should extract context with baggage', () => {
      const meta = {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
        baggage: 'userId=123,sessionId=abc',
      };

      const extracted = extractOtelContextFromMeta(meta);
      expect(extracted).toBeDefined();
    });

    it('should ignore non-string trace fields', () => {
      const meta = {
        traceparent: 12_345 as any,
        tracestate: { invalid: 'object' } as any,
      };

      const activeContext = context.active();
      const extracted = extractOtelContextFromMeta(meta);
      expect(extracted).toBe(activeContext);
    });
  });

  describe('injectOtelContextToMeta', () => {
    it('should inject empty meta when no active trace', () => {
      const meta = injectOtelContextToMeta();
      expect(meta).toBeDefined();
      expect(meta.traceparent).toBeUndefined();
    });

    it('should inject traceparent from active span', () => {
      const tracer = trace.getTracer('test');
      const span = tracer.startSpan('test-span') as Span;

      context.with(trace.setSpan(context.active(), span), () => {
        const meta = injectOtelContextToMeta();
        expect(meta.traceparent).toBeDefined();
        expect(typeof meta.traceparent).toBe('string');
      });

      span.end();
    });

    it('should inject custom context', () => {
      const carrier: Record<string, string> = {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      };

      const customContext = propagation.extract(context.active(), carrier);
      const meta = injectOtelContextToMeta(customContext);

      expect(meta.traceparent).toBeDefined();
    });
  });

  describe('activateTraceContext', () => {
    it('should return active context when meta is undefined', () => {
      const activeContext = context.active();
      const activated = activateTraceContext();
      expect(activated).toBe(activeContext);
    });

    it('should extract and return context from meta', () => {
      const meta = {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      };

      const activated = activateTraceContext(meta);
      expect(activated).toBeDefined();
      expect(activated).not.toBe(context.active());
    });
  });

  describe('Round-trip context propagation', () => {
    it('should preserve trace context through inject -> extract cycle', () => {
      const tracer = trace.getTracer('test');
      const span = tracer.startSpan('parent-span') as Span;

      let extractedContext: any;

      context.with(trace.setSpan(context.active(), span), () => {
        // Inject context into _meta
        const meta = injectOtelContextToMeta();
        expect(meta.traceparent).toBeDefined();

        // Extract context from _meta
        extractedContext = extractOtelContextFromMeta(meta);
      });

      span.end();

      // The extracted context should have trace information
      expect(extractedContext).toBeDefined();
    });
  });
});
