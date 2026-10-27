/**
 * Tests for tail sampling span processor
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TailSamplingSpanProcessor } from './tail-sampling-processor';
import { AdaptiveSampler } from './sampling';
import {
  AUTOTEL_SAMPLING_TAIL_KEEP,
  AUTOTEL_SAMPLING_TAIL_EVALUATED,
} from './sampling';
import type {
  SpanProcessor,
  ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import {
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
  type Context,
  type Attributes,
} from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { FilteringSpanProcessor } from './filtering-span-processor';
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

// Create mock ReadableSpan. Each span is its own trace's local root unless a
// trace id and local parent are given.
let nextId = 0;
function createMockSpan(
  attributes: Attributes,
  options: {
    traceId?: string;
    parentSpanId?: string;
    remoteParent?: boolean;
    error?: boolean;
    durationMs?: number;
  } = {},
): ReadableSpan {
  const spanId = `span${++nextId}`;
  const traceId = options.traceId ?? `trace${nextId}`;
  return {
    attributes,
    name: 'test-span',
    spanContext: () => ({ traceId, spanId, traceFlags: 1 }),
    parentSpanContext: options.parentSpanId
      ? {
          traceId,
          spanId: options.parentSpanId,
          traceFlags: 1,
          isRemote: options.remoteParent ?? false,
        }
      : undefined,
    status: {
      code: options.error ? SpanStatusCode.ERROR : SpanStatusCode.UNSET,
    },
    duration: [0, (options.durationMs ?? 10) * 1e6],
    links: [],
  } as unknown as ReadableSpan;
}

describe('TailSamplingSpanProcessor', () => {
  it('forwards spans as they end when nothing needs the whole trace', () => {
    const processor = new TailSamplingSpanProcessor(new MockSpanProcessor());
    const inner = (
      processor as unknown as { wrappedProcessor: MockSpanProcessor }
    ).wrappedProcessor;
    const root = createMockSpan({}, { traceId: 'live' });
    const work = createMockSpan(
      {},
      { traceId: 'live', parentSpanId: root.spanContext().spanId },
    );
    processor.onStart(root as unknown as Span, {} as Context);
    processor.onStart(work as unknown as Span, {} as Context);
    processor.onEnd(work);
    expect(inner.endedSpans).toEqual([work]);
  });

  let mockProcessor: MockSpanProcessor;
  let tailSamplingProcessor: TailSamplingSpanProcessor;

  beforeEach(() => {
    mockProcessor = new MockSpanProcessor();
    tailSamplingProcessor = new TailSamplingSpanProcessor(mockProcessor);
  });

  describe('Span forwarding', () => {
    it('should forward span to wrapped processor on onStart', () => {
      const mockSpan = createMockSpan({}) as unknown as Span;
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

  describe('Trace-level decisions', () => {
    // A tail sampler that keeps every trace nothing else decided, so these
    // tests see the processor's own rules.
    beforeEach(() => {
      tailSamplingProcessor = new TailSamplingSpanProcessor(mockProcessor, {
        sampler: new AdaptiveSampler({ baselineSampleRate: 1 }),
      });
    });

    const child = (
      traceId: string,
      attributes: Attributes = {},
      error = false,
    ) => createMockSpan(attributes, { traceId, parentSpanId: 'root', error });

    it('buffers children until the local root ends, then exports the trace', () => {
      const c = child('t1');
      tailSamplingProcessor.onEnd(c);
      expect(mockProcessor.endedSpans).toHaveLength(0);

      const root = createMockSpan({}, { traceId: 't1' });
      tailSamplingProcessor.onEnd(root);
      expect(mockProcessor.endedSpans).toEqual([c, root]);
    });

    it('drops the children of a root a wrapper dropped (no orphans)', () => {
      tailSamplingProcessor.onEnd(child('t2'));
      tailSamplingProcessor.onEnd(
        createMockSpan(
          {
            [AUTOTEL_SAMPLING_TAIL_EVALUATED]: true,
            [AUTOTEL_SAMPLING_TAIL_KEEP]: false,
          },
          { traceId: 't2' },
        ),
      );
      tailSamplingProcessor.onEnd(child('t2')); // ends after the root
      expect(mockProcessor.endedSpans).toHaveLength(0);
    });

    it('keeps the whole trace when any span was kept (forceKeep in a child)', () => {
      tailSamplingProcessor.onEnd(
        child('t3', {
          [AUTOTEL_SAMPLING_TAIL_EVALUATED]: true,
          [AUTOTEL_SAMPLING_TAIL_KEEP]: true,
        }),
      );
      tailSamplingProcessor.onEnd(
        createMockSpan(
          {
            [AUTOTEL_SAMPLING_TAIL_EVALUATED]: true,
            [AUTOTEL_SAMPLING_TAIL_KEEP]: false,
          },
          { traceId: 't3' },
        ),
      );
      expect(mockProcessor.endedSpans).toHaveLength(2);
    });

    it('treats a span with a remote parent as the local root', () => {
      tailSamplingProcessor.onEnd(
        createMockSpan({}, { parentSpanId: 'upstream', remoteParent: true }),
      );
      expect(mockProcessor.endedSpans).toHaveLength(1);
    });

    it('samples auto-instrumented roots with the sampler', () => {
      const processor = new TailSamplingSpanProcessor(mockProcessor, {
        sampler: new AdaptiveSampler({ baselineSampleRate: 0 }),
      });

      processor.onEnd(child('ok'));
      processor.onEnd(createMockSpan({}, { traceId: 'ok' }));
      expect(mockProcessor.endedSpans).toHaveLength(0);

      processor.onEnd(child('failed', {}, true));
      processor.onEnd(createMockSpan({}, { traceId: 'failed' }));
      expect(mockProcessor.endedSpans).toHaveLength(2);

      processor.onEnd(
        createMockSpan({}, { traceId: 'slow', durationMs: 1500 }),
      );
      expect(mockProcessor.endedSpans).toHaveLength(3);
    });

    it('applies the baseline rate to auto-instrumented roots', () => {
      const processor = new TailSamplingSpanProcessor(mockProcessor, {
        sampler: new AdaptiveSampler({ baselineSampleRate: 0.1 }),
      });
      for (let i = 0; i < 2000; i++) processor.onEnd(createMockSpan({}));
      const kept = mockProcessor.endedSpans.length;
      expect(kept).toBeGreaterThan(120);
      expect(kept).toBeLessThan(280);
    });

    it('keeps an error a wrapped root swallowed when the sampler keeps errors', () => {
      const processor = new TailSamplingSpanProcessor(mockProcessor, {
        sampler: new AdaptiveSampler({ baselineSampleRate: 0 }),
      });
      processor.onEnd(child('swallowed', {}, true));
      processor.onEnd(
        createMockSpan(
          {
            [AUTOTEL_SAMPLING_TAIL_EVALUATED]: true,
            [AUTOTEL_SAMPLING_TAIL_KEEP]: false,
          },
          { traceId: 'swallowed' },
        ),
      );
      expect(mockProcessor.endedSpans).toHaveLength(2);
    });

    it('exports the oldest trace as it stands when the span buffer is full', () => {
      const processor = new TailSamplingSpanProcessor(mockProcessor, {
        sampler: new AdaptiveSampler({ baselineSampleRate: 1 }),
        maxBufferedSpans: 1,
      });
      const first = child('p1');
      processor.onEnd(first);
      processor.onEnd(child('p2'));
      expect(mockProcessor.endedSpans).toEqual([first]);
      // Later spans of the evicted trace follow it out.
      processor.onEnd(createMockSpan({}, { traceId: 'p1' }));
      expect(mockProcessor.endedSpans).toHaveLength(2);
    });

    // onStart reads the span's context and its parent from the context.
    const start = (
      processor: TailSamplingSpanProcessor,
      span: ReadableSpan,
      parent?: ReadableSpan,
    ) =>
      processor.onStart(
        span as unknown as Span,
        parent
          ? trace.setSpan(ROOT_CONTEXT, parent as unknown as Span)
          : ROOT_CONTEXT,
      );
    const childOf = (
      parent: ReadableSpan,
      attributes: Attributes = {},
      error = false,
    ) =>
      createMockSpan(attributes, {
        traceId: parent.spanContext().traceId,
        parentSpanId: parent.spanContext().spanId,
        error,
      });

    it('waits for children still running when the root ends', () => {
      const processor = new TailSamplingSpanProcessor(mockProcessor, {
        sampler: new AdaptiveSampler({ baselineSampleRate: 0 }),
      });
      const root = createMockSpan({}, { traceId: 'w' });
      const late = childOf(root, {}, true);
      start(processor, root);
      start(processor, late, root);

      processor.onEnd(root);
      expect(mockProcessor.endedSpans).toHaveLength(0);
      // The child fails after the root returned; that error keeps the trace.
      processor.onEnd(late);
      expect(mockProcessor.endedSpans).toEqual([root, late]);
    });

    it('honours forceKeep() in a child that ends after the root', () => {
      const processor = new TailSamplingSpanProcessor(mockProcessor, {
        sampler: new AdaptiveSampler({ baselineSampleRate: 0 }),
      });
      const root = createMockSpan({}, { traceId: 'fk' });
      const kept = childOf(root, {
        [AUTOTEL_SAMPLING_TAIL_EVALUATED]: true,
        [AUTOTEL_SAMPLING_TAIL_KEEP]: true,
      });
      start(processor, root);
      start(processor, kept, root);
      processor.onEnd(root);
      processor.onEnd(kept);
      expect(mockProcessor.endedSpans).toHaveLength(2);
    });

    it('keeps a trace with running children pending through a flush', async () => {
      const processor = new TailSamplingSpanProcessor(mockProcessor, {
        sampler: new AdaptiveSampler({ baselineSampleRate: 0 }),
      });
      const root = createMockSpan({}, { traceId: 'flush' });
      const late = childOf(root, {}, true);
      start(processor, root);
      start(processor, late, root);
      processor.onEnd(root);

      await processor.forceFlush();
      expect(mockProcessor.endedSpans).toHaveLength(0);
      processor.onEnd(late);
      expect(mockProcessor.endedSpans).toEqual([root, late]);
    });

    it('decides everything on shutdown', async () => {
      const processor = new TailSamplingSpanProcessor(mockProcessor, {
        sampler: new AdaptiveSampler({ baselineSampleRate: 0 }),
      });
      // Clean root, child never ends: decided on what it has, dropped.
      const root = createMockSpan({}, { traceId: 'down' });
      start(processor, root);
      start(processor, childOf(root), root);
      processor.onEnd(root);
      // Root never ends: the finished child is exported.
      const rootless = createMockSpan({}, { traceId: 'rootless' });
      const orphan = childOf(rootless);
      start(processor, rootless);
      start(processor, orphan, rootless);
      processor.onEnd(orphan);

      await processor.shutdown();
      expect(mockProcessor.endedSpans).toEqual([orphan]);
    });

    it('decides an evicted trace on what it has once the root ended', () => {
      const processor = new TailSamplingSpanProcessor(mockProcessor, {
        sampler: new AdaptiveSampler({ baselineSampleRate: 0 }),
        maxBufferedSpans: 10,
      });
      // A flood of clean traces whose roots ended but a child is still running.
      for (let i = 0; i < 100; i++) {
        const root = createMockSpan({}, { traceId: `flood${i}` });
        start(processor, root);
        start(processor, childOf(root), root);
        processor.onEnd(root);
      }
      // Overflow judged them (clean, baseline 0) instead of exporting them.
      expect(mockProcessor.endedSpans).toHaveLength(0);
      void processor.shutdown();
    });

    it('decides on timeout: on what it has once the root ended, fail-open before', () => {
      const processor = new TailSamplingSpanProcessor(mockProcessor, {
        sampler: new AdaptiveSampler({ baselineSampleRate: 0 }),
        traceTimeoutMs: 1000,
      });
      // Root ended, a child never does: decided on the clean root, dropped.
      const root = createMockSpan({}, { traceId: 'stuck' });
      start(processor, root);
      start(processor, childOf(root), root);
      processor.onEnd(root);
      // Root never ends: its finished child is exported as it stands.
      const open = createMockSpan({}, { traceId: 'open' });
      const orphan = childOf(open);
      start(processor, open);
      start(processor, orphan, open);
      processor.onEnd(orphan);

      processor.sweep(Date.now() + 1001);
      expect(mockProcessor.endedSpans).toEqual([orphan]);
      void processor.shutdown();
    });

    it('re-parents a child that ends after its filtered parent and the decision', () => {
      const processor = new TailSamplingSpanProcessor(mockProcessor);
      processor.enableFiltering();
      const root = createMockSpan({}, { traceId: 'f' });
      const middle = createMockSpan(
        {},
        { traceId: 'f', parentSpanId: root.spanContext().spanId },
      );
      const leaf = createMockSpan(
        {},
        { traceId: 'f', parentSpanId: middle.spanContext().spanId },
      );
      processor.markFiltered(middle.spanContext().spanId);
      processor.onEnd(middle);
      processor.onEnd(root);
      processor.onEnd(leaf);

      expect(
        mockProcessor.endedSpans.map((s) => s.spanContext().spanId),
      ).toEqual([root.spanContext().spanId, leaf.spanContext().spanId]);
      expect(mockProcessor.endedSpans[1]?.parentSpanContext?.spanId).toBe(
        root.spanContext().spanId,
      );
    });
  });
});

describe('spanFilter beside a remote parent', () => {
  // Next.js under a browser `traceparent`: its empty `next.bubble` span and
  // the real request are siblings under the remote browser span. Filtering
  // the bubble must not take the request with it.
  it('drops only the filtered local root, not its siblings or their children', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [
        new FilteringSpanProcessor(
          new TailSamplingSpanProcessor(new SimpleSpanProcessor(exporter)),
          { filter: (span) => span.attributes['next.bubble'] !== true },
        ),
      ],
    });
    const tracer = provider.getTracer('test');
    const browser = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
      traceFlags: 1,
      isRemote: true,
    });

    // The bubble ends before the real request starts, so nothing is open.
    tracer
      .startSpan(
        'BaseServer.handleRequest',
        { attributes: { 'next.bubble': true } },
        browser,
      )
      .end();
    const request = tracer.startSpan('POST /orders', {}, browser);
    tracer.startSpan('action.save', {}, trace.setSpan(browser, request)).end();
    request.end();
    await provider.forceFlush();

    expect(exporter.getFinishedSpans().map((s) => s.name)).toEqual([
      'action.save',
      'POST /orders',
    ]);
    await provider.shutdown();
  });

  it('keeps a child started from a span context with its local parent', async () => {
    // How autotel-genai parents its late `signals` span: a bare span context,
    // after the parent has ended and its trace has been decided.
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [
        new FilteringSpanProcessor(
          new TailSamplingSpanProcessor(new SimpleSpanProcessor(exporter)),
          { filter: (span) => span.name !== 'health' },
        ),
      ],
    });
    const tracer = provider.getTracer('test');
    const root = tracer.startSpan('health');
    root.end();
    tracer
      .startSpan(
        'signals health',
        {},
        trace.setSpanContext(ROOT_CONTEXT, root.spanContext()),
      )
      .end();
    await provider.forceFlush();

    expect(exporter.getFinishedSpans()).toEqual([]);
    await provider.shutdown();
  });
});
