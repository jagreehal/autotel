/**
 * Span processor with flush and tail sampling support
 */

import type { Context } from '@opentelemetry/api';
import type {
  ReadableSpan,
  Span,
  SpanExporter,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type { PostProcessorFn, TailSampleFn, LocalTrace } from '../types';

/**
 * Span processor that supports flush by trace ID and tail sampling
 */
export class SpanProcessorWithFlush implements SpanProcessor {
  private exporter: SpanExporter;
  private postProcessor?: PostProcessorFn;
  private spans: Map<string, ReadableSpan[]> = new Map();

  constructor(exporter: SpanExporter, postProcessor?: PostProcessorFn) {
    this.exporter = exporter;
    this.postProcessor = postProcessor;
  }

  onStart(_span: Span, _parentContext: Context): void {
    // No-op for now
  }

  onEnd(span: ReadableSpan): void {
    const traceId = span.spanContext().traceId;

    if (!this.spans.has(traceId)) {
      this.spans.set(traceId, []);
    }

    this.spans.get(traceId)!.push(span);
  }

  /**
   * Force flush spans for a specific trace
   */
  async forceFlush(traceId?: string): Promise<void> {
    if (traceId) {
      const spans = this.spans.get(traceId);
      if (spans && spans.length > 0) {
        await this.exportSpans(spans);
        this.spans.delete(traceId);
      }
    } else {
      // Flush all traces
      const promises: Promise<void>[] = [];
      for (const [id, spans] of this.spans.entries()) {
        promises.push(this.exportSpans(spans));
        this.spans.delete(id);
      }
      await Promise.all(promises);
    }
  }

  async shutdown(): Promise<void> {
    await this.forceFlush();
    if (this.exporter) {
      await this.exporter.shutdown();
    }
  }

  /**
   * Export spans with post-processing
   * Errors are caught and logged but don't throw to prevent worker instability
   */
  private async exportSpans(spans: ReadableSpan[]): Promise<void> {
    if (spans.length === 0) return;
    if (!this.exporter) return; // No exporter configured (e.g., in tests)

    let processedSpans = spans;

    if (this.postProcessor) {
      try {
        processedSpans = this.postProcessor(spans);
      } catch (error) {
        // Post-processor errors should not prevent export
        console.error('[autotel-edge] Post-processor error:', error);
        // Continue with original spans
        processedSpans = spans;
      }
    }

    return new Promise((resolve) => {
      this.exporter.export(processedSpans, (result) => {
        if (result.code === 0) {
          // SUCCESS
          resolve();
        } else {
          // Log but don't reject - exporter failures shouldn't crash the worker
          console.error(
            '[autotel-edge] Exporter error:',
            result.error?.message || 'Unknown error',
          );
          resolve(); // Resolve instead of reject to prevent unhandled promise rejection
        }
      });
    });
  }
}

/**
 * Span processor that supports tail sampling decisions
 */
export class TailSamplingSpanProcessor implements SpanProcessor {
  private wrapped: SpanProcessorWithFlush;
  private tailSampler?: TailSampleFn;
  private traces: Map<string, LocalTrace> = new Map();

  constructor(
    exporter: SpanExporter,
    postProcessor?: PostProcessorFn,
    tailSampler?: TailSampleFn,
  ) {
    this.wrapped = new SpanProcessorWithFlush(exporter, postProcessor);
    this.tailSampler = tailSampler;
  }

  onStart(span: Span, parentContext: Context): void {
    this.wrapped.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    const traceId = span.spanContext().traceId;
    const spanId = span.spanContext().spanId;
    const parentSpanId = 'parentSpanId' in span ? span.parentSpanId : undefined;

    // Initialize trace if not exists
    if (!this.traces.has(traceId)) {
      this.traces.set(traceId, {
        traceId,
        spans: [],
        localRootSpan: undefined as any, // Will be set when we identify the local root
      });
    }

    const trace = this.traces.get(traceId)!;

    // Determine if this span is a local root by checking if its parent is in buffered spans
    // A span is a local root if:
    // 1. It has no parentSpanId (definitive root)
    // 2. Its parentSpanId doesn't match any already-buffered span (remote parent = distributed trace entry)
    const hasLocalParent = parentSpanId &&
                            trace.spans.some(s => s.spanContext().spanId === parentSpanId);

    // Set localRootSpan if this is the local root (no local parent found in buffer)
    if (!hasLocalParent) {
      trace.localRootSpan = span;
    }

    trace.spans.push(span); // Buffer the span AFTER checking parent relationships

    // Auto-flush decision: only auto-flush for normal traces (no parentSpanId at all)
    // For distributed traces (parentSpanId present), we rely on explicit forceFlush() from instrument.ts
    // This ensures we don't trigger before all spans have been buffered
    const isDefinitiveRoot = !parentSpanId;
    const shouldAutoFlush = isDefinitiveRoot && trace.localRootSpan &&
                             trace.localRootSpan.spanContext().spanId === spanId;

    if (shouldAutoFlush) {
      if (this.tailSampler) {
        const shouldKeep = this.tailSampler(trace);

        if (shouldKeep) {
          // Export ALL buffered spans in the trace
          for (const bufferedSpan of trace.spans) {
            this.wrapped.onEnd(bufferedSpan);
          }
          // Force flush to actually export the spans
          void this.wrapped.forceFlush(traceId);
        }
        // If not keeping, just drop all spans (don't export)
      } else {
        // No tail sampler, export all buffered spans
        for (const bufferedSpan of trace.spans) {
          this.wrapped.onEnd(bufferedSpan);
        }
        // Force flush to actually export the spans
        void this.wrapped.forceFlush(traceId);
      }

      // Clean up trace after decision
      this.traces.delete(traceId);
    }
    // If not local root span, just buffer it - don't export yet
  }

  async forceFlush(traceId?: string): Promise<void> {
    if (traceId) {
      // Make tail sampling decision for this specific trace before flushing
      const trace = this.traces.get(traceId);
      if (trace) {
        // Ensure localRootSpan is set (fallback to first span if not)
        // This handles distributed traces where no span has undefined parentSpanId
        if (!trace.localRootSpan && trace.spans.length > 0) {
          trace.localRootSpan = trace.spans[0];
        }

        if (this.tailSampler) {
          const shouldKeep = this.tailSampler(trace);

          if (shouldKeep) {
            // Export ALL buffered spans in the trace
            for (const bufferedSpan of trace.spans) {
              this.wrapped.onEnd(bufferedSpan);
            }
          }
        } else {
          // No tail sampler, export all buffered spans
          for (const bufferedSpan of trace.spans) {
            this.wrapped.onEnd(bufferedSpan);
          }
        }

        // Clean up trace after decision
        this.traces.delete(traceId);
      }
    }
    return this.wrapped.forceFlush(traceId);
  }

  async shutdown(): Promise<void> {
    this.traces.clear();
    return this.wrapped.shutdown();
  }
}
