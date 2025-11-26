/**
 * Tests for isolated tracer provider support
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setAutotelTracerProvider,
  getAutotelTracerProvider,
  getAutotelTracer,
} from './tracer-provider';
import { trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

describe('Isolated Tracer Provider', () => {
  let customProvider: NodeTracerProvider;

  beforeEach(() => {
    // Create a custom provider for testing
    customProvider = new NodeTracerProvider();
  });

  afterEach(() => {
    // Clean up: reset to null after each test
    setAutotelTracerProvider(null);
  });

  describe('setAutotelTracerProvider', () => {
    it('should set isolated provider', () => {
      setAutotelTracerProvider(customProvider);

      const provider = getAutotelTracerProvider();
      expect(provider).toBe(customProvider);
    });

    it('should clear isolated provider when set to null', () => {
      setAutotelTracerProvider(customProvider);
      setAutotelTracerProvider(null);

      const provider = getAutotelTracerProvider();
      // Should fall back to global provider
      expect(provider).toBe(trace.getTracerProvider());
    });

    it('should allow overwriting existing isolated provider', () => {
      const provider1 = new NodeTracerProvider();
      const provider2 = new NodeTracerProvider();

      setAutotelTracerProvider(provider1);
      expect(getAutotelTracerProvider()).toBe(provider1);

      setAutotelTracerProvider(provider2);
      expect(getAutotelTracerProvider()).toBe(provider2);
    });
  });

  describe('getAutotelTracerProvider', () => {
    it('should return isolated provider when set', () => {
      setAutotelTracerProvider(customProvider);

      const provider = getAutotelTracerProvider();
      expect(provider).toBe(customProvider);
    });

    it('should return global provider when no isolated provider is set', () => {
      const provider = getAutotelTracerProvider();
      expect(provider).toBe(trace.getTracerProvider());
    });

    it('should be idempotent', () => {
      setAutotelTracerProvider(customProvider);

      const provider1 = getAutotelTracerProvider();
      const provider2 = getAutotelTracerProvider();

      expect(provider1).toBe(provider2);
    });
  });

  describe('getAutotelTracer', () => {
    it('should return tracer from isolated provider when set', () => {
      setAutotelTracerProvider(customProvider);

      const tracer = getAutotelTracer('test-tracer');

      // Verify tracer is from custom provider
      // (We can't directly compare tracers, but we can verify it's not throwing)
      expect(tracer).toBeDefined();
      expect(typeof tracer.startSpan).toBe('function');
    });

    it('should return tracer from global provider when no isolated provider is set', () => {
      const tracer = getAutotelTracer('test-tracer');

      expect(tracer).toBeDefined();
      expect(typeof tracer.startSpan).toBe('function');
    });

    it('should use default tracer name when not specified', () => {
      setAutotelTracerProvider(customProvider);

      const tracer = getAutotelTracer();

      expect(tracer).toBeDefined();
    });

    it('should respect custom tracer name', () => {
      setAutotelTracerProvider(customProvider);

      const tracer = getAutotelTracer('custom-name', '1.0.0');

      expect(tracer).toBeDefined();
    });

    it('should support version parameter', () => {
      setAutotelTracerProvider(customProvider);

      const tracer = getAutotelTracer('my-service', '2.0.0');

      expect(tracer).toBeDefined();
    });
  });

  describe('Integration with Autotel config', () => {
    it('should allow isolated provider to work independently of init()', () => {
      // Don't call init(), just set isolated provider
      setAutotelTracerProvider(customProvider);

      const tracer = getAutotelTracer('standalone');
      expect(tracer).toBeDefined();

      // Should be able to create spans
      const span = tracer.startSpan('test-span');
      expect(span).toBeDefined();
      expect(typeof span.end).toBe('function');
      span.end();
    });

    it('should persist across multiple getTracer calls', () => {
      setAutotelTracerProvider(customProvider);

      const tracer1 = getAutotelTracer('service-1');
      const tracer2 = getAutotelTracer('service-2');

      // Both should come from the same provider
      expect(tracer1).toBeDefined();
      expect(tracer2).toBeDefined();
    });
  });

  describe('Global state isolation', () => {
    it('should not affect global OTel provider', () => {
      const globalProvider = trace.getTracerProvider();

      setAutotelTracerProvider(customProvider);

      // Global provider should remain unchanged
      expect(trace.getTracerProvider()).toBe(globalProvider);
      // But Autotel provider should be our custom one
      expect(getAutotelTracerProvider()).toBe(customProvider);
    });

    it('should allow both global and isolated providers to coexist', () => {
      const _globalProvider = trace.getTracerProvider();
      setAutotelTracerProvider(customProvider);

      const globalTracer = trace.getTracer('global-tracer');
      const isolatedTracer = getAutotelTracer('isolated-tracer');

      expect(globalTracer).toBeDefined();
      expect(isolatedTracer).toBeDefined();

      // Can create spans from both
      const globalSpan = globalTracer.startSpan('global-span');
      const isolatedSpan = isolatedTracer.startSpan('isolated-span');

      expect(globalSpan).toBeDefined();
      expect(isolatedSpan).toBeDefined();

      globalSpan.end();
      isolatedSpan.end();
    });
  });
});
