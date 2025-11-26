import { describe, it, expect, beforeEach } from 'vitest';
import { parseConfig, createInitialiser, getActiveConfig, setConfig } from './config';
import type { EdgeConfig } from '../types';
import { context as api_context } from '@opentelemetry/api';

describe('Config System', () => {
  describe('parseConfig()', () => {
    it('should parse minimal config (only service.name)', () => {
      const config: EdgeConfig = {
        service: { name: 'test-service' },
      };

      const parsed = parseConfig(config);

      expect(parsed.service.name).toBe('test-service');
      expect(parsed.service.version).toBeUndefined();
      expect(parsed.service.namespace).toBeUndefined();
    });

    it('should parse full service config', () => {
      const config: EdgeConfig = {
        service: {
          name: 'test-service',
          version: '1.2.3',
          namespace: 'production',
        },
      };

      const parsed = parseConfig(config);

      expect(parsed.service.name).toBe('test-service');
      expect(parsed.service.version).toBe('1.2.3');
      expect(parsed.service.namespace).toBe('production');
    });

    it('should parse exporter config (URL + headers)', () => {
      const config: EdgeConfig = {
        service: { name: 'test-service' },
        exporter: {
          url: 'https://api.honeycomb.io/v1/traces',
          headers: { 'x-api-key': 'test-key' },
        },
      };

      const parsed = parseConfig(config);

      expect(parsed.spanProcessors).toHaveLength(1);
      expect(parsed.spanProcessors[0]).toBeDefined();
    });

    it('should create SpanProcessor from exporter', () => {
      const config: EdgeConfig = {
        service: { name: 'test-service' },
        exporter: {
          url: 'http://localhost:4318/v1/traces',
        },
      };

      const parsed = parseConfig(config);

      expect(parsed.spanProcessors).toBeDefined();
      expect(Array.isArray(parsed.spanProcessors)).toBe(true);
      expect(parsed.spanProcessors.length).toBeGreaterThan(0);
    });

    it('should accept custom SpanProcessor array', () => {
      const mockSpanProcessor = {
        onStart: () => {},
        onEnd: () => {},
        forceFlush: async () => {},
        shutdown: async () => {},
      };

      const config: EdgeConfig = {
        service: { name: 'test-service' },
        spanProcessors: [mockSpanProcessor as any],
      };

      const parsed = parseConfig(config);

      expect(parsed.spanProcessors).toHaveLength(1);
      expect(parsed.spanProcessors[0]).toBe(mockSpanProcessor);
    });

    it('should use AlwaysOnSampler as default head sampler', () => {
      const config: EdgeConfig = {
        service: { name: 'test-service' },
      };

      const parsed = parseConfig(config);

      expect(parsed.sampling.headSampler).toBeDefined();
      // Default is ParentBasedSampler with AlwaysOnSampler root
      expect(parsed.sampling.headSampler.toString()).toContain('ParentBased');
    });

    it('should create ParentRatioSampler from ratio config', () => {
      const config: EdgeConfig = {
        service: { name: 'test-service' },
        sampling: {
          headSampler: {
            ratio: 0.5,
            acceptRemote: true,
          },
        },
      };

      const parsed = parseConfig(config);

      expect(parsed.sampling.headSampler).toBeDefined();
      // Should be ParentBasedSampler wrapping ratio sampler
      expect(parsed.sampling.headSampler.toString()).toContain('ParentBased');
    });

    it('should use default tail sampler (keep sampled or errors)', () => {
      const config: EdgeConfig = {
        service: { name: 'test-service' },
      };

      const parsed = parseConfig(config);

      expect(parsed.sampling.tailSampler).toBeDefined();
      expect(typeof parsed.sampling.tailSampler).toBe('function');
    });

    it('should accept custom tail sampler', () => {
      const customTailSampler = () => true;

      const config: EdgeConfig = {
        service: { name: 'test-service' },
        sampling: {
          tailSampler: customTailSampler,
        },
      };

      const parsed = parseConfig(config);

      expect(parsed.sampling.tailSampler).toBe(customTailSampler);
    });

    it('should use W3CTraceContextPropagator as default', () => {
      const config: EdgeConfig = {
        service: { name: 'test-service' },
      };

      const parsed = parseConfig(config);

      expect(parsed.propagator).toBeDefined();
      expect(parsed.propagator.constructor.name).toBe('W3CTraceContextPropagator');
    });

    it('should accept custom propagator', () => {
      const mockPropagator = {
        inject: () => {},
        extract: () => ({} as any),
        fields: () => [],
      };

      const config: EdgeConfig = {
        service: { name: 'test-service' },
        propagator: mockPropagator as any,
      };

      const parsed = parseConfig(config);

      expect(parsed.propagator).toBe(mockPropagator);
    });

    it('should enable global fetch instrumentation by default', () => {
      const config: EdgeConfig = {
        service: { name: 'test-service' },
      };

      const parsed = parseConfig(config);

      expect(parsed.instrumentation.instrumentGlobalFetch).toBe(true);
    });

    it('should disable global cache instrumentation by default', () => {
      const config: EdgeConfig = {
        service: { name: 'test-service' },
      };

      const parsed = parseConfig(config);

      expect(parsed.instrumentation.instrumentGlobalCache).toBe(false);
    });

    it('should allow enabling cache instrumentation', () => {
      const config: EdgeConfig = {
        service: { name: 'test-service' },
        instrumentation: {
          instrumentGlobalCache: true,
        },
      };

      const parsed = parseConfig(config);

      expect(parsed.instrumentation.instrumentGlobalCache).toBe(true);
    });

    it('should use default fetch.includeTraceContext = true', () => {
      const config: EdgeConfig = {
        service: { name: 'test-service' },
      };

      const parsed = parseConfig(config);

      expect(parsed.fetch.includeTraceContext).toBe(true);
    });

    it('should accept custom fetch.includeTraceContext function', () => {
      const customFn = (request: Request) => request.url.includes('internal');

      const config: EdgeConfig = {
        service: { name: 'test-service' },
        fetch: {
          includeTraceContext: customFn,
        },
      };

      const parsed = parseConfig(config);

      expect(parsed.fetch.includeTraceContext).toBe(customFn);
    });
  });

  describe('createInitialiser()', () => {
    it('should create initialiser from static config', () => {
      const config: EdgeConfig = {
        service: { name: 'test-service' },
      };

      const initialiser = createInitialiser(config);

      expect(typeof initialiser).toBe('function');

      const resolved = initialiser({}, { request: null as any });

      expect(resolved.service.name).toBe('test-service');
    });

    it('should create initialiser from config function', () => {
      const configFn = (env: { SERVICE_NAME: string }) => ({
        service: { name: env.SERVICE_NAME },
      });

      const initialiser = createInitialiser(configFn);

      expect(typeof initialiser).toBe('function');

      const resolved = initialiser({ SERVICE_NAME: 'dynamic-service' }, { request: null as any });

      expect(resolved.service.name).toBe('dynamic-service');
    });

    it('should pass env and trigger to config function', () => {
      const configFn = vi.fn((env: any, trigger: any) => ({
        service: { name: 'test' },
      }));

      const initialiser = createInitialiser(configFn);

      const mockEnv = { API_KEY: 'test-key' };
      const mockTrigger = { request: new Request('http://example.com') };

      initialiser(mockEnv, mockTrigger);

      expect(configFn).toHaveBeenCalledWith(mockEnv, mockTrigger);
    });
  });

  describe('getActiveConfig() / setConfig()', () => {
    beforeEach(() => {
      // Reset active config before each test
      setConfig(null as any);
    });

    it('should store and retrieve active config', () => {
      const config: EdgeConfig = {
        service: { name: 'test-service' },
      };

      const parsed = parseConfig(config);
      const ctx = setConfig(parsed);

      // Use api_context.with() to activate the context
      api_context.with(ctx, () => {
        const active = getActiveConfig();
        expect(active).toBe(parsed);
        expect(active?.service.name).toBe('test-service');
      });
    });

    it('should return null when no active config', () => {
      const ctx = setConfig(null as any);

      api_context.with(ctx, () => {
        const active = getActiveConfig();
        expect(active).toBeNull();
      });
    });

    it('should allow updating active config', () => {
      const config1 = parseConfig({
        service: { name: 'service-1' },
      });

      const ctx1 = setConfig(config1);
      api_context.with(ctx1, () => {
        expect(getActiveConfig()?.service.name).toBe('service-1');
      });

      const config2 = parseConfig({
        service: { name: 'service-2' },
      });

      const ctx2 = setConfig(config2);
      api_context.with(ctx2, () => {
        expect(getActiveConfig()?.service.name).toBe('service-2');
      });
    });
  });

  describe('Config context isolation', () => {
    it('should isolate config per context using setConfig() return value', () => {
      const config1 = parseConfig({
        service: { name: 'service-1' },
      });

      const config2 = parseConfig({
        service: { name: 'service-2' },
      });

      // Create separate contexts
      const context1 = setConfig(config1);
      const context2 = setConfig(config2);

      // Verify contexts are different
      expect(context1).not.toBe(context2);
    });

    it('should use OpenTelemetry context for storage', () => {
      const config = parseConfig({
        service: { name: 'test-service' },
      });

      const context = setConfig(config);

      // setConfig should return a context object
      expect(context).toBeDefined();
      expect(typeof context).toBe('object');
    });

    it('should not have race conditions with context-based storage', () => {
      // This test verifies the fix for the config race condition bug
      // where module-level state caused request B to overwrite request A's config

      const configA = parseConfig({
        service: { name: 'request-a' },
      });

      const configB = parseConfig({
        service: { name: 'request-b' },
      });

      // Simulate setting configs for different requests
      const contextA = setConfig(configA);
      const contextB = setConfig(configB);

      // Both contexts should exist independently
      expect(contextA).not.toBe(contextB);

      // Each context has its own config that doesn't interfere with the other
      api_context.with(contextA, () => {
        const activeConfig = getActiveConfig();
        expect(activeConfig?.service.name).toBe('request-a');
      });

      api_context.with(contextB, () => {
        const activeConfig = getActiveConfig();
        expect(activeConfig?.service.name).toBe('request-b');
      });

      // This demonstrates that configs are properly isolated per context
    });
  });
});
