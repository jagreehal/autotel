/**
 * Kafka Plugin - Composition layer for event-driven observability
 *
 * This plugin provides a composition layer that works alongside
 * @opentelemetry/instrumentation-kafkajs to add:
 * - Processing span wrapper with context mode control
 * - Batch lineage for fan-in trace correlation
 * - Correlation ID policy for org-level conventions
 *
 * Philosophy: Not "instrument KafkaJS" but "make event-driven observability
 * easy and consistent." Better DX than the official package.
 *
 * @example Basic consumer with processing span
 * ```typescript
 * import { withProcessingSpan, normalizeHeaders } from 'autotel-plugins/kafka';
 *
 * await consumer.run({
 *   eachMessage: async ({ topic, partition, message }) => {
 *     await withProcessingSpan({
 *       name: 'order.process',
 *       headers: message.headers,
 *       contextMode: 'inherit',
 *       topic,
 *       consumerGroup: 'payments',
 *       partition,
 *       offset: message.offset,
 *     }, async (span) => {
 *       await processOrder(message);
 *     });
 *   },
 * });
 * ```
 *
 * @example Producer with trace headers
 * ```typescript
 * import { injectTraceHeaders } from 'autotel-plugins/kafka';
 *
 * const headers = injectTraceHeaders({}, { includeCorrelationIdHeader: true });
 * await producer.send({
 *   topic: 'orders',
 *   messages: [{ value: JSON.stringify(order), headers }],
 * });
 * ```
 *
 * @example Batch processing with lineage
 * ```typescript
 * import { extractBatchLineage, withProcessingSpan } from 'autotel-plugins/kafka';
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
 *   span.setAttribute('linked_trace_id_count', lineage.linked_trace_id_count);
 *   span.setAttribute('linked_trace_id_hash', lineage.linked_trace_id_hash);
 *   await processSettlement(batch);
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

// Batch lineage utilities
export { extractBatchLineage, extractBatchLineageAsync } from './batch-lineage';

// Types
export type {
  RawKafkaHeaders,
  ContextMode,
  ProcessingDescriptor,
  BatchLineageOptions,
  BatchLineageResult,
  InjectOptions,
  SpanError,
  ProcessingSpanResult,
  ProcessingSpanCallback,
  BatchItem,
} from './types';

// Re-export messaging constants for convenience
export {
  SEMATTRS_MESSAGING_SYSTEM,
  SEMATTRS_MESSAGING_DESTINATION_NAME,
  SEMATTRS_MESSAGING_KAFKA_CONSUMER_GROUP,
  SEMATTRS_MESSAGING_KAFKA_PARTITION,
  SEMATTRS_MESSAGING_KAFKA_OFFSET,
  SEMATTRS_MESSAGING_KAFKA_MESSAGE_KEY,
  SEMATTRS_LINKED_TRACE_ID_COUNT,
  SEMATTRS_LINKED_TRACE_ID_HASH,
  CORRELATION_ID_HEADER,
} from '../common/constants';
