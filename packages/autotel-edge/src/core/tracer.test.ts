import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkerTracer } from './tracer';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SamplingDecision, type SpanProcessor } from '@opentelemetry/sdk-trace-base';

describe('WorkerTracer', () => {
  let tracer: WorkerTracer;
  let mockProcessor: SpanProcessor;
  let mockHeadSampler: any;

  beforeEach(() => {
    mockProcessor = {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      shutdown: vi.fn(async () => {}),
      forceFlush: vi.fn(async () => {}),
    };

    mockHeadSampler = {
      shouldSample: vi.fn(() => ({
        decision: SamplingDecision.RECORD_AND_SAMPLED,
        attributes: {},
        traceState: undefined,
      })),
      toString: () => 'MockHeadSampler',
    };

    const resource = resourceFromAttributes({});
    tracer = new WorkerTracer([mockProcessor], resource);
    tracer.setHeadSampler(mockHeadSampler);
  });

  describe('Per-span sampler', () => {
    it('should use per-span sampler when provided in options', () => {
      const perSpanSampler = {
        shouldSample: vi.fn(() => ({
          decision: SamplingDecision.NOT_RECORD,
          attributes: {},
          traceState: undefined,
        })),
        toString: () => 'PerSpanSampler',
      };

      const options: any = { sampler: perSpanSampler };
      tracer.startSpan('test.span', options);

      // Per-span sampler should be called, NOT head sampler
      expect(perSpanSampler.shouldSample).toHaveBeenCalledTimes(1);
      expect(mockHeadSampler.shouldSample).not.toHaveBeenCalled();
    });

    it('should use head sampler when no per-span sampler provided', () => {
      tracer.startSpan('test.span', {});

      // Head sampler should be called
      expect(mockHeadSampler.shouldSample).toHaveBeenCalledTimes(1);
    });

    it('should pass correct arguments to per-span sampler', () => {
      const perSpanSampler = {
        shouldSample: vi.fn(() => ({
          decision: SamplingDecision.RECORD_AND_SAMPLED,
          attributes: {},
          traceState: undefined,
        })),
        toString: () => 'PerSpanSampler',
      };

      const options: any = {
        sampler: perSpanSampler,
        attributes: { 'test.attr': 'value' },
      };

      tracer.startSpan('test.span', options);

      // Verify sampler was called with correct arguments
      expect(perSpanSampler.shouldSample).toHaveBeenCalledWith(
        expect.anything(), // context
        expect.any(String), // traceId
        'test.span', // span name
        expect.any(Number), // spanKind
        expect.objectContaining({ 'test.attr': 'value' }), // attributes
        [], // links
      );
    });

    it('should respect per-span sampler decision to NOT_RECORD', () => {
      const rejectingSampler = {
        shouldSample: vi.fn(() => ({
          decision: SamplingDecision.NOT_RECORD,
          attributes: {},
          traceState: undefined,
        })),
        toString: () => 'RejectingSampler',
      };

      const options: any = { sampler: rejectingSampler };
      const span = tracer.startSpan('test.span', options);

      // Span should be created but not sampled
      expect(span).toBeDefined();
      expect(span.spanContext().traceFlags & 1).toBe(0); // Not sampled
    });

    it('should respect per-span sampler decision to RECORD_AND_SAMPLED', () => {
      const acceptingSampler = {
        shouldSample: vi.fn(() => ({
          decision: SamplingDecision.RECORD_AND_SAMPLED,
          attributes: {},
          traceState: undefined,
        })),
        toString: () => 'AcceptingSampler',
      };

      const options: any = { sampler: acceptingSampler };
      const span = tracer.startSpan('test.span', options);

      // Span should be created and sampled
      expect(span).toBeDefined();
      expect(span.spanContext().traceFlags & 1).toBe(1); // Sampled
    });
  });
});
