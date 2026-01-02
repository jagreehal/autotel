/**
 * Streaming Span Processor
 *
 * A span processor that emits ReadableSpan objects to subscribers.
 * This allows real-time streaming of spans to terminal dashboards and other consumers.
 *
 * @example Basic usage
 * ```typescript
 * import { StreamingSpanProcessor } from 'autotel-terminal'
 * import { BatchSpanProcessor } from 'autotel/processors'
 * import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
 *
 * const exporter = new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' })
 * const baseProcessor = new BatchSpanProcessor(exporter)
 * const streamingProcessor = new StreamingSpanProcessor(baseProcessor)
 *
 * // Subscribe to spans
 * const unsubscribe = streamingProcessor.subscribe((span) => {
 *   console.log('Span ended:', span.name)
 * })
 *
 * // Later, unsubscribe
 * unsubscribe()
 * ```
 */

import type {
  SpanProcessor,
  ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import type { Context } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/sdk-trace-base';

/**
 * Span processor that wraps another processor and emits spans to subscribers
 *
 * This processor forwards all span operations to a wrapped processor while
 * also emitting completed spans to registered subscribers. This enables
 * real-time streaming of spans to terminal dashboards, loggers, or other
 * consumers without interfering with normal span processing.
 */
export class StreamingSpanProcessor implements SpanProcessor {
  private wrappedProcessor: SpanProcessor | null;
  private subscribers = new Set<(span: ReadableSpan) => void>();

  /**
   * Create a new streaming span processor
   *
   * @param wrappedProcessor - The processor to wrap and forward spans to.
   *                          If null, spans are only emitted to subscribers (no forwarding).
   */
  constructor(wrappedProcessor: SpanProcessor | null = null) {
    this.wrappedProcessor = wrappedProcessor;
  }

  onStart(span: Span, parentContext: Context): void {
    if (this.wrappedProcessor) {
      this.wrappedProcessor.onStart(span, parentContext);
    }
  }

  onEnd(span: ReadableSpan): void {
    // Emit to all subscribers first
    for (const subscriber of this.subscribers) {
      try {
        subscriber(span);
      } catch (error) {
        // Don't let subscriber errors break span processing
        console.error('[autotel-terminal] Subscriber error:', error);
      }
    }

    // Forward to wrapped processor
    if (this.wrappedProcessor) {
      this.wrappedProcessor.onEnd(span);
    }
  }

  /**
   * Subscribe to span end events
   *
   * @param callback - Function called when a span ends
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * const unsubscribe = processor.subscribe((span) => {
   *   console.log('Span ended:', span.name)
   * })
   *
   * // Later, unsubscribe
   * unsubscribe()
   * ```
   */
  subscribe(callback: (span: ReadableSpan) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  async forceFlush(): Promise<void> {
    if (this.wrappedProcessor) {
      return this.wrappedProcessor.forceFlush();
    }
  }

  async shutdown(): Promise<void> {
    // Clear subscribers
    this.subscribers.clear();
    if (this.wrappedProcessor) {
      return this.wrappedProcessor.shutdown();
    }
  }
}
