import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { instrumentAnalyticsEngine } from './analytics-engine';
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';

describe('Analytics Engine Instrumentation', () => {
  let mockTracer: any;
  let mockSpan: any;
  let getTracerSpy: any;
  let mockAE: any;

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

    mockAE = {
      writeDataPoint: vi.fn(),
      someOtherMethod: vi.fn(() => 'passthrough-value'),
    };
  });

  afterEach(() => {
    getTracerSpy.mockRestore();
  });

  describe('writeDataPoint()', () => {
    it('should create span with correct attributes', () => {
      const instrumented = instrumentAnalyticsEngine(mockAE, 'my-dataset');

      instrumented.writeDataPoint({
        indexes: ['idx1'],
        doubles: [1, 2],
        blobs: ['blob1'],
      });

      expect(mockTracer.startActiveSpan).toHaveBeenCalledTimes(1);

      const [spanName, spanOptions] = mockTracer.startActiveSpan.mock.calls[0];
      expect(spanName).toBe('AnalyticsEngine my-dataset: writeDataPoint');
      expect(spanOptions.kind).toBe(SpanKind.CLIENT);
      expect(spanOptions.attributes['analytics.system']).toBe('cloudflare-analytics-engine');
      expect(spanOptions.attributes['analytics.operation']).toBe('writeDataPoint');
    });

    it('should record indexes_count, doubles_count, blobs_count', () => {
      const instrumented = instrumentAnalyticsEngine(mockAE, 'my-dataset');

      instrumented.writeDataPoint({
        indexes: ['idx1', 'idx2'],
        doubles: [1, 2, 3],
        blobs: ['blob1'],
      });

      const spanOptions = mockTracer.startActiveSpan.mock.calls[0][1];
      expect(spanOptions.attributes['analytics.indexes_count']).toBe(2);
      expect(spanOptions.attributes['analytics.doubles_count']).toBe(3);
      expect(spanOptions.attributes['analytics.blobs_count']).toBe(1);
    });

    it('should handle a single index (non-array) by recording indexes_count as 1', () => {
      const instrumented = instrumentAnalyticsEngine(mockAE, 'my-dataset');

      instrumented.writeDataPoint({
        indexes: 'single-index' as any,
      });

      const spanOptions = mockTracer.startActiveSpan.mock.calls[0][1];
      expect(spanOptions.attributes['analytics.indexes_count']).toBe(1);
    });

    it('should work with no datapoint argument', () => {
      const instrumented = instrumentAnalyticsEngine(mockAE);

      instrumented.writeDataPoint(undefined as any);

      expect(mockTracer.startActiveSpan).toHaveBeenCalledTimes(1);

      const spanOptions = mockTracer.startActiveSpan.mock.calls[0][1];
      expect(spanOptions.attributes['analytics.system']).toBe('cloudflare-analytics-engine');
      expect(spanOptions.attributes['analytics.operation']).toBe('writeDataPoint');
      // No count attributes should be set when no datapoint
      expect(spanOptions.attributes['analytics.indexes_count']).toBeUndefined();
      expect(spanOptions.attributes['analytics.doubles_count']).toBeUndefined();
      expect(spanOptions.attributes['analytics.blobs_count']).toBeUndefined();

      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should handle errors by recording exception and rethrowing', () => {
      const error = new Error('writeDataPoint failed');
      mockAE.writeDataPoint = vi.fn(() => {
        throw error;
      });

      const instrumented = instrumentAnalyticsEngine(mockAE, 'my-dataset');

      expect(() => instrumented.writeDataPoint({ indexes: ['idx1'] })).toThrow('writeDataPoint failed');

      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'writeDataPoint failed',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should use default dataset name when none provided', () => {
      const instrumented = instrumentAnalyticsEngine(mockAE);

      instrumented.writeDataPoint({ indexes: ['idx1'] });

      const spanName = mockTracer.startActiveSpan.mock.calls[0][0];
      expect(spanName).toBe('AnalyticsEngine analytics-engine: writeDataPoint');
    });

    it('should set OK status and end span on success', () => {
      const instrumented = instrumentAnalyticsEngine(mockAE, 'my-dataset');

      instrumented.writeDataPoint({ doubles: [42] });

      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
      expect(mockSpan.end).toHaveBeenCalled();
      expect(mockAE.writeDataPoint).toHaveBeenCalledWith({ doubles: [42] });
    });
  });

  describe('this-binding', () => {
    it('should invoke writeDataPoint() with original object as this, not the proxy', () => {
      let receivedThis: any;
      const mockAEObj = {
        writeDataPoint: vi.fn(function(this: any) {
          // eslint-disable-next-line unicorn/no-this-assignment, @typescript-eslint/no-this-alias
          receivedThis = this;
        }),
      };
      const instrumented = instrumentAnalyticsEngine(mockAEObj as any, 'test');
      instrumented.writeDataPoint({ indexes: ['idx1'] });
      expect(receivedThis).toBe(mockAEObj);
    });
  });

  describe('Non-instrumented methods', () => {
    it('should pass through non-instrumented methods unchanged', () => {
      const instrumented = instrumentAnalyticsEngine(mockAE, 'my-dataset');

      const result = instrumented.someOtherMethod();

      expect(result).toBe('passthrough-value');
      expect(mockAE.someOtherMethod).toHaveBeenCalled();
      // No span should be created for non-instrumented methods
      expect(mockTracer.startActiveSpan).not.toHaveBeenCalled();
    });
  });
});
