/**
 * Correlation ID utilities for RabbitMQ message tracing.
 *
 * Provides consistent correlation ID handling across producers and consumers:
 * - Inject trace headers and correlation ID into outgoing messages
 * - Extract correlation ID from incoming messages
 * - Derive correlation ID from current trace context
 */

import {
  propagation,
  context,
  otelTrace as trace,
  type TextMapSetter,
} from 'autotel';
import type { InjectOptions } from './types';
import { CORRELATION_ID_HEADER } from '../common/constants';

/**
 * TextMapSetter for injecting headers.
 */
const headerSetter: TextMapSetter<Record<string, string>> = {
  set(carrier: Record<string, string>, key: string, value: string): void {
    carrier[key] = value;
  },
};

/**
 * Derive correlation ID from current trace context.
 *
 * Priority:
 * 1. Baggage 'correlation-id' if present
 * 2. First 16 characters of trace ID (64-bit for compatibility)
 * 3. Empty string if no active trace
 *
 * Note: Uses first 16 chars of trace ID to be stable per trace, not per attempt.
 *
 * @returns Correlation ID derived from context
 *
 * @example
 * ```typescript
 * import { deriveCorrelationId } from 'autotel-plugins/rabbitmq';
 *
 * // Inside a traced operation
 * const correlationId = deriveCorrelationId();
 * // '4bf92f3577b34da6' (first 16 chars of trace ID)
 * ```
 */
export function deriveCorrelationId(): string {
  // Check baggage first
  const activeBaggage = propagation.getActiveBaggage();
  const baggageCorrelationId = activeBaggage?.getEntry('correlation-id');
  if (baggageCorrelationId?.value) {
    return baggageCorrelationId.value;
  }

  // Fall back to trace ID (first 16 chars)
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    const spanContext = activeSpan.spanContext();
    // Return first 16 chars (64-bit) for compatibility with systems
    // that don't support full 128-bit trace IDs
    return spanContext.traceId.slice(0, 16);
  }

  return '';
}

/**
 * Extract correlation ID from message headers or AMQP correlationId property.
 *
 * Priority:
 * 1. AMQP correlationId property (if provided)
 * 2. x-correlation-id header (case-insensitive)
 *
 * @param headers - Normalized headers (string values)
 * @param amqpCorrelationId - Optional AMQP correlationId property value
 * @returns Correlation ID if found, undefined otherwise
 *
 * @example
 * ```typescript
 * import { extractCorrelationId, normalizeHeaders } from 'autotel-plugins/rabbitmq';
 *
 * const headers = normalizeHeaders(message.properties.headers);
 * const correlationId = extractCorrelationId(headers, message.properties.correlationId);
 * if (correlationId) {
 *   logger.info({ correlationId }, 'Processing message');
 * }
 * ```
 */
export function extractCorrelationId(
  headers: Record<string, string>,
  amqpCorrelationId?: string,
): string | undefined {
  // Priority 1: AMQP correlationId property
  if (amqpCorrelationId) {
    return amqpCorrelationId;
  }

  // Priority 2: x-correlation-id header (case-insensitive)
  const lowerKey = CORRELATION_ID_HEADER.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerKey) {
      return value;
    }
  }
  return undefined;
}

/**
 * Inject trace headers into outgoing message headers.
 *
 * Uses OpenTelemetry propagators to inject W3C Trace Context (traceparent, tracestate)
 * and optionally adds x-correlation-id header (default: true).
 *
 * Note: Baggage is injected automatically when W3CBaggagePropagator is registered.
 *
 * @param base - Base headers to merge with injected headers
 * @param options - Injection options
 * @returns Headers with trace context injected
 *
 * @example
 * ```typescript
 * import { injectTraceHeaders } from 'autotel-plugins/rabbitmq';
 *
 * // Publisher: inject headers with correlation ID
 * const headers = injectTraceHeaders({}, { includeCorrelationIdHeader: true });
 * channel.publish('exchange', 'routing.key', content, { headers });
 * ```
 *
 * @example With explicit correlation ID
 * ```typescript
 * const headers = injectTraceHeaders({}, {
 *   correlationId: 'order-12345',
 *   includeCorrelationIdHeader: true,
 * });
 * ```
 */
export function injectTraceHeaders(
  base: Record<string, string> = {},
  options: InjectOptions = {},
): Record<string, string> {
  const { correlationId, includeCorrelationIdHeader = true } = options;

  const carrier = { ...base };

  // Inject trace context (traceparent, tracestate)
  // Note: If W3CBaggagePropagator is registered, baggage is also injected automatically
  propagation.inject(context.active(), carrier, headerSetter);

  // Add correlation ID if requested
  if (includeCorrelationIdHeader) {
    const corrId = correlationId ?? deriveCorrelationId();
    if (corrId) {
      carrier[CORRELATION_ID_HEADER] = corrId;
    }
  }

  return carrier;
}
