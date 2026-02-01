/**
 * Publish span wrapper for RabbitMQ message publishing.
 *
 * Creates PRODUCER spans with proper messaging semantics,
 * allowing trace context to be injected inside the span.
 *
 * @example Basic publish span
 * ```typescript
 * import { withPublishSpan, injectTraceHeaders } from 'autotel-plugins/rabbitmq';
 *
 * await withPublishSpan({
 *   name: 'order.publish',
 *   exchange: 'orders',
 *   routingKey: 'order.created',
 *   messageId: 'msg-123',
 * }, async (span) => {
 *   // Inject headers inside the PRODUCER span context
 *   const headers = injectTraceHeaders({}, { includeCorrelationIdHeader: true });
 *   channel.publish('orders', 'order.created', content, { headers });
 * });
 * ```
 */

import { otelTrace as trace, context, SpanKind, SpanStatusCode } from 'autotel';
import type { PublishDescriptor, PublishSpanCallback } from './types';
import {
  SEMATTRS_MESSAGING_SYSTEM,
  SEMATTRS_MESSAGING_DESTINATION_NAME,
  SEMATTRS_MESSAGING_OPERATION_NAME,
  SEMATTRS_MESSAGING_RABBITMQ_DESTINATION_ROUTING_KEY,
  SEMATTRS_MESSAGING_MESSAGE_ID,
  SEMATTRS_MESSAGING_MESSAGE_CONVERSATION_ID,
} from '../common/constants';

const DEFAULT_TRACER_NAME = 'autotel-plugins/rabbitmq';

/**
 * Create a publish span for RabbitMQ message publishing.
 *
 * This creates a PRODUCER span with proper messaging attributes.
 * The callback runs within the span's context, so you can call
 * `injectTraceHeaders()` inside it to get the correct trace context.
 *
 * @param descriptor - Publish span configuration
 * @param fn - Async callback to execute within the span
 * @returns Promise resolving to callback result
 * @throws Error if span creation fails or callback throws
 *
 * @example
 * ```typescript
 * await withPublishSpan({
 *   name: 'payment.publish',
 *   exchange: 'payments',
 *   routingKey: 'payment.processed',
 *   correlationId: paymentId,
 * }, async (span) => {
 *   const headers = injectTraceHeaders({}, { includeCorrelationIdHeader: true });
 *   channel.publish('payments', 'payment.processed', content, { headers });
 * });
 * ```
 *
 * @example Using default exchange
 * ```typescript
 * await withPublishSpan({
 *   name: 'direct.send',
 *   routingKey: 'queue-name',  // Queue name when using default exchange
 * }, async (span) => {
 *   const headers = injectTraceHeaders({});
 *   channel.sendToQueue('queue-name', content, { headers });
 * });
 * ```
 */
export async function withPublishSpan<T>(
  descriptor: PublishDescriptor,
  fn: PublishSpanCallback<T>,
): Promise<T> {
  const {
    name,
    exchange = 'amq.default',
    routingKey,
    messageId,
    correlationId,
    system = 'rabbitmq',
  } = descriptor;

  const tracer = trace.getTracer(DEFAULT_TRACER_NAME);

  // Create PRODUCER span
  const span = tracer.startSpan(name, {
    kind: SpanKind.PRODUCER,
  });

  // Set messaging attributes
  span.setAttribute(SEMATTRS_MESSAGING_SYSTEM, system);
  span.setAttribute(SEMATTRS_MESSAGING_DESTINATION_NAME, exchange);
  span.setAttribute(SEMATTRS_MESSAGING_OPERATION_NAME, 'publish');
  span.setAttribute(
    SEMATTRS_MESSAGING_RABBITMQ_DESTINATION_ROUTING_KEY,
    routingKey,
  );

  if (messageId) {
    span.setAttribute(SEMATTRS_MESSAGING_MESSAGE_ID, messageId);
  }

  if (correlationId) {
    span.setAttribute(
      SEMATTRS_MESSAGING_MESSAGE_CONVERSATION_ID,
      correlationId,
    );
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
