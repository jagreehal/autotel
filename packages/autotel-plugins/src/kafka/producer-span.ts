/**
 * Producer span wrapper for Kafka message publishing.
 *
 * Creates PRODUCER spans with proper messaging semantics,
 * allowing trace context to be injected inside the span.
 *
 * @example Basic producer span
 * ```typescript
 * import { withProducerSpan, injectTraceHeaders } from 'autotel-plugins/kafka';
 *
 * await withProducerSpan({
 *   name: 'order.publish',
 *   topic: 'orders',
 *   messageKey: 'order-123',
 * }, async (span) => {
 *   // Inject headers inside the PRODUCER span context
 *   const headers = injectTraceHeaders({}, { includeCorrelationIdHeader: true });
 *   await producer.send({
 *     topic: 'orders',
 *     messages: [{ key: 'order-123', value: JSON.stringify(order), headers }],
 *   });
 * });
 * ```
 */

import { otelTrace as trace, context, SpanKind, SpanStatusCode } from 'autotel';
import type { ProducerDescriptor, ProducerSpanCallback } from './types';
import {
  SEMATTRS_MESSAGING_SYSTEM,
  SEMATTRS_MESSAGING_DESTINATION_NAME,
  SEMATTRS_MESSAGING_KAFKA_MESSAGE_KEY,
  SEMATTRS_MESSAGING_OPERATION,
} from '../common/constants';

const DEFAULT_TRACER_NAME = 'autotel-plugins/kafka';

/**
 * Create a producer span for Kafka message publishing.
 *
 * This creates a PRODUCER span with proper messaging attributes.
 * The callback runs within the span's context, so you can call
 * `injectTraceHeaders()` inside it to get the correct trace context.
 *
 * @param descriptor - Producer span configuration
 * @param fn - Async callback to execute within the span
 * @returns Promise resolving to callback result
 * @throws Error if span creation fails or callback throws
 *
 * @example
 * ```typescript
 * await withProducerSpan({
 *   name: 'payment.publish',
 *   topic: 'payments',
 *   messageKey: paymentId,
 * }, async (span) => {
 *   const headers = injectTraceHeaders({}, { includeCorrelationIdHeader: true });
 *   await producer.send({ topic: 'payments', messages: [{ key: paymentId, value, headers }] });
 * });
 * ```
 */
export async function withProducerSpan<T>(
  descriptor: ProducerDescriptor,
  fn: ProducerSpanCallback<T>,
): Promise<T> {
  const { name, topic, messageKey, system = 'kafka' } = descriptor;

  const tracer = trace.getTracer(DEFAULT_TRACER_NAME);

  // Create PRODUCER span
  const span = tracer.startSpan(name, {
    kind: SpanKind.PRODUCER,
  });

  // Set messaging attributes
  span.setAttribute(SEMATTRS_MESSAGING_SYSTEM, system);
  span.setAttribute(SEMATTRS_MESSAGING_DESTINATION_NAME, topic);
  span.setAttribute(SEMATTRS_MESSAGING_OPERATION, 'publish');

  if (messageKey !== undefined) {
    span.setAttribute(SEMATTRS_MESSAGING_KAFKA_MESSAGE_KEY, messageKey);
  }

  // Execute callback within span context
  const spanContext = trace.setSpan(context.active(), span);

  try {
    const result = await context.with(spanContext, async () => {
      return await fn(span);
    });

    span.setStatus({ code: SpanStatusCode.OK });
    span.end();

    return result;
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR });
    if (error instanceof Error) {
      span.recordException(error);
    } else {
      span.recordException(new Error(String(error)));
    }
    span.end();

    throw error;
  }
}
