import { describe, it, expect } from 'vitest';
import {
  createAdaptiveTailSampler,
  createRandomTailSampler,
  createErrorOnlyTailSampler,
  createSlowOnlyTailSampler,
  combineTailSamplers,
  SamplingPresets,
  type LocalTrace,
} from './index';
import { SpanStatusCode } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

// Helper to create a mock span
function createMockSpan(overrides: Partial<ReadableSpan> = {}): ReadableSpan {
  const now = Date.now();
  return {
    name: 'test-span',
    spanContext: () => ({
      traceId: 'test-trace-id',
      spanId: 'test-span-id',
      traceFlags: 1,
    }),
    startTime: [Math.floor(now / 1000), (now % 1000) * 1_000_000],
    endTime: [Math.floor(now / 1000), (now % 1000) * 1_000_000],
    status: { code: SpanStatusCode.UNSET },
    attributes: {},
    links: [],
    events: [],
    duration: [0, 0],
    ended: true,
    resource: {} as any,
    instrumentationLibrary: { name: 'test', version: '1.0.0' },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    kind: 0,
    parentSpanId: undefined,
    ...overrides,
  } as ReadableSpan;
}

// Helper to create a LocalTrace
function createLocalTrace(
  traceId: string,
  spanOverrides: Partial<ReadableSpan> = {},
): LocalTrace {
  return {
    traceId,
    localRootSpan: createMockSpan(spanOverrides),
    spans: [createMockSpan(spanOverrides)],
  };
}

describe('Sampling Strategies', () => {
  describe('createAdaptiveTailSampler', () => {
    it('should sample based on baseline rate for normal requests', () => {
      const sampler = createAdaptiveTailSampler({ baselineSampleRate: 0.5 });

      // Create multiple traces and check sampling distribution
      const traces = Array.from({ length: 100 }, (_, i) =>
        createLocalTrace(`trace-${i}`, { status: { code: SpanStatusCode.UNSET } }),
      );

      const sampled = traces.filter((trace) => sampler(trace));

      // Should be roughly 50% sampled (allow some variance)
      expect(sampled.length).toBeGreaterThan(30);
      expect(sampled.length).toBeLessThan(70);
    });

    it('should always sample errors when alwaysSampleErrors is true', () => {
      const sampler = createAdaptiveTailSampler({
        baselineSampleRate: 0,
        alwaysSampleErrors: true,
      });

      const errorTrace = createLocalTrace('error-trace', {
        status: { code: SpanStatusCode.ERROR, message: 'Test error' },
      });

      expect(sampler(errorTrace)).toBe(true);
    });

    it('should not sample errors when alwaysSampleErrors is false', () => {
      const sampler = createAdaptiveTailSampler({
        baselineSampleRate: 0,
        alwaysSampleErrors: false,
      });

      const errorTrace = createLocalTrace('error-trace', {
        status: { code: SpanStatusCode.ERROR, message: 'Test error' },
      });

      expect(sampler(errorTrace)).toBe(false);
    });

    it('should always sample slow requests when alwaysSampleSlow is true', () => {
      const now = Date.now();
      const sampler = createAdaptiveTailSampler({
        baselineSampleRate: 0,
        slowThresholdMs: 1000,
        alwaysSampleSlow: true,
      });

      const slowTrace = createLocalTrace('slow-trace', {
        startTime: [Math.floor(now / 1000), (now % 1000) * 1_000_000],
        endTime: [Math.floor((now + 2000) / 1000), ((now + 2000) % 1000) * 1_000_000],
      });

      expect(sampler(slowTrace)).toBe(true);
    });

    it('should not sample slow requests when alwaysSampleSlow is false', () => {
      const now = Date.now();
      const sampler = createAdaptiveTailSampler({
        baselineSampleRate: 0,
        slowThresholdMs: 1000,
        alwaysSampleSlow: false,
      });

      const slowTrace = createLocalTrace('slow-trace', {
        startTime: [Math.floor(now / 1000), (now % 1000) * 1_000_000],
        endTime: [Math.floor((now + 2000) / 1000), ((now + 2000) % 1000) * 1_000_000],
      });

      expect(sampler(slowTrace)).toBe(false);
    });

    it('should maintain consistent baseline decision for same trace', () => {
      const sampler = createAdaptiveTailSampler({ baselineSampleRate: 0.5 });

      const trace1 = createLocalTrace('consistent-trace');
      const decision1 = sampler(trace1);

      // Create new trace with same ID
      const trace2 = createLocalTrace('consistent-trace');
      const decision2 = sampler(trace2);

      expect(decision1).toBe(decision2);
    });
  });

  describe('createRandomTailSampler', () => {
    it('should sample at specified rate', () => {
      const sampler = createRandomTailSampler(0.5);

      const traces = Array.from({ length: 100 }, (_, i) =>
        createLocalTrace(`trace-${i}`),
      );

      const sampled = traces.filter((trace) => sampler(trace));

      // Should be roughly 50% sampled
      expect(sampled.length).toBeGreaterThan(30);
      expect(sampled.length).toBeLessThan(70);
    });

    it('should never sample when rate is 0', () => {
      const sampler = createRandomTailSampler(0);

      const traces = Array.from({ length: 100 }, (_, i) =>
        createLocalTrace(`trace-${i}`),
      );

      const sampled = traces.filter((trace) => sampler(trace));

      expect(sampled.length).toBe(0);
    });

    it('should always sample when rate is 1', () => {
      const sampler = createRandomTailSampler(1);

      const traces = Array.from({ length: 100 }, (_, i) =>
        createLocalTrace(`trace-${i}`),
      );

      const sampled = traces.filter((trace) => sampler(trace));

      expect(sampled.length).toBe(100);
    });
  });

  describe('createErrorOnlyTailSampler', () => {
    it('should only sample errors', () => {
      const sampler = createErrorOnlyTailSampler();

      const errorTrace = createLocalTrace('error-trace', {
        status: { code: SpanStatusCode.ERROR },
      });
      const okTrace = createLocalTrace('ok-trace', {
        status: { code: SpanStatusCode.OK },
      });
      const unsetTrace = createLocalTrace('unset-trace', {
        status: { code: SpanStatusCode.UNSET },
      });

      expect(sampler(errorTrace)).toBe(true);
      expect(sampler(okTrace)).toBe(false);
      expect(sampler(unsetTrace)).toBe(false);
    });
  });

  describe('createSlowOnlyTailSampler', () => {
    it('should only sample slow requests', () => {
      const now = Date.now();
      const sampler = createSlowOnlyTailSampler(1000);

      const fastTrace = createLocalTrace('fast-trace', {
        startTime: [Math.floor(now / 1000), (now % 1000) * 1_000_000],
        endTime: [Math.floor((now + 500) / 1000), ((now + 500) % 1000) * 1_000_000],
      });

      const slowTrace = createLocalTrace('slow-trace', {
        startTime: [Math.floor(now / 1000), (now % 1000) * 1_000_000],
        endTime: [Math.floor((now + 2000) / 1000), ((now + 2000) % 1000) * 1_000_000],
      });

      expect(sampler(fastTrace)).toBe(false);
      expect(sampler(slowTrace)).toBe(true);
    });
  });

  describe('combineTailSamplers', () => {
    it('should sample if any sampler returns true (OR logic)', () => {
      const errorSampler = createErrorOnlyTailSampler();
      const slowSampler = createSlowOnlyTailSampler(1000);
      const combined = combineTailSamplers(errorSampler, slowSampler);

      const now = Date.now();

      // Error but fast - should sample
      const errorTrace = createLocalTrace('error-trace', {
        status: { code: SpanStatusCode.ERROR },
        startTime: [Math.floor(now / 1000), (now % 1000) * 1_000_000],
        endTime: [Math.floor((now + 500) / 1000), ((now + 500) % 1000) * 1_000_000],
      });

      // OK but slow - should sample
      const slowTrace = createLocalTrace('slow-trace', {
        status: { code: SpanStatusCode.OK },
        startTime: [Math.floor(now / 1000), (now % 1000) * 1_000_000],
        endTime: [Math.floor((now + 2000) / 1000), ((now + 2000) % 1000) * 1_000_000],
      });

      // OK and fast - should not sample
      const normalTrace = createLocalTrace('normal-trace', {
        status: { code: SpanStatusCode.OK },
        startTime: [Math.floor(now / 1000), (now % 1000) * 1_000_000],
        endTime: [Math.floor((now + 500) / 1000), ((now + 500) % 1000) * 1_000_000],
      });

      expect(combined(errorTrace)).toBe(true);
      expect(combined(slowTrace)).toBe(true);
      expect(combined(normalTrace)).toBe(false);
    });
  });

  describe('SamplingPresets', () => {
    it('should have production preset', () => {
      const sampler = SamplingPresets.production();
      expect(typeof sampler).toBe('function');
    });

    it('should have highTraffic preset', () => {
      const sampler = SamplingPresets.highTraffic();
      expect(typeof sampler).toBe('function');
    });

    it('should have debugging preset', () => {
      const sampler = SamplingPresets.debugging();
      expect(typeof sampler).toBe('function');
    });

    it('should have development preset', () => {
      const sampler = SamplingPresets.development();
      expect(typeof sampler).toBe('function');
    });

    it('production preset should capture errors and slow requests', () => {
      const sampler = SamplingPresets.production();
      const now = Date.now();

      const errorTrace = createLocalTrace('error-trace', {
        status: { code: SpanStatusCode.ERROR },
      });

      const slowTrace = createLocalTrace('slow-trace', {
        startTime: [Math.floor(now / 1000), (now % 1000) * 1_000_000],
        endTime: [Math.floor((now + 2000) / 1000), ((now + 2000) % 1000) * 1_000_000],
      });

      expect(sampler(errorTrace)).toBe(true);
      expect(sampler(slowTrace)).toBe(true);
    });
  });
});
