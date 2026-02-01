/**
 * Ack tracking utilities for RabbitMQ message processing.
 *
 * Provides helpers to record ack/nack/reject outcomes on spans
 * when not using deferred mode in withConsumeSpan.
 */

import type { Span } from 'autotel';
import {
  SEMATTRS_MESSAGING_RABBITMQ_ACK_RESULT,
  SEMATTRS_MESSAGING_RABBITMQ_REQUEUE,
} from '../common/constants';

/**
 * Ack result type for explicit recording.
 */
export type AckResult = 'ack' | 'nack' | 'reject';

/**
 * Options for recording ack results.
 */
export interface RecordAckOptions {
  /**
   * Whether the message will be requeued (for nack/reject).
   */
  requeue?: boolean;
}

/**
 * Record an ack result on a span.
 *
 * Use this when not using deferred mode but still want to track
 * ack/nack/reject outcomes as span attributes.
 *
 * @param span - The span to record on
 * @param result - The ack result ('ack', 'nack', or 'reject')
 * @param options - Additional options
 *
 * @example
 * ```typescript
 * import { withConsumeSpan, recordAckResult } from 'autotel-plugins/rabbitmq';
 *
 * await withConsumeSpan({
 *   name: 'order.process',
 *   headers: msg.properties.headers,
 *   queue: 'orders',
 * }, async (span) => {
 *   try {
 *     await processOrder(msg);
 *     recordAckResult(span, 'ack');
 *     channel.ack(msg);
 *   } catch (error) {
 *     recordAckResult(span, 'nack', { requeue: true });
 *     channel.nack(msg, false, true);
 *     throw error;
 *   }
 * });
 * ```
 */
export function recordAckResult(
  span: Span,
  result: AckResult,
  options?: RecordAckOptions,
): void {
  span.setAttribute(SEMATTRS_MESSAGING_RABBITMQ_ACK_RESULT, result);

  if (options?.requeue !== undefined) {
    span.setAttribute(SEMATTRS_MESSAGING_RABBITMQ_REQUEUE, options.requeue);
  }
}
