/**
 * Tests for tail sampling span processor
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TailSamplingSpanProcessor } from './tail-sampling-processor';
import {
  AUTOTEL_SAMPLING_TAIL_KEEP,
  AUTOTEL_SAMPLING_TAIL_EVALUATED,
} from './sampling';
import type {
  SpanProcessor,
  ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import type { Context } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/sdk-trace-base';

// Mock span processor
class MockSpanProcessor implements SpanProcessor {
  public startedSpans: Span[] = [];
  public endedSpans: ReadableSpan[] = [];
  public flushed = false;
  public shutdownCalled = false;

  onStart(span: Span): void {
    this.startedSpans.push(span);
  }

  onEnd(span: ReadableSpan): void {
    this.endedSpans.push(span);
  }

  async forceFlush(): Promise<void> {
    this.flushed = true;
  }

  async shutdown(): Promise<void> {
    this.shutdownCalled = true;
  }

  reset(): void {
    this.startedSpans = [];
    this.endedSpans = [];
    this.flushed = false;
    this.shutdownCalled = false;
  }
}

// Create mock ReadableSpan
function createMockSpan(attributes: Record<string, unknown>): ReadableSpan {
  return {
    attributes,
    name: 'test-span',
    spanContext: () => ({
      traceId: 'trace123',
      spanId: 'span123',
      traceFlags: 1,
    }),
  } as ReadableSpan;
}

describe('TailSamplingSpanProcessor', () => {
  let mockProcessor: MockSpanProcessor;
  let tailSamplingProcessor: TailSamplingSpanProcessor;

  beforeEach(() => {
    mockProcessor = new MockSpanProcessor();
    tailSamplingProcessor = new TailSamplingSpanProcessor(mockProcessor);
  });

  describe('Span forwarding', () => {
    it('should forward span to wrapped processor on onStart', () => {
      const mockSpan = {} as Span;
      const mockContext = {} as Context;

      tailSamplingProcessor.onStart(mockSpan, mockContext);

      expect(mockProcessor.startedSpans).toHaveLength(1);
      expect(mockProcessor.startedSpans[0]).toBe(mockSpan);
    });

    it('should forward spans without tail sampling attributes', () => {
      const span = createMockSpan({ foo: 'bar' });

      tailSamplingProcessor.onEnd(span);

      expect(mockProcessor.endedSpans).toHaveLength(1);
      expect(mockProcessor.endedSpans[0]).toBe(span);
    });

    it('should forward spans marked to keep (sampling.tail.keep = true)', () => {
      const span = createMockSpan({
        [AUTOTEL_SAMPLING_TAIL_EVALUATED]: true,
        [AUTOTEL_SAMPLING_TAIL_KEEP]: true,
      });

      tailSamplingProcessor.onEnd(span);

      expect(mockProcessor.endedSpans).toHaveLength(1);
      expect(mockProcessor.endedSpans[0]).toBe(span);
    });
  });

  describe('Span dropping', () => {
    it('should drop spans marked to drop (sampling.tail.keep = false)', () => {
      const span = createMockSpan({
        [AUTOTEL_SAMPLING_TAIL_EVALUATED]: true,
        [AUTOTEL_SAMPLING_TAIL_KEEP]: false,
      });

      tailSamplingProcessor.onEnd(span);

      // Span should NOT be forwarded
      expect(mockProcessor.endedSpans).toHaveLength(0);
    });

    it('should drop multiple spans marked as false', () => {
      const span1 = createMockSpan({
        [AUTOTEL_SAMPLING_TAIL_EVALUATED]: true,
        [AUTOTEL_SAMPLING_TAIL_KEEP]: false,
      });

      const span2 = createMockSpan({
        [AUTOTEL_SAMPLING_TAIL_EVALUATED]: true,
        [AUTOTEL_SAMPLING_TAIL_KEEP]: false,
      });

      tailSamplingProcessor.onEnd(span1);
      tailSamplingProcessor.onEnd(span2);

      expect(mockProcessor.endedSpans).toHaveLength(0);
    });
  });

  describe('Edge cases', () => {
    it('should forward spans when only evaluated but no keep attribute', () => {
      const span = createMockSpan({
        [AUTOTEL_SAMPLING_TAIL_EVALUATED]: true,
        // Missing AUTOTEL_SAMPLING_TAIL_KEEP
      });

      tailSamplingProcessor.onEnd(span);

      // Should forward (undefined !== false)
      expect(mockProcessor.endedSpans).toHaveLength(1);
    });

    it('should forward spans when only keep but not evaluated', () => {
      const span = createMockSpan({
        // Missing AUTOTEL_SAMPLING_TAIL_EVALUATED
        [AUTOTEL_SAMPLING_TAIL_KEEP]: false,
      });

      tailSamplingProcessor.onEnd(span);

      // Should forward (evaluated !== true)
      expect(mockProcessor.endedSpans).toHaveLength(1);
    });

    it('should handle mixed spans (some kept, some dropped)', () => {
      const keptSpan1 = createMockSpan({ foo: 'bar' });
      const droppedSpan = createMockSpan({
        [AUTOTEL_SAMPLING_TAIL_EVALUATED]: true,
        [AUTOTEL_SAMPLING_TAIL_KEEP]: false,
      });
      const keptSpan2 = createMockSpan({
        [AUTOTEL_SAMPLING_TAIL_EVALUATED]: true,
        [AUTOTEL_SAMPLING_TAIL_KEEP]: true,
      });

      tailSamplingProcessor.onEnd(keptSpan1);
      tailSamplingProcessor.onEnd(droppedSpan);
      tailSamplingProcessor.onEnd(keptSpan2);

      expect(mockProcessor.endedSpans).toHaveLength(2);
      expect(mockProcessor.endedSpans[0]).toBe(keptSpan1);
      expect(mockProcessor.endedSpans[1]).toBe(keptSpan2);
    });
  });

  describe('Lifecycle methods', () => {
    it('should forward forceFlush to wrapped processor', async () => {
      await tailSamplingProcessor.forceFlush();

      expect(mockProcessor.flushed).toBe(true);
    });

    it('should forward shutdown to wrapped processor', async () => {
      await tailSamplingProcessor.shutdown();

      expect(mockProcessor.shutdownCalled).toBe(true);
    });
  });

  describe('Integration with sampling strategy', () => {
    it('should work with adaptive sampling pattern', () => {
      // Simulate adaptive sampling flow:
      // 1. Fast successful request (drop)
      // 2. Slow request (keep)
      // 3. Error request (keep)

      const fastSpan = createMockSpan({
        [AUTOTEL_SAMPLING_TAIL_EVALUATED]: true,
        [AUTOTEL_SAMPLING_TAIL_KEEP]: false, // Fast, no errors
        duration: 50,
      });

      const slowSpan = createMockSpan({
        [AUTOTEL_SAMPLING_TAIL_EVALUATED]: true,
        [AUTOTEL_SAMPLING_TAIL_KEEP]: true, // Slow request
        duration: 1000,
      });

      const errorSpan = createMockSpan({
        [AUTOTEL_SAMPLING_TAIL_EVALUATED]: true,
        [AUTOTEL_SAMPLING_TAIL_KEEP]: true, // Had error
        error: true,
      });

      tailSamplingProcessor.onEnd(fastSpan);
      tailSamplingProcessor.onEnd(slowSpan);
      tailSamplingProcessor.onEnd(errorSpan);

      // Only slow and error spans should be forwarded
      expect(mockProcessor.endedSpans).toHaveLength(2);
      expect(mockProcessor.endedSpans[0]).toBe(slowSpan);
      expect(mockProcessor.endedSpans[1]).toBe(errorSpan);
    });
  });
});
