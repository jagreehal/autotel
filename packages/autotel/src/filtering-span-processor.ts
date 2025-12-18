/**
 * Filtering Span Processor
 *
 * Filters spans based on a user-provided predicate function.
 * Runs filtering on onEnd() to have access to complete span data.
 *
 * @example Filter out Next.js instrumentation spans
 * ```typescript
 * init({
 *   service: 'my-app',
 *   spanFilter: (span) => span.instrumentationScope.name !== 'next.js'
 * })
 * ```
 *
 * @example Filter out health check endpoints
 * ```typescript
 * init({
 *   service: 'my-app',
 *   spanFilter: (span) => !span.name.includes('/health')
 * })
 * ```
 */

import type {
  SpanProcessor,
  ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import type { Context } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/sdk-trace-base';

/**
 * Predicate function for filtering spans
 *
 * @param span - The completed span (ReadableSpan) with all attributes and metadata
 * @returns true to keep the span, false to drop it
 *
 * Available span properties for filtering:
 * - `span.name` - Span name
 * - `span.attributes` - All span attributes
 * - `span.instrumentationScope` - `{ name, version }` of the instrumentation
 * - `span.status` - Span status code and message
 * - `span.duration` - Span duration as `[seconds, nanoseconds]`
 * - `span.kind` - SpanKind (INTERNAL, SERVER, CLIENT, etc.)
 */
export type SpanFilterPredicate = (span: ReadableSpan) => boolean;

export interface FilteringSpanProcessorOptions {
  /**
   * Predicate function to determine if a span should be kept
   * Return true to keep the span, false to drop it
   */
  filter: SpanFilterPredicate;
}

/**
 * Span processor that filters spans based on a predicate function.
 *
 * The filter is applied on onEnd() when the span has complete data including:
 * - All attributes
 * - Status code and message
 * - Duration
 * - Events and links
 * - Instrumentation scope (useful for filtering by library)
 *
 * onStart() passes through unchanged to ensure child spans can still be created.
 *
 * Error handling: If the filter predicate throws, the span is forwarded (fail-open).
 */
export class FilteringSpanProcessor implements SpanProcessor {
  private readonly wrappedProcessor: SpanProcessor;
  private readonly filter: SpanFilterPredicate;

  constructor(
    wrappedProcessor: SpanProcessor,
    options: FilteringSpanProcessorOptions,
  ) {
    this.wrappedProcessor = wrappedProcessor;
    this.filter = options.filter;
  }

  /**
   * Pass through onStart - we need spans to start so child spans work
   */
  onStart(span: Span, parentContext: Context): void {
    this.wrappedProcessor.onStart(span, parentContext);
  }

  /**
   * Apply filter predicate on span end
   * If filter returns false, span is dropped (not forwarded)
   */
  onEnd(span: ReadableSpan): void {
    try {
      if (this.filter(span)) {
        this.wrappedProcessor.onEnd(span);
      }
      // If filter returns false, span is silently dropped
    } catch {
      // If filter throws, forward the span (fail-open behavior)
      this.wrappedProcessor.onEnd(span);
    }
  }

  forceFlush(): Promise<void> {
    return this.wrappedProcessor.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.wrappedProcessor.shutdown();
  }
}
