/**
 * RabbitMQ Plugin - Composition layer for event-driven observability
 *
 * This plugin provides a composition layer that works alongside
 * @opentelemetry/instrumentation-amqplib to add:
 * - Consume span wrapper with context mode control (inherit/link/none)
 * - Publish span wrapper for proper PRODUCER semantics
 * - Batch lineage for fan-in trace correlation
 * - Correlation ID policy for org-level conventions
 * - Ack tracking for message acknowledgment visibility
 *
 * Philosophy: Not "instrument amqplib" but "make event-driven observability
 * easy and consistent." Better DX than manual span management.
 *
 * @example Basic consumer with processing span
 * ```typescript
 * import { withConsumeSpan } from 'autotel-plugins/rabbitmq';
 *
 * channel.consume('orders', async (msg) => {
 *   if (!msg) return;
 *   try {
 *     await withConsumeSpan({
 *       name: 'order.process',
 *       headers: msg.properties.headers,
 *       contextMode: 'inherit',
 *       queue: 'orders',
 *       exchange: msg.fields.exchange,
 *       routingKey: msg.fields.routingKey,
 *     }, async (span) => {
 *       await processOrder(msg);
 *       channel.ack(msg);
 *     });
 *   } catch (error) {
 *     channel.nack(msg, false, false);
 *   }
 * });
 * ```
 *
 * @example Publisher with proper PRODUCER span
 * ```typescript
 * import { withPublishSpan, injectTraceHeaders } from 'autotel-plugins/rabbitmq';
 *
 * await withPublishSpan({
 *   name: 'order.publish',
 *   exchange: 'orders',
 *   routingKey: 'order.created',
 *   correlationId: orderId,
 * }, async (span) => {
 *   // Inject headers inside the PRODUCER span context
 *   const headers = injectTraceHeaders({}, { includeCorrelationIdHeader: true });
 *   channel.publish('orders', 'order.created', content, { headers });
 * });
 * ```
 *
 * @example Deferred ack tracking
 * ```typescript
 * import { withConsumeSpan } from 'autotel-plugins/rabbitmq';
 *
 * await withConsumeSpan({
 *   name: 'order.process',
 *   headers: msg.properties.headers,
 *   deferSpanEnd: true,
 *   ackTimeoutMs: 60000,
 * }, async (span, controls) => {
 *   await processOrder(msg);
 *   controls.ack();  // Ends span with ack outcome
 * });
 * ```
 *
 * @example Batch processing with lineage
 * ```typescript
 * import {
 *   extractBatchLineage,
 *   withConsumeSpan,
 *   SEMATTRS_LINKED_TRACE_ID_COUNT,
 *   SEMATTRS_LINKED_TRACE_ID_HASH,
 * } from 'autotel-plugins/rabbitmq';
 *
 * const lineage = extractBatchLineage(
 *   messages.map(m => ({ headers: m.properties.headers }))
 * );
 *
 * await withConsumeSpan({
 *   name: 'batch.aggregate',
 *   headers: {},
 *   contextMode: 'none',
 *   links: lineage.links,
 *   queue: 'aggregator',
 * }, async (span) => {
 *   span.setAttribute(SEMATTRS_LINKED_TRACE_ID_COUNT, lineage.linked_trace_id_count);
 *   span.setAttribute(SEMATTRS_LINKED_TRACE_ID_HASH, lineage.linked_trace_id_hash);
 *   await processBatch(messages);
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

// Consume/processing span wrapper
export { withConsumeSpan } from './processing-span';

// Publish span wrapper
export { withPublishSpan } from './publish-span';

// Batch lineage utilities
export { extractBatchLineage } from './batch-lineage';

// Ack tracking helpers
export {
  recordAckResult,
  type AckResult,
  type RecordAckOptions,
} from './ack-tracking';

// Types
export type {
  RawAmqpHeaders,
  ContextMode,
  AckOutcome,
  AckControls,
  ConsumeDescriptor,
  PublishDescriptor,
  ConsumeSpanCallback,
  DeferredConsumeSpanCallback,
  PublishSpanCallback,
  BatchLineageOptions,
  BatchLineageResult,
  InjectOptions,
  BatchItem,
} from './types';

// Re-export messaging constants for convenience
export {
  SEMATTRS_MESSAGING_SYSTEM,
  SEMATTRS_MESSAGING_DESTINATION_NAME,
  SEMATTRS_MESSAGING_OPERATION_NAME,
  SEMATTRS_MESSAGING_MESSAGE_ID,
  SEMATTRS_MESSAGING_MESSAGE_CONVERSATION_ID,
  SEMATTRS_MESSAGING_CONSUMER_ID,
  SEMATTRS_MESSAGING_RABBITMQ_DESTINATION_ROUTING_KEY,
  SEMATTRS_MESSAGING_RABBITMQ_DESTINATION_EXCHANGE,
  SEMATTRS_MESSAGING_RABBITMQ_ACK_RESULT,
  SEMATTRS_MESSAGING_RABBITMQ_REQUEUE,
  SEMATTRS_LINKED_TRACE_ID_COUNT,
  SEMATTRS_LINKED_TRACE_ID_HASH,
  CORRELATION_ID_HEADER,
} from '../common/constants';
