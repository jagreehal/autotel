/**
 * Terminal Span Stream
 *
 * Converts OpenTelemetry ReadableSpan objects to TerminalSpanEvent format
 * for consumption by the terminal dashboard.
 */

import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { SpanStatusCode, SpanKind } from 'autotel';
import type { StreamingSpanProcessor } from './streaming-processor';

/**
 * Span event format for terminal dashboard consumption
 */
export interface TerminalSpanEvent {
  /** Span name */
  name: string;
  /** Span ID (hex string) */
  spanId: string;
  /** Trace ID (hex string) */
  traceId: string;
  /** Parent span ID (hex string, optional) */
  parentSpanId?: string;
  /** Start time in milliseconds since epoch */
  startTime: number;
  /** End time in milliseconds since epoch */
  endTime: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Span status */
  status: 'OK' | 'ERROR' | 'UNSET';
  /** Span kind (INTERNAL, SERVER, CLIENT, etc.) */
  kind?: string;
  /** Span attributes */
  attributes?: Record<string, unknown>;
}

/**
 * Stream interface for terminal dashboard
 */
export interface TerminalSpanStream {
  /**
   * Subscribe to span end events
   *
   * @param callback - Called when a span ends
   * @returns Unsubscribe function
   */
  onSpanEnd(callback: (event: TerminalSpanEvent) => void): () => void;
}

/**
 * Convert OpenTelemetry time tuple to milliseconds
 */
function timeToMs([seconds, nanoseconds]: [number, number]): number {
  return seconds * 1000 + nanoseconds / 1_000_000;
}

/**
 * Map SpanStatusCode to string
 */
function mapStatus(code: SpanStatusCode): 'OK' | 'ERROR' | 'UNSET' {
  if (code === SpanStatusCode.OK) {
    return 'OK';
  }
  if (code === SpanStatusCode.ERROR) {
    return 'ERROR';
  }
  return 'UNSET';
}

/**
 * Map SpanKind number to string
 */
function mapKind(kind: SpanKind): string {
  const kindMap: Record<number, string> = {
    [SpanKind.INTERNAL]: 'INTERNAL',
    [SpanKind.SERVER]: 'SERVER',
    [SpanKind.CLIENT]: 'CLIENT',
    [SpanKind.PRODUCER]: 'PRODUCER',
    [SpanKind.CONSUMER]: 'CONSUMER',
  };
  return kindMap[kind] ?? 'UNKNOWN';
}

/**
 * Create a terminal span stream from a streaming processor
 *
 * @param processor - The streaming span processor to subscribe to
 * @returns Terminal span stream interface
 *
 * @example
 * ```typescript
 * import { StreamingSpanProcessor } from 'autotel-terminal'
 * import { createTerminalSpanStream } from 'autotel-terminal'
 *
 * const processor = new StreamingSpanProcessor(baseProcessor)
 * const stream = createTerminalSpanStream(processor)
 *
 * stream.onSpanEnd((event) => {
 *   console.log('Span:', event.name, event.durationMs + 'ms')
 * })
 * ```
 */
export function createTerminalSpanStream(
  processor: StreamingSpanProcessor,
): TerminalSpanStream {
  return {
    onSpanEnd(callback) {
      return processor.subscribe((span: ReadableSpan) => {
        const spanContext = span.spanContext();
        // parentSpanId is not part of the standard ReadableSpan interface
        // but some implementations (like Node.js SDK) include it
        const parentSpanId =
          'parentSpanId' in span && typeof span.parentSpanId === 'string'
            ? span.parentSpanId
            : undefined;

        // Convert time tuples to milliseconds
        const startTime = timeToMs(span.startTime);
        const endTime = timeToMs(span.endTime);
        const durationMs = endTime - startTime;

        // Create terminal event
        const event: TerminalSpanEvent = {
          name: span.name,
          spanId: spanContext.spanId,
          traceId: spanContext.traceId,
          parentSpanId,
          startTime,
          endTime,
          durationMs,
          status: mapStatus(span.status.code),
          kind: mapKind(span.kind),
          attributes: span.attributes as Record<string, unknown>,
        };

        callback(event);
      });
    },
  };
}
