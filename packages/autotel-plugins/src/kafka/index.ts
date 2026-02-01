/**
 * Kafka Plugin - Composition layer for event-driven observability
 *
 * This plugin provides a composition layer that works alongside
 * @opentelemetry/instrumentation-kafkajs to add:
 * - Processing span wrapper with context mode control
 * - Producer span wrapper for proper PRODUCER semantics
 * - Batch lineage for fan-in trace correlation
 * - Correlation ID policy for org-level conventions
 *
 * Philosophy: Not "instrument KafkaJS" but "make event-driven observability
 * easy and consistent." Better DX than the official package.
 *
 * @example Basic consumer with processing span
 * ```typescript
 * import { withProcessingSpan } from 'autotel-plugins/kafka';
 *
 * await consumer.run({
 *   eachMessage: async ({ topic, partition, message }) => {
 *     try {
 *       await withProcessingSpan({
 *         name: 'order.process',
 *         headers: message.headers,
 *         contextMode: 'inherit',
 *         topic,
 *         consumerGroup: 'payments',
 *         partition,
 *         offset: message.offset,
 *       }, async (span) => {
 *         return await processOrder(message);
 *       });
 *     } catch (error) {
 *       logger.error('Processing failed', { error });
 *     }
 *   },
 * });
 * ```
 *
 * @example Producer with proper PRODUCER span
 * ```typescript
 * import { withProducerSpan, injectTraceHeaders } from 'autotel-plugins/kafka';
 *
 * await withProducerSpan({
 *   name: 'order.publish',
 *   topic: 'orders',
 *   messageKey: orderId,
 * }, async (span) => {
 *   // Inject headers inside the PRODUCER span context
 *   const headers = injectTraceHeaders({}, { includeCorrelationIdHeader: true });
 *   await producer.send({
 *     topic: 'orders',
 *     messages: [{ key: orderId, value: JSON.stringify(order), headers }],
 *   });
 * });
 * ```
 *
 * @example Feature flag for trace propagation
 * ```typescript
 * import { withProcessingSpan } from 'autotel-plugins/kafka';
 *
 * // Toggle trace propagation via environment variable
 * const propagateTrace = process.env.KAFKA_PROPAGATE_TRACE !== 'false';
 *
 * await withProcessingSpan({
 *   name: 'order.process',
 *   headers: message.headers,
 *   contextMode: propagateTrace ? 'inherit' : 'none', // 'none' = start new trace
 *   topic,
 *   consumerGroup: 'payments',
 * }, async (span) => {
 *   return await processOrder(message);
 * });
 * ```
 *
 * @example Batch processing with lineage (using semantic attribute constants)
 * ```typescript
 * import {
 *   extractBatchLineage,
 *   withProcessingSpan,
 *   SEMATTRS_LINKED_TRACE_ID_COUNT,
 *   SEMATTRS_LINKED_TRACE_ID_HASH,
 * } from 'autotel-plugins/kafka';
 *
 * const lineage = extractBatchLineage(batch, { maxLinks: 50 });
 *
 * await withProcessingSpan({
 *   name: 'settlement.batch',
 *   headers: {},
 *   contextMode: 'none',
 *   links: lineage.links,
 *   topic: 'settlements',
 *   consumerGroup: 'batcher',
 * }, async (span) => {
 *   // Use exported constants instead of string literals
 *   span.setAttribute(SEMATTRS_LINKED_TRACE_ID_COUNT, lineage.linked_trace_id_count);
 *   span.setAttribute(SEMATTRS_LINKED_TRACE_ID_HASH, lineage.linked_trace_id_hash);
 *   await processSettlement(batch);
 * });
 * ```
 *
 * @example With Map headers (e.g., @platformatic/kafka)
 * ```typescript
 * import { normalizeHeaders, withProcessingSpan } from 'autotel-plugins/kafka';
 *
 * // Platformatic Kafka returns headers as Map
 * const headers = normalizeHeaders(message.headers); // Works with Map or Record
 *
 * await withProcessingSpan({
 *   name: 'order.process',
 *   headers,
 *   contextMode: 'inherit',
 *   topic,
 * }, async (span) => {
 *   return await processOrder(message);
 * });
 * ```
 *
 * @packageDocumentation
 */

// Header utilities
export { normalizeHeaders, extractTraceContext } from './headers';

// Correlation ID helpers
export {
  injectTraceHeaders,
  extractCorrelationId,
  deriveCorrelationId,
} from './correlation';

// Processing span wrapper
export { withProcessingSpan } from './processing-span';

// Producer span wrapper
export { withProducerSpan } from './producer-span';

// Batch lineage utilities
export { extractBatchLineage, extractBatchLineageAsync } from './batch-lineage';

// Types
export type {
  RawKafkaHeaders,
  ContextMode,
  ProcessingDescriptor,
  ProducerDescriptor,
  ProcessingSpanCallback,
  ProducerSpanCallback,
  BatchLineageOptions,
  BatchLineageResult,
  InjectOptions,
  BatchItem,
} from './types';

// Re-export messaging constants for convenience
export {
  SEMATTRS_MESSAGING_SYSTEM,
  SEMATTRS_MESSAGING_DESTINATION_NAME,
  SEMATTRS_MESSAGING_OPERATION,
  SEMATTRS_MESSAGING_KAFKA_CONSUMER_GROUP,
  SEMATTRS_MESSAGING_KAFKA_PARTITION,
  SEMATTRS_MESSAGING_KAFKA_OFFSET,
  SEMATTRS_MESSAGING_KAFKA_MESSAGE_KEY,
  SEMATTRS_LINKED_TRACE_ID_COUNT,
  SEMATTRS_LINKED_TRACE_ID_HASH,
  CORRELATION_ID_HEADER,
} from '../common/constants';
