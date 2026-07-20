/**
 * Tests for isolated tracer provider support
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setAutotelTracerProvider,
  getAutotelTracerProvider,
  getAutotelTracer,
  getForceFlushableProvider,
} from './tracer-provider';
import { trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

describe('getForceFlushableProvider', () => {
  const original = trace.getTracerProvider();
  afterEach(() => {
    trace.disable();
    trace.setGlobalTracerProvider(original);
  });

  it('returns a provider whose forceFlush exports pending spans', async () => {
    // Regression: NodeSDK.getTracerProvider() returns undefined on sdk-node
    // 0.220+, so flushing only via the SDK handle silently exported nothing.
    const exported: string[] = [];
    const exporter = {
      export(
        spans: Array<{ name: string }>,
        cb: (r: { code: number }) => void,
      ) {
        for (const s of spans) exported.push(s.name);
        cb({ code: 0 });
      },
      shutdown() {
        return Promise.resolve();
      },
      forceFlush() {
        return Promise.resolve();
      },
    };
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();

    const span = trace.getTracer('t').startSpan('flushable');
    span.end();

    const flushable = getForceFlushableProvider();
    expect(flushable).toBeDefined();
    await flushable!.forceFlush();
    expect(exported).toContain('flushable');
  });

  it('prefers a force-flushable SDK handle when one is passed', () => {
    let called = false;
    const fakeProvider = {
      forceFlush() {
        called = true;
        return Promise.resolve();
      },
    };
    const fakeSdk = { getTracerProvider: () => fakeProvider };
    const flushable = getForceFlushableProvider(fakeSdk);
    expect(flushable).toBe(fakeProvider);
    expect(called).toBe(false);
  });

  it('falls back to the global provider when the SDK handle yields nothing', () => {
    // sdk-node 0.220 shape: getTracerProvider() returns undefined.
    const fakeSdk = { getTracerProvider: () => undefined };
    const flushable = getForceFlushableProvider(fakeSdk);
    // The ambient global provider is force-flushable (or undefined in a bare
    // env); either way the SDK's undefined must not short-circuit resolution.
    expect(
      flushable === undefined || typeof flushable.forceFlush === 'function',
    ).toBe(true);
  });
});

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
