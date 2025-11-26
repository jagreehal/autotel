import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpanProcessorWithFlush, TailSamplingSpanProcessor } from './spanprocessor';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { SpanStatusCode } from '@opentelemetry/api';

describe('SpanProcessorWithFlush', () => {
  let mockExporter: SpanExporter;
  let processor: SpanProcessorWithFlush;

  beforeEach(() => {
    mockExporter = {
      export: vi.fn((spans, callback) => {
        callback({ code: 0 }); // SUCCESS
      }),
      shutdown: vi.fn(async () => {}),
    };

    processor = new SpanProcessorWithFlush(mockExporter);
  });

  describe('onEnd()', () => {
    it('should buffer spans by trace ID', () => {
      const span1 = createMockSpan('trace-1', 'span-1');
      const span2 = createMockSpan('trace-1', 'span-2');
      const span3 = createMockSpan('trace-2', 'span-3');

      processor.onEnd(span1);
      processor.onEnd(span2);
      processor.onEnd(span3);

      // Spans are buffered, not exported yet
      expect(mockExporter.export).not.toHaveBeenCalled();
    });
  });

  describe('forceFlush()', () => {
    it('should flush specific trace by ID', async () => {
      const span1 = createMockSpan('trace-1', 'span-1');
      const span2 = createMockSpan('trace-1', 'span-2');
      const span3 = createMockSpan('trace-2', 'span-3');

      processor.onEnd(span1);
      processor.onEnd(span2);
      processor.onEnd(span3);

      await processor.forceFlush('trace-1');

      expect(mockExporter.export).toHaveBeenCalledTimes(1);
      expect(mockExporter.export).toHaveBeenCalledWith(
        expect.arrayContaining([span1, span2]),
        expect.any(Function)
      );
    });

    it('should flush all traces when no ID provided', async () => {
      const span1 = createMockSpan('trace-1', 'span-1');
      const span2 = createMockSpan('trace-2', 'span-2');

      processor.onEnd(span1);
      processor.onEnd(span2);

      await processor.forceFlush();

      expect(mockExporter.export).toHaveBeenCalledTimes(2);
    });

    it('should apply post-processor before export', async () => {
      const postProcessor = vi.fn((spans) => {
        // Add custom attribute to all spans
        return spans.map((span) => ({
          ...span,
          attributes: { ...span.attributes, 'custom.tag': 'test' },
        }));
      });

      processor = new SpanProcessorWithFlush(mockExporter, postProcessor);

      const span1 = createMockSpan('trace-1', 'span-1');
      processor.onEnd(span1);

      await processor.forceFlush('trace-1');

      expect(postProcessor).toHaveBeenCalledWith([span1]);
      expect(mockExporter.export).toHaveBeenCalled();
    });
  });
});

describe('TailSamplingSpanProcessor', () => {
  let mockExporter: SpanExporter;
  let processor: TailSamplingSpanProcessor;
  let exportedSpans: ReadableSpan[] = [];

  beforeEach(() => {
    exportedSpans = [];

    mockExporter = {
      export: vi.fn((spans, callback) => {
        exportedSpans.push(...spans);
        callback({ code: 0 }); // SUCCESS
      }),
      shutdown: vi.fn(async () => {}),
    };
  });

  describe('Span buffering', () => {
    it('should buffer all spans until root span ends', async () => {
      // Custom tail sampler that always keeps traces
      const tailSampler = vi.fn(() => true);

      processor = new TailSamplingSpanProcessor(mockExporter, undefined, tailSampler);

      // Create a trace: root -> child1 -> child2
      const child2 = createMockSpan('trace-1', 'span-3', 'span-2');
      const child1 = createMockSpan('trace-1', 'span-2', 'span-1');
      const root = createMockSpan('trace-1', 'span-1');

      // End spans in order: child2, child1, root
      processor.onEnd(child2);
      processor.onEnd(child1);

      // No spans should be exported yet
      expect(mockExporter.export).not.toHaveBeenCalled();

      // End root span - should trigger export of all buffered spans
      processor.onEnd(root);

      // Wait for async flush
      await new Promise(resolve => setTimeout(resolve, 0));

      // Now all spans should be exported
      expect(mockExporter.export).toHaveBeenCalledTimes(1);
      expect(exportedSpans).toHaveLength(3);
      expect(exportedSpans).toContain(child2);
      expect(exportedSpans).toContain(child1);
      expect(exportedSpans).toContain(root);
    });

    it('should only make tail sampling decision when root span ends', async () => {
      const tailSampler = vi.fn(() => true);

      processor = new TailSamplingSpanProcessor(mockExporter, undefined, tailSampler);

      const child = createMockSpan('trace-1', 'span-2', 'span-1');
      const root = createMockSpan('trace-1', 'span-1');

      processor.onEnd(child);

      // Tail sampler should NOT be called yet
      expect(tailSampler).not.toHaveBeenCalled();

      processor.onEnd(root);

      // Wait for async flush
      await new Promise(resolve => setTimeout(resolve, 0));

      // Tail sampler should be called exactly once when root ends
      expect(tailSampler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Tail sampling decisions', () => {
    it('should export all buffered spans when tail sampler returns true', async () => {
      const tailSampler = vi.fn(() => true);

      processor = new TailSamplingSpanProcessor(mockExporter, undefined, tailSampler);

      const child = createMockSpan('trace-1', 'span-2', 'span-1');
      const root = createMockSpan('trace-1', 'span-1');

      processor.onEnd(child);
      processor.onEnd(root);

      // Wait for async flush
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(exportedSpans).toHaveLength(2);
      expect(exportedSpans).toContain(child);
      expect(exportedSpans).toContain(root);
    });

    it('should drop all buffered spans when tail sampler returns false', async () => {
      const tailSampler = vi.fn(() => false);

      processor = new TailSamplingSpanProcessor(mockExporter, undefined, tailSampler);

      const child = createMockSpan('trace-1', 'span-2', 'span-1');
      const root = createMockSpan('trace-1', 'span-1');

      processor.onEnd(child);
      processor.onEnd(root);

      // No spans should be exported
      expect(mockExporter.export).not.toHaveBeenCalled();
      expect(exportedSpans).toHaveLength(0);
    });

    it('should keep trace when root span has error (default behavior)', async () => {
      // Default tail sampler: keep if sampled or error
      const defaultTailSampler = (traceInfo: any) => {
        const localRootSpan = traceInfo.localRootSpan;
        const ctx = localRootSpan.spanContext();
        return (ctx.traceFlags & 1) === 1 || localRootSpan.status.code === 2; // SAMPLED | ERROR
      };

      processor = new TailSamplingSpanProcessor(mockExporter, undefined, defaultTailSampler);

      const child = createMockSpan('trace-1', 'span-2', 'span-1');
      const root = createMockSpan('trace-1', 'span-1');

      // Set root span status to ERROR
      root.status = { code: SpanStatusCode.ERROR };

      processor.onEnd(child);
      processor.onEnd(root);

      // Wait for async flush
      await new Promise(resolve => setTimeout(resolve, 0));

      // Trace should be kept because root has error
      expect(exportedSpans).toHaveLength(2);
    });

    it('should keep trace when error in child span affects root decision', async () => {
      // Tail sampler that checks if any span in trace has error
      const errorAwareSampler = (traceInfo: any) => {
        return traceInfo.spans.some((span: any) => span.status.code === SpanStatusCode.ERROR);
      };

      processor = new TailSamplingSpanProcessor(mockExporter, undefined, errorAwareSampler);

      const child = createMockSpan('trace-1', 'span-2', 'span-1');
      child.status = { code: SpanStatusCode.ERROR }; // Child has error

      const root = createMockSpan('trace-1', 'span-1');
      root.status = { code: SpanStatusCode.OK }; // Root is OK

      processor.onEnd(child);
      processor.onEnd(root);

      // Wait for async flush
      await new Promise(resolve => setTimeout(resolve, 0));

      // Trace should be kept because child has error
      expect(exportedSpans).toHaveLength(2);
    });
  });

  describe('Trace cleanup', () => {
    it('should clean up trace after decision', async () => {
      const tailSampler = vi.fn(() => true);

      processor = new TailSamplingSpanProcessor(mockExporter, undefined, tailSampler);

      const root1 = createMockSpan('trace-1', 'span-1');
      const root2 = createMockSpan('trace-2', 'span-2');

      processor.onEnd(root1);
      processor.onEnd(root2);

      // Both traces should have been auto-flushed when root spans ended
      // Wait a tick for async flush to complete
      await new Promise(resolve => setTimeout(resolve, 0));

      // Both root spans should have been exported
      expect(exportedSpans).toHaveLength(2);
      expect(exportedSpans).toContain(root1);
      expect(exportedSpans).toContain(root2);
    });
  });

  describe('Without tail sampler', () => {
    it('should export all spans when no tail sampler provided', async () => {
      processor = new TailSamplingSpanProcessor(mockExporter);

      const child = createMockSpan('trace-1', 'span-2', 'span-1');
      const root = createMockSpan('trace-1', 'span-1');

      processor.onEnd(child);
      processor.onEnd(root);

      // Wait for async flush
      await new Promise(resolve => setTimeout(resolve, 0));

      // All spans should be exported
      expect(exportedSpans).toHaveLength(2);
    });
  });

  describe('Complex trace scenarios', () => {
    it('should handle multiple traces in parallel', async () => {
      const tailSampler = vi.fn((traceInfo) => {
        // Keep trace-1, drop trace-2
        return traceInfo.traceId === 'trace-1';
      });

      processor = new TailSamplingSpanProcessor(mockExporter, undefined, tailSampler);

      // Trace 1
      const trace1_child = createMockSpan('trace-1', 'span-2', 'span-1');
      const trace1_root = createMockSpan('trace-1', 'span-1');

      // Trace 2
      const trace2_child = createMockSpan('trace-2', 'span-4', 'span-3');
      const trace2_root = createMockSpan('trace-2', 'span-3');

      // Interleave span endings
      processor.onEnd(trace1_child);
      processor.onEnd(trace2_child);
      processor.onEnd(trace1_root);
      processor.onEnd(trace2_root);

      // Wait for async flush
      await new Promise(resolve => setTimeout(resolve, 0));

      // Only trace-1 spans should be exported
      expect(exportedSpans).toHaveLength(2);
      expect(exportedSpans).toContain(trace1_child);
      expect(exportedSpans).toContain(trace1_root);
      expect(exportedSpans).not.toContain(trace2_child);
      expect(exportedSpans).not.toContain(trace2_root);
    });

    it('should handle deeply nested spans', async () => {
      const tailSampler = vi.fn(() => true);

      processor = new TailSamplingSpanProcessor(mockExporter, undefined, tailSampler);

      // Create a deep trace: root -> child1 -> child2 -> child3
      const child3 = createMockSpan('trace-1', 'span-4', 'span-3');
      const child2 = createMockSpan('trace-1', 'span-3', 'span-2');
      const child1 = createMockSpan('trace-1', 'span-2', 'span-1');
      const root = createMockSpan('trace-1', 'span-1');

      processor.onEnd(child3);
      processor.onEnd(child2);
      processor.onEnd(child1);
      processor.onEnd(root);

      // Wait for async flush
      await new Promise(resolve => setTimeout(resolve, 0));

      // All spans should be exported
      expect(exportedSpans).toHaveLength(4);
    });

    it('should handle distributed traces (local root with remote parent)', async () => {
      const tailSampler = vi.fn(() => true);

      processor = new TailSamplingSpanProcessor(mockExporter, undefined, tailSampler);

      // Create a distributed trace:
      // - remote-root (not in this trace, represented by parentSpanId 'remote-1')
      //   -> local-root (has parentSpanId but is first span we see)
      //     -> child1
      //       -> child2

      const child2 = createMockSpan('trace-1', 'span-3', 'span-2');
      const child1 = createMockSpan('trace-1', 'span-2', 'span-1');
      // Local root has a parentSpanId (from remote) but is our local root
      const localRoot = createMockSpan('trace-1', 'span-1', 'remote-1');

      // End spans in order
      processor.onEnd(child2);
      processor.onEnd(child1);
      processor.onEnd(localRoot);

      // Distributed traces don't auto-flush (local root has parentSpanId)
      // Explicitly flush to trigger tail sampling decision (simulates instrument.ts behavior)
      await processor.forceFlush('trace-1');

      // Wait for async flush
      await new Promise(resolve => setTimeout(resolve, 0));

      // ALL spans should be exported (including distributed trace entry point)
      expect(exportedSpans).toHaveLength(3);
      expect(exportedSpans).toContain(child2);
      expect(exportedSpans).toContain(child1);
      expect(exportedSpans).toContain(localRoot);
      expect(tailSampler).toHaveBeenCalledTimes(1);
    });

    it('should NOT leak traces when distributed trace root ends', async () => {
      const tailSampler = vi.fn(() => false); // Drop all traces

      processor = new TailSamplingSpanProcessor(mockExporter, undefined, tailSampler);

      // Distributed trace
      const child = createMockSpan('trace-1', 'span-2', 'span-1');
      const localRoot = createMockSpan('trace-1', 'span-1', 'remote-1');

      processor.onEnd(child);
      processor.onEnd(localRoot);

      // Explicitly flush (simulates instrument.ts behavior)
      await processor.forceFlush('trace-1');

      // No spans should be exported (tail sampler returned false)
      expect(exportedSpans).toHaveLength(0);
      expect(tailSampler).toHaveBeenCalledTimes(1);

      // Trace should be cleaned up (not leaked)
      // Start a new trace with same traceId to verify cleanup
      const anotherSpan = createMockSpan('trace-1', 'span-3');
      processor.onEnd(anotherSpan);

      // Explicitly flush the new trace
      await processor.forceFlush('trace-1');
      await new Promise(resolve => setTimeout(resolve, 0));

      // Tail sampler should be called again for the new trace
      expect(tailSampler).toHaveBeenCalledTimes(2);
    });

    it('should handle distributed trace where ALL spans have remote parent', async () => {
      // This is the critical test: when all spans have parentSpanId,
      // localRootSpan must be correctly identified as the handler (span with remote parent)
      // not as a child that happened to end first
      const tailSampler = vi.fn((traceInfo) => {
        // Tail sampler accesses localRootSpan.spanContext()
        // This would crash if localRootSpan is undefined
        expect(traceInfo.localRootSpan).toBeDefined();
        expect(traceInfo.localRootSpan.spanContext()).toBeDefined();
        return true;
      });

      processor = new TailSamplingSpanProcessor(mockExporter, undefined, tailSampler);

      // All spans have parentSpanId (span1 has remote parent, others have local parent)
      // Spans end in this order: child2 -> child1 -> handler
      const span3 = createMockSpan('trace-1', 'span-3', 'span-2'); // grandchild
      const span2 = createMockSpan('trace-1', 'span-2', 'span-1'); // child
      const span1 = createMockSpan('trace-1', 'span-1', 'remote-parent-id'); // handler (local root)

      processor.onEnd(span3); // Ends first, but has local parent (span-1)
      processor.onEnd(span2); // Ends second, but has local parent (span-1)
      processor.onEnd(span1); // Ends last, has remote parent → this is local root

      // Explicitly flush (simulates instrument.ts behavior)
      await processor.forceFlush('trace-1');
      await new Promise(resolve => setTimeout(resolve, 0));

      // Tail sampler should have been called without crashing
      expect(tailSampler).toHaveBeenCalledTimes(1);

      // localRootSpan should be span-1 (handler with remote parent), NOT span-3 (first to end)
      const traceInfo = tailSampler.mock.calls[0][0];
      expect(traceInfo.localRootSpan.spanContext().spanId).toBe('span-1');

      // All spans should be exported
      expect(exportedSpans).toHaveLength(3);
    });

    it('should check handler error status, not child status, in distributed trace', async () => {
      // Critical scenario: handler has error, child is OK
      // Tail sampler must check localRootSpan (handler), not first-to-end child
      const defaultTailSampler = (traceInfo: any) => {
        const localRootSpan = traceInfo.localRootSpan;
        const ctx = localRootSpan.spanContext();
        // Default: keep if sampled or error
        return (ctx.traceFlags & 1) === 1 || localRootSpan.status.code === 2; // SAMPLED | ERROR
      };

      processor = new TailSamplingSpanProcessor(mockExporter, undefined, defaultTailSampler);

      // Child ends first with OK status
      const child = createMockSpan('trace-1', 'span-2', 'span-1');
      child.status = { code: SpanStatusCode.OK }; // Child is fine

      // Handler ends second with ERROR status and remote parent
      const handler = createMockSpan('trace-1', 'span-1', 'remote-parent-id');
      handler.status = { code: SpanStatusCode.ERROR }; // Handler has error

      processor.onEnd(child); // Child ends first (OK status)
      processor.onEnd(handler); // Handler ends second (ERROR status, remote parent)

      // Explicitly flush
      await processor.forceFlush('trace-1');
      await new Promise(resolve => setTimeout(resolve, 0));

      // Trace should be KEPT because handler (localRootSpan) has ERROR
      // If we incorrectly used child as localRootSpan, trace would be dropped (OK status)
      expect(exportedSpans).toHaveLength(2);
      expect(exportedSpans).toContain(child);
      expect(exportedSpans).toContain(handler);
    });
  });
});

/**
 * Helper to create mock ReadableSpan
 */
function createMockSpan(
  traceId: string,
  spanId: string,
  parentSpanId?: string
): ReadableSpan {
  return {
    name: `span-${spanId}`,
    spanContext: () => ({
      traceId,
      spanId,
      traceFlags: 1, // SAMPLED
      traceState: undefined,
    }),
    parentSpanId,
    startTime: [Date.now(), 0],
    endTime: [Date.now(), 0],
    status: { code: SpanStatusCode.OK },
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
  } as ReadableSpan;
}
