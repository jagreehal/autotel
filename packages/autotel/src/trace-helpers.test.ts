import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTracer,
  getActiveSpan,
  getActiveContext,
  runWithSpan,
  getTraceContext,
} from './trace-helpers';
import { init } from './init';
import { createTraceCollector } from './testing';
import { span } from './functional';
import { getConfig } from './config';

describe('Trace Helpers', () => {
  beforeEach(() => {
    init({ service: 'test-service' });
  });

  describe('getTracer()', () => {
    it('should return a tracer instance', () => {
      const tracer = getTracer('my-service');
      expect(tracer).toBeDefined();
      expect(typeof tracer.startSpan).toBe('function');
      expect(typeof tracer.startActiveSpan).toBe('function');
    });

    it('should accept optional version parameter', () => {
      const tracer = getTracer('my-service', '1.0.0');
      expect(tracer).toBeDefined();
    });

    it('should work with the configured mock tracer', () => {
      const collector = createTraceCollector();
      // Get the configured mock tracer instead of creating a new one
      const tracer = getConfig().tracer;

      const testSpan = tracer.startSpan('custom.operation');
      testSpan.setAttribute('test.key', 'test-value');
      testSpan.end();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.name).toBe('custom.operation');
      expect(spans[0]!.attributes['test.key']).toBe('test-value');
    });
  });

  describe('getActiveSpan()', () => {
    it('should return undefined when no span is active', () => {
      const activeSpan = getActiveSpan();
      expect(activeSpan).toBeUndefined();
    });

    it('should return the active span inside a span context', () => {
      let capturedSpan;

      span({ name: 'test-span' }, (s) => {
        capturedSpan = getActiveSpan();
        expect(capturedSpan).toBe(s);
      });

      expect(capturedSpan).toBeDefined();
    });

    it('should allow setting attributes on the active span', () => {
      const collector = createTraceCollector();

      span({ name: 'test-span' }, () => {
        const activeSpan = getActiveSpan();
        if (activeSpan) {
          activeSpan.setAttribute('custom.attribute', 'value');
        }
      });

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes['custom.attribute']).toBe('value');
    });

    it('should allow calling span methods on the active span', () => {
      const collector = createTraceCollector();

      span({ name: 'test-span' }, () => {
        const activeSpan = getActiveSpan();
        if (activeSpan) {
          // Test that we can call span methods
          expect(typeof activeSpan.addEvent).toBe('function');
          expect(typeof activeSpan.setAttribute).toBe('function');
          expect(typeof activeSpan.setStatus).toBe('function');
          expect(activeSpan.isRecording()).toBe(true);

          // Call addEvent to verify it doesn't throw
          activeSpan.addEvent('custom.event', { eventData: 'test-data' });
        }
      });

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
    });
  });

  describe('getActiveContext()', () => {
    it('should return a context', () => {
      const ctx = getActiveContext();
      expect(ctx).toBeDefined();
    });

    it('should return different contexts in different execution paths', () => {
      const rootContext = getActiveContext();
      let nestedContext;

      span({ name: 'test-span' }, () => {
        nestedContext = getActiveContext();
      });

      // Contexts should be different when inside a span
      expect(nestedContext).toBeDefined();
      expect(nestedContext).not.toBe(rootContext);
    });
  });

  describe('runWithSpan()', () => {
    it('should execute function with span as active', () => {
      createTraceCollector(); // Set up mock tracer
      const tracer = getConfig().tracer;
      const testSpan = tracer.startSpan('test-operation');

      let capturedSpan;
      const result = runWithSpan(testSpan, () => {
        capturedSpan = getActiveSpan();
        return 42;
      });

      expect(result).toBe(42);
      expect(capturedSpan).toBe(testSpan);

      testSpan.end();
    });

    it('should execute async function with span as active', async () => {
      createTraceCollector(); // Set up mock tracer
      const tracer = getConfig().tracer;
      const testSpan = tracer.startSpan('async-operation');

      let capturedSpan;
      const result = await runWithSpan(testSpan, async () => {
        capturedSpan = getActiveSpan();
        return 'async-result';
      });

      expect(result).toBe('async-result');
      expect(capturedSpan).toBe(testSpan);

      testSpan.end();
    });

    it('should restore previous context after execution', () => {
      createTraceCollector(); // Set up mock tracer
      const tracer = getConfig().tracer;
      const testSpan = tracer.startSpan('test-operation');

      const contextBefore = getActiveContext();

      runWithSpan(testSpan, () => {
        // Inside the span context
        expect(getActiveSpan()).toBe(testSpan);
      });

      const contextAfter = getActiveContext();
      expect(contextAfter).toBe(contextBefore);

      testSpan.end();
    });

    it('should propagate exceptions', () => {
      createTraceCollector(); // Set up mock tracer
      const tracer = getConfig().tracer;
      const testSpan = tracer.startSpan('failing-operation');

      expect(() => {
        runWithSpan(testSpan, () => {
          throw new Error('Test error');
        });
      }).toThrow('Test error');

      testSpan.end();
    });

    it('should work with nested spans', () => {
      const collector = createTraceCollector();
      // Use the configured mock tracer
      const tracer = getConfig().tracer;

      const parentSpan = tracer.startSpan('parent');

      runWithSpan(parentSpan, () => {
        const childSpan = tracer.startSpan('child');

        runWithSpan(childSpan, () => {
          const activeSpan = getActiveSpan();
          expect(activeSpan).toBe(childSpan);
        });

        childSpan.end();

        const activeSpan = getActiveSpan();
        expect(activeSpan).toBe(parentSpan);
      });

      parentSpan.end();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(2);

      const child = spans.find((s) => s.name === 'child');
      const parent = spans.find((s) => s.name === 'parent');

      expect(child).toBeDefined();
      expect(parent).toBeDefined();
    });
  });

  describe('Integration with getTraceContext()', () => {
    it('should work together with getTraceContext()', () => {
      createTraceCollector(); // Set up mock tracer
      const tracer = getConfig().tracer;
      const testSpan = tracer.startSpan('test-operation');

      let traceContext;
      runWithSpan(testSpan, () => {
        traceContext = getTraceContext();
      });

      testSpan.end();

      expect(traceContext).toBeDefined();
      expect(traceContext!.traceId).toBeDefined();
      expect(traceContext!.spanId).toBeDefined();
      expect(traceContext!.correlationId).toBeDefined();
    });
  });
});
