/**
 * Messaging helpers for event-driven architectures
 *
 * Provides specialized tracing for message producers and consumers
 * with automatic context propagation, link extraction, and OTel
 * semantic convention compliance.
 *
 * @example Producer
 * ```typescript
 * import { traceProducer } from 'autotel/messaging';
 *
 * export const publishEvent = traceProducer({
 *   system: 'kafka',
 *   destination: 'user-events',
 * })(ctx => async (event: UserEvent) => {
 *   const headers = ctx.getTraceHeaders();
 *   await producer.send({
 *     topic: 'user-events',
 *     messages: [{ value: JSON.stringify(event), headers }]
 *   });
 * });
 * ```
 *
 * @example Consumer
 * ```typescript
 * import { traceConsumer } from 'autotel/messaging';
 *
 * export const processEvents = traceConsumer({
 *   system: 'kafka',
 *   destination: 'user-events',
 *   consumerGroup: 'event-processor',
 *   batchMode: true,
 * })(ctx => async (messages: KafkaMessage[]) => {
 *   // Links to producer spans are automatically extracted
 *   for (const msg of messages) {
 *     await processMessage(msg);
 *   }
 * });
 * ```
 *
 * @module
 */

import { SpanKind, context, propagation } from '@opentelemetry/api';
import type {
  Attributes,
  AttributeValue,
  Link,
  SpanContext,
} from '@opentelemetry/api';
import { trace } from './functional';
import type { TraceContext } from './trace-context';
import { createLinkFromHeaders, extractLinksFromBatch } from './sampling';

// ============================================================================
// Types
// ============================================================================

/**
 * Supported messaging systems
 */
export type MessagingSystem =
  | 'kafka'
  | 'rabbitmq'
  | 'sqs'
  | 'sns'
  | 'pubsub'
  | 'activemq'
  | 'azure_servicebus'
  | 'eventhubs'
  | (string & {});

/**
 * Messaging operation types
 */
export type MessagingOperation = 'publish' | 'receive' | 'process' | 'settle';

/**
 * Configuration for producer tracing
 */
export interface ProducerConfig {
  /** Messaging system (kafka, rabbitmq, sqs, etc.) */
  system: MessagingSystem;

  /** Destination name (topic/queue) */
  destination: string;

  /** Extract message ID from arguments */
  messageIdFrom?: string | ((args: unknown[]) => string | undefined);

  /** Extract partition from arguments (Kafka-specific) */
  partitionFrom?: string | ((args: unknown[]) => number | undefined);

  /** Extract message key from arguments (Kafka-specific) */
  keyFrom?: string | ((args: unknown[]) => string | undefined);

  /** Additional attributes to set on span */
  attributes?: Attributes;

  /** Propagate baggage in message headers */
  propagateBaggage?: boolean;

  /** Callback before sending (for custom attributes) */
  beforeSend?: (ctx: ProducerContext, args: unknown[]) => void;

  /** Callback on error */
  onError?: (error: Error, ctx: ProducerContext) => void;

  // ---- Extensible Hooks ("Bring Your Own" System Support) ----

  /**
   * Hook to add system-specific attributes
   *
   * Use this to add attributes for messaging systems not explicitly supported
   * (e.g., NATS, Temporal, Cloudflare Queues, Redis Streams).
   *
   * @example NATS attributes
   * ```typescript
   * customAttributes: (ctx, args) => ({
   *   'nats.subject': args[0].subject,
   *   'nats.reply_to': args[0].replyTo,
   *   'nats.stream': 'orders',
   * })
   * ```
   *
   * @example Temporal attributes
   * ```typescript
   * customAttributes: (ctx, args) => ({
   *   'temporal.workflow_id': args[0].workflowId,
   *   'temporal.run_id': args[0].runId,
   *   'temporal.task_queue': 'orders-queue',
   * })
   * ```
   */
  customAttributes?: (
    ctx: ProducerContext,
    args: unknown[],
  ) => Record<string, AttributeValue>;

  /**
   * Hook for custom header injection (beyond W3C traceparent)
   *
   * Use this to inject headers for systems that use non-standard
   * context propagation formats.
   *
   * @example Datadog headers
   * ```typescript
   * customHeaders: (ctx) => ({
   *   'x-datadog-trace-id': ctx.getTraceId(),
   *   'x-datadog-parent-id': ctx.getSpanId(),
   * })
   * ```
   *
   * @example Custom correlation headers
   * ```typescript
   * customHeaders: (ctx) => ({
   *   'x-correlation-id': correlationId,
   *   'x-request-id': requestId,
   * })
   * ```
   */
  customHeaders?: (ctx: ProducerContext) => Record<string, string>;
}

/**
 * Configuration for consumer tracing
 */
export interface ConsumerConfig {
  /** Messaging system (kafka, rabbitmq, sqs, etc.) */
  system: MessagingSystem;

  /** Destination name (topic/queue) */
  destination: string;

  /** Consumer group name */
  consumerGroup?: string;

  /** Extract headers from message for link creation */
  headersFrom?: string | ((msg: unknown) => Record<string, string> | undefined);

  /** Enable batch mode - extract links from all messages */
  batchMode?: boolean;

  /** Extract baggage from message headers */
  extractBaggage?: boolean;

  /** Additional attributes to set on span */
  attributes?: Attributes;

  /** Consumer lag metrics extraction */
  lagMetrics?: LagMetricsConfig;

  /** Callback when message goes to DLQ */
  onDLQ?: (ctx: ConsumerContext, reason: string) => void;

  /** Callback on error */
  onError?: (error: Error, ctx: ConsumerContext) => void;

  // ---- Message Ordering Support ----

  /**
   * Message ordering configuration
   *
   * Enable sequence tracking, out-of-order detection, and deduplication.
   *
   * @example Kafka ordering
   * ```typescript
   * ordering: {
   *   sequenceFrom: (msg) => msg.offset,
   *   partitionKeyFrom: (msg) => msg.key,
   *   detectOutOfOrder: true,
   *   onOutOfOrder: (ctx, info) => {
   *     console.warn(`Out of order: expected ${info.expectedSequence}, got ${info.currentSequence}`);
   *   },
   * }
   * ```
   */
  ordering?: OrderingConfig;

  // ---- Consumer Group Tracking ----

  /**
   * Consumer group tracking configuration
   *
   * Enables observability of consumer group state, including membership,
   * partition assignments, and rebalancing events.
   *
   * @example Kafka consumer group tracking
   * ```typescript
   * consumerGroupTracking: {
   *   memberId: () => consumer.memberId,
   *   groupInstanceId: process.env.KAFKA_GROUP_INSTANCE_ID,
   *   onRebalance: (ctx, event) => {
   *     if (event.type === 'revoked') {
   *       logger.warn('Partitions revoked', event.partitions);
   *     }
   *   },
   *   trackPartitionLag: true,
   * }
   * ```
   */
  consumerGroupTracking?: ConsumerGroupTrackingConfig;

  // ---- Extensible Hooks ("Bring Your Own" System Support) ----

  /**
   * Hook to add system-specific attributes
   *
   * Use this to add attributes for messaging systems not explicitly supported
   * (e.g., NATS, Temporal, Cloudflare Queues, Redis Streams).
   *
   * @example NATS consumer attributes
   * ```typescript
   * customAttributes: (ctx, msg) => ({
   *   'nats.subject': msg.subject,
   *   'nats.stream': msg.info?.stream,
   *   'nats.consumer': msg.info?.consumer,
   *   'nats.delivered_count': msg.info?.redeliveryCount,
   * })
   * ```
   *
   * @example Cloudflare Queue attributes
   * ```typescript
   * customAttributes: (ctx, msg) => ({
   *   'cloudflare.queue_id': msg.id,
   *   'cloudflare.timestamp_ms': msg.timestamp.getTime(),
   *   'cloudflare.attempts': msg.attempts,
   * })
   * ```
   */
  customAttributes?: (
    ctx: ConsumerContext,
    msg: unknown,
  ) => Record<string, AttributeValue>;

  /**
   * Hook for custom context extraction (beyond W3C traceparent)
   *
   * Use this to extract parent span context from systems that use
   * non-standard header formats.
   *
   * @example Datadog context extraction
   * ```typescript
   * customContextExtractor: (headers) => {
   *   const traceId = headers['x-datadog-trace-id'];
   *   const spanId = headers['x-datadog-parent-id'];
   *   if (!traceId || !spanId) return null;
   *   return {
   *     traceId: traceIdToOtel(traceId),
   *     spanId: spanIdToOtel(spanId),
   *     traceFlags: TraceFlags.SAMPLED,
   *   };
   * }
   * ```
   *
   * @example B3 format extraction
   * ```typescript
   * customContextExtractor: (headers) => {
   *   const traceId = headers['x-b3-traceid'];
   *   const spanId = headers['x-b3-spanid'];
   *   const sampled = headers['x-b3-sampled'] === '1';
   *   if (!traceId || !spanId) return null;
   *   return {
   *     traceId,
   *     spanId,
   *     traceFlags: sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
   *   };
   * }
   * ```
   */
  customContextExtractor?: (
    headers: Record<string, string>,
  ) => SpanContext | null;
}

/**
 * Configuration for consumer lag metrics
 */
export interface LagMetricsConfig {
  /** Get current message offset */
  getCurrentOffset?: (msg: unknown) => number | undefined;

  /** Get end offset (high watermark) - can be async */
  getEndOffset?: () => number | Promise<number>;

  /** Get committed offset - can be async */
  getCommittedOffset?: () => number | Promise<number>;

  /** Get partition from message */
  getPartition?: (msg: unknown) => number | undefined;
}

/**
 * Configuration for message ordering tracking
 */
export interface OrderingConfig {
  /**
   * Extract sequence number from message
   *
   * Sequence numbers enable out-of-order detection and gap analysis.
   *
   * @example Kafka offset
   * ```typescript
   * sequenceFrom: (msg) => msg.offset
   * ```
   */
  sequenceFrom?: (msg: unknown) => number | undefined;

  /**
   * Extract partition key from message
   *
   * Partition keys determine message ordering in Kafka.
   *
   * @example Message key
   * ```typescript
   * partitionKeyFrom: (msg) => msg.key
   * ```
   */
  partitionKeyFrom?: (msg: unknown) => string | undefined;

  /**
   * Extract message ID for deduplication
   *
   * Used to detect duplicate messages.
   *
   * @example Idempotency key
   * ```typescript
   * messageIdFrom: (msg) => msg.headers['idempotency-key']
   * ```
   */
  messageIdFrom?: (msg: unknown) => string | undefined;

  /**
   * Enable out-of-order detection
   *
   * Tracks sequence numbers per partition and detects when messages
   * arrive out of order.
   *
   * @default false
   */
  detectOutOfOrder?: boolean;

  /**
   * Enable deduplication detection
   *
   * Tracks message IDs and detects duplicates within the window.
   *
   * @default false
   */
  detectDuplicates?: boolean;

  /**
   * Deduplication window size (number of message IDs to track)
   *
   * @default 1000
   */
  deduplicationWindowSize?: number;

  /**
   * Callback when out-of-order message detected
   */
  onOutOfOrder?: (ctx: ConsumerContext, info: OutOfOrderInfo) => void;

  /**
   * Callback when duplicate message detected
   */
  onDuplicate?: (ctx: ConsumerContext, messageId: string) => void;
}

/**
 * Information about out-of-order message
 */
export interface OutOfOrderInfo {
  /** Current sequence number */
  currentSequence: number;

  /** Expected sequence number */
  expectedSequence: number;

  /** Partition key (if available) */
  partitionKey?: string;

  /** Gap size (positive = gap, negative = out of order) */
  gap: number;
}

// ============================================================================
// Consumer Group Tracking Types
// ============================================================================

/**
 * Configuration for consumer group tracking
 *
 * Enables observability of consumer group state, including membership,
 * partition assignments, and rebalancing events.
 *
 * @example Kafka consumer group tracking
 * ```typescript
 * consumerGroupTracking: {
 *   memberId: consumer.memberId,
 *   groupInstanceId: process.env.CONSUMER_ID,
 *   onRebalance: (ctx, event) => {
 *     if (event.type === 'assigned') {
 *       console.log(`Assigned partitions: ${event.partitions}`);
 *     }
 *   },
 * }
 * ```
 */
export interface ConsumerGroupTrackingConfig {
  /**
   * Consumer member ID
   *
   * Unique identifier assigned by the broker to this consumer.
   */
  memberId?: string | (() => string | undefined);

  /**
   * Static group instance ID (for static membership)
   *
   * If set, enables static group membership which prevents
   * rebalances when consumers restart.
   */
  groupInstanceId?: string | (() => string | undefined);

  /**
   * Callback when rebalance occurs
   */
  onRebalance?: (ctx: ConsumerContext, event: RebalanceEvent) => void;

  /**
   * Callback when partitions are assigned
   */
  onPartitionsAssigned?: (
    ctx: ConsumerContext,
    partitions: PartitionAssignment[],
  ) => void;

  /**
   * Callback when partitions are revoked
   */
  onPartitionsRevoked?: (
    ctx: ConsumerContext,
    partitions: PartitionAssignment[],
  ) => void;

  /**
   * Track consumer lag per partition
   *
   * @default true
   */
  trackPartitionLag?: boolean;

  /**
   * Track consumer heartbeat health
   *
   * @default false
   */
  trackHeartbeat?: boolean;

  /**
   * Heartbeat interval in milliseconds (for health tracking)
   */
  heartbeatIntervalMs?: number;
}

/**
 * Rebalance event types
 */
export type RebalanceType = 'assigned' | 'revoked' | 'lost';

/**
 * Rebalance event information
 */
export interface RebalanceEvent {
  /** Type of rebalance event */
  type: RebalanceType;

  /** Partitions affected by the rebalance */
  partitions: PartitionAssignment[];

  /** Timestamp of the rebalance event */
  timestamp: number;

  /** Generation ID (increments on each rebalance) */
  generation?: number;

  /** Consumer member ID */
  memberId?: string;

  /** Reason for the rebalance (if available) */
  reason?: string;
}

/**
 * Partition assignment information
 */
export interface PartitionAssignment {
  /** Topic name */
  topic: string;

  /** Partition number */
  partition: number;

  /** Initial offset (if available) */
  offset?: number;

  /** Metadata (if available) */
  metadata?: string;
}

/**
 * Consumer group state snapshot
 */
export interface ConsumerGroupState {
  /** Consumer group name */
  groupId: string;

  /** Consumer member ID */
  memberId?: string;

  /** Static instance ID (if using static membership) */
  groupInstanceId?: string;

  /** Currently assigned partitions */
  assignedPartitions: PartitionAssignment[];

  /** Group generation ID */
  generation?: number;

  /** Whether the consumer is currently active */
  isActive: boolean;

  /** Last heartbeat timestamp */
  lastHeartbeat?: number;

  /** Consumer state (stable, preparing_rebalance, completing_rebalance, dead) */
  state?:
    | 'stable'
    | 'preparing_rebalance'
    | 'completing_rebalance'
    | 'dead'
    | 'empty';
}

/**
 * Partition lag information
 */
export interface PartitionLag {
  /** Topic name */
  topic: string;

  /** Partition number */
  partition: number;

  /** Current consumer offset */
  currentOffset: number;

  /** End offset (high watermark) */
  endOffset: number;

  /** Calculated lag */
  lag: number;

  /** Timestamp of measurement */
  timestamp: number;
}

/**
 * DLQ failure category types
 */
export type DLQReasonCategory =
  | 'validation'
  | 'processing'
  | 'timeout'
  | 'poison'
  | 'unknown';

/**
 * Options for enhanced DLQ recording
 */
export interface DLQOptions {
  /**
   * Automatically link to the producer span context
   *
   * When true, creates a span link from the DLQ event back to
   * the original producer span for correlation.
   *
   * @default true
   */
  linkToProducer?: boolean;

  /**
   * Category of the failure that caused DLQ routing
   *
   * - validation: Message failed schema/format validation
   * - processing: Business logic error during processing
   * - timeout: Processing exceeded allowed time
   * - poison: Message causes repeated failures (poison pill)
   * - unknown: Uncategorized failure
   */
  reasonCategory?: DLQReasonCategory;

  /**
   * Number of processing attempts before DLQ routing
   */
  attemptCount?: number;

  /**
   * The original error that caused DLQ routing
   *
   * Error details are recorded as span attributes for debugging.
   */
  originalError?: Error;

  /**
   * Additional metadata to record with the DLQ event
   */
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Options for recording DLQ replay
 */
export interface DLQReplayOptions {
  /**
   * Original span context from DLQ message
   *
   * If provided, creates a span link to correlate with the original failure.
   */
  originalDLQSpanContext?: SpanContext;

  /**
   * Time spent in DLQ before replay (milliseconds)
   */
  dlqDwellTimeMs?: number;

  /**
   * Retry attempt number for this replay
   */
  replayAttempt?: number;
}

/**
 * Extended trace context for producers with header injection
 */
export interface ProducerContext extends TraceContext {
  /**
   * Get W3C trace context headers to inject into message
   *
   * @returns Headers object with traceparent and optionally tracestate
   *
   * @example
   * ```typescript
   * const headers = ctx.getTraceHeaders();
   * await producer.send({
   *   topic: 'events',
   *   messages: [{ value: data, headers }]
   * });
   * ```
   */
  getTraceHeaders(): { traceparent: string; tracestate?: string };

  /**
   * Get all propagation headers including baggage if enabled
   *
   * @returns Headers object with all W3C trace context headers
   */
  getAllPropagationHeaders(): Record<string, string>;

  /**
   * Get all headers including custom headers from customHeaders hook
   *
   * This combines W3C trace context headers, baggage (if enabled),
   * and any custom headers defined via the customHeaders hook.
   *
   * @returns Combined headers object
   *
   * @example
   * ```typescript
   * const headers = ctx.getFullHeaders();
   * // Contains: traceparent, tracestate, baggage (if enabled), and custom headers
   * await producer.send({ topic, messages: [{ value, headers }] });
   * ```
   */
  getFullHeaders(): Record<string, string>;
}

/**
 * Extended trace context for consumers
 */
export interface ConsumerContext extends TraceContext {
  /**
   * Record that a message is being sent to DLQ
   *
   * Enhanced with auto-linking to producer span, failure categorization,
   * and detailed error recording for comprehensive DLQ observability.
   *
   * @param reason - Human-readable reason for DLQ routing
   * @param dlqNameOrOptions - DLQ name (string) or enhanced options object
   * @param options - Enhanced DLQ options (when second param is dlqName)
   *
   * @example Basic usage (backwards compatible)
   * ```typescript
   * ctx.recordDLQ('Schema validation failed', 'orders-dlq');
   * ```
   *
   * @example Enhanced usage with options
   * ```typescript
   * ctx.recordDLQ('Invalid order total', 'orders-dlq', {
   *   reasonCategory: 'validation',
   *   attemptCount: 3,
   *   originalError: error,
   *   linkToProducer: true, // Auto-links to producer span
   * });
   * ```
   *
   * @example Using options object as second param
   * ```typescript
   * ctx.recordDLQ('Processing timeout', {
   *   reasonCategory: 'timeout',
   *   attemptCount: 5,
   *   metadata: { processingTimeMs: 30000 },
   * });
   * ```
   */
  recordDLQ(reason: string, dlqName?: string, options?: DLQOptions): void;
  recordDLQ(reason: string, options?: DLQOptions): void;

  /**
   * Record replay of a message from DLQ
   *
   * Use this when processing a message that was replayed from the DLQ
   * to create links for correlation and track replay metrics.
   *
   * @param options - Replay tracking options
   *
   * @example
   * ```typescript
   * export const processReplay = traceConsumer({
   *   system: 'kafka',
   *   destination: 'orders-dlq-replay',
   * })(ctx => async (message) => {
   *   ctx.recordReplay({
   *     originalDLQSpanContext: extractSpanContext(message.headers),
   *     dlqDwellTimeMs: Date.now() - message.timestamp,
   *     replayAttempt: message.replayCount,
   *   });
   *   await processOrder(message);
   * });
   * ```
   */
  recordReplay(options?: DLQReplayOptions): void;

  /**
   * Record retry attempt
   *
   * @param attemptNumber - Current retry attempt (1-based)
   * @param maxAttempts - Maximum retry attempts
   */
  recordRetry(attemptNumber: number, maxAttempts?: number): void;

  /**
   * Get the producer span context links extracted from message headers
   *
   * Useful for accessing the producer span context when implementing
   * custom DLQ or retry logic.
   *
   * @returns Array of span links extracted from the message, or empty array
   */
  getProducerLinks(): Link[];

  // ---- Message Ordering Methods ----

  /**
   * Check if the current message is a duplicate
   *
   * @returns True if the message has been seen before
   */
  isDuplicate(): boolean;

  /**
   * Check if the current message arrived out of order
   *
   * @returns Out of order info, or null if in order
   */
  getOutOfOrderInfo(): OutOfOrderInfo | null;

  /**
   * Get current sequence number
   *
   * @returns The sequence number, or null if not configured
   */
  getSequenceNumber(): number | null;

  /**
   * Get partition key
   *
   * @returns The partition key, or null if not configured
   */
  getPartitionKey(): string | null;

  // ---- Consumer Group Methods ----

  /**
   * Record a rebalance event
   *
   * Call this when the consumer group undergoes a rebalance to capture
   * the event as a span event with partition assignment details.
   *
   * @param event - The rebalance event details
   *
   * @example
   * ```typescript
   * consumer.on('rebalance', (event) => {
   *   ctx.recordRebalance({
   *     type: event.type,
   *     partitions: event.assignment,
   *     generation: event.generationId,
   *     timestamp: Date.now(),
   *   });
   * });
   * ```
   */
  recordRebalance(event: RebalanceEvent): void;

  /**
   * Record a heartbeat event
   *
   * Call this on each heartbeat to track consumer health.
   *
   * @param healthy - Whether the heartbeat was successful
   * @param latencyMs - Optional latency of the heartbeat in milliseconds
   */
  recordHeartbeat(healthy: boolean, latencyMs?: number): void;

  /**
   * Record partition lag for a specific partition
   *
   * @param lag - The partition lag information
   */
  recordPartitionLag(lag: PartitionLag): void;

  /**
   * Get the current consumer group state
   *
   * @returns The current consumer group state, or null if not configured
   */
  getConsumerGroupState(): ConsumerGroupState | null;

  /**
   * Get the consumer member ID
   *
   * @returns The member ID, or null if not available
   */
  getMemberId(): string | null;

  /**
   * Get the current partition assignments
   *
   * @returns Array of assigned partitions, or empty array if none
   */
  getAssignedPartitions(): PartitionAssignment[];
}

// ============================================================================
// Producer Helper
// ============================================================================

/**
 * Create a traced message producer function
 *
 * Sets SpanKind.PRODUCER, OTel messaging semantic attributes,
 * and provides context injection helpers.
 *
 * @param config - Producer configuration
 * @returns Factory function that wraps your producer logic
 *
 * @example Kafka producer
 * ```typescript
 * export const publishUserEvent = traceProducer({
 *   system: 'kafka',
 *   destination: 'user-events',
 *   messageIdFrom: (args) => args[0]?.eventId,
 * })(ctx => async (event: UserEvent) => {
 *   const headers = ctx.getTraceHeaders();
 *   await producer.send({
 *     topic: 'user-events',
 *     messages: [{
 *       key: event.userId,
 *       value: JSON.stringify(event),
 *       headers,
 *     }]
 *   });
 * });
 * ```
 *
 * @example SQS producer
 * ```typescript
 * export const sendToSQS = traceProducer({
 *   system: 'sqs',
 *   destination: 'orders-queue',
 * })(ctx => async (order: Order) => {
 *   const headers = ctx.getAllPropagationHeaders();
 *   await sqs.sendMessage({
 *     QueueUrl: QUEUE_URL,
 *     MessageBody: JSON.stringify(order),
 *     MessageAttributes: headersToSQSAttributes(headers),
 *   });
 * });
 * ```
 */
export function traceProducer<TArgs extends unknown[], TReturn>(
  config: ProducerConfig,
) {
  const spanName = `${config.system}.publish ${config.destination}`;

  return (
    fnFactory: (ctx: ProducerContext) => (...args: TArgs) => Promise<TReturn>,
  ): ((...args: TArgs) => Promise<TReturn>) => {
    return trace<TArgs, TReturn>(
      { name: spanName, spanKind: SpanKind.PRODUCER },
      (baseCtx) => {
        // Extend context with producer-specific methods
        const ctx = extendContextForProducer(baseCtx, config);

        // Set semantic convention attributes
        setProducerAttributes(ctx, config);

        // Call beforeSend callback if provided
        return (...args: TArgs) => {
          // Extract dynamic attributes from args
          setDynamicProducerAttributes(ctx, config, args);

          // Apply custom attributes hook if provided
          if (config.customAttributes) {
            const customAttrs = config.customAttributes(ctx, args);
            for (const [key, value] of Object.entries(customAttrs)) {
              if (value !== undefined && value !== null) {
                ctx.setAttribute(key, value as string | number | boolean);
              }
            }
          }

          if (config.beforeSend) {
            config.beforeSend(ctx, args);
          }

          // Execute user's function
          const userFn = fnFactory(ctx);
          return userFn(...args).catch((error) => {
            if (config.onError) {
              config.onError(error as Error, ctx);
            }
            throw error;
          });
        };
      },
    );
  };
}

// ============================================================================
// Consumer Helper
// ============================================================================

/**
 * Create a traced message consumer function
 *
 * Sets SpanKind.CONSUMER, OTel messaging semantic attributes,
 * automatically extracts links from producer trace headers,
 * and provides DLQ/retry recording helpers.
 *
 * @param config - Consumer configuration
 * @returns Factory function that wraps your consumer logic
 *
 * @example Kafka consumer (single message)
 * ```typescript
 * export const processUserEvent = traceConsumer({
 *   system: 'kafka',
 *   destination: 'user-events',
 *   consumerGroup: 'event-processor',
 *   headersFrom: (msg) => msg.headers,
 * })(ctx => async (message: KafkaMessage) => {
 *   // Link to producer span is automatically created
 *   const event = JSON.parse(message.value.toString());
 *   await processEvent(event);
 * });
 * ```
 *
 * @example Kafka consumer (batch mode)
 * ```typescript
 * export const processUserEventBatch = traceConsumer({
 *   system: 'kafka',
 *   destination: 'user-events',
 *   consumerGroup: 'event-processor',
 *   batchMode: true,
 *   headersFrom: (msg) => msg.headers,
 *   lagMetrics: {
 *     getCurrentOffset: (msg) => msg.offset,
 *     getEndOffset: () => consumer.getHighWatermark(),
 *     getPartition: (msg) => msg.partition,
 *   },
 * })(ctx => async (messages: KafkaMessage[]) => {
 *   // Links to all producer spans are automatically created
 *   for (const msg of messages) {
 *     await processEvent(JSON.parse(msg.value.toString()));
 *   }
 * });
 * ```
 *
 * @example SQS consumer with DLQ handling
 * ```typescript
 * export const processSQSMessage = traceConsumer({
 *   system: 'sqs',
 *   destination: 'orders-queue',
 *   headersFrom: (msg) => sqsAttributesToHeaders(msg.MessageAttributes),
 *   onDLQ: (ctx, reason) => {
 *     ctx.recordDLQ(reason, 'orders-dlq');
 *   },
 * })(ctx => async (message: SQSMessage) => {
 *   try {
 *     await processOrder(JSON.parse(message.Body));
 *   } catch (error) {
 *     if (message.ApproximateReceiveCount > 3) {
 *       ctx.recordDLQ(error.message);
 *       throw error;
 *     }
 *     ctx.recordRetry(message.ApproximateReceiveCount, 3);
 *     throw error;
 *   }
 * });
 * ```
 */
export function traceConsumer<TArgs extends unknown[], TReturn>(
  config: ConsumerConfig,
) {
  const operation = config.batchMode ? 'receive' : 'process';
  const spanName = `${config.system}.${operation} ${config.destination}`;

  return (
    fnFactory: (ctx: ConsumerContext) => (...args: TArgs) => Promise<TReturn>,
  ): ((...args: TArgs) => Promise<TReturn>) => {
    return trace<TArgs, TReturn>(
      { name: spanName, spanKind: SpanKind.CONSUMER },
      (baseCtx) => {
        // Create mutable storage for producer links (populated during extractAndAddLinks)
        const linkStorage: ProducerLinkStorage = { links: [] };

        // Create mutable ordering state (populated during extractOrdering)
        const orderingState: OrderingState = {
          sequenceNumber: null,
          partitionKey: null,
          messageId: null,
          isDuplicate: false,
          outOfOrderInfo: null,
        };

        // Create consumer group state
        const groupTracking = config.consumerGroupTracking;
        const groupState: ConsumerGroupStateInternal = {
          memberId:
            typeof groupTracking?.memberId === 'function'
              ? (groupTracking.memberId() ?? null)
              : (groupTracking?.memberId ?? null),
          groupInstanceId:
            typeof groupTracking?.groupInstanceId === 'function'
              ? (groupTracking.groupInstanceId() ?? null)
              : (groupTracking?.groupInstanceId ?? null),
          assignedPartitions: [],
          generation: null,
          isActive: true,
          lastHeartbeat: null,
          state: null,
        };

        // Extend context with consumer-specific methods
        const ctx = extendContextForConsumer(
          baseCtx,
          config,
          linkStorage,
          orderingState,
          groupState,
        );

        // Set semantic convention attributes
        setConsumerAttributes(ctx, config);

        return async (...args: TArgs) => {
          // Extract links from message headers (includes customContextExtractor if provided)
          // This also populates linkStorage.links for getProducerLinks() and DLQ auto-linking
          await extractAndAddLinks(ctx, config, args, linkStorage);

          // Extract and process ordering information
          if (config.ordering) {
            extractAndProcessOrdering(ctx, config, args, orderingState);
          }

          // Extract lag metrics if configured
          if (config.lagMetrics) {
            await extractLagMetrics(ctx, config.lagMetrics, args);
          }

          // Apply custom attributes hook if provided
          if (config.customAttributes) {
            // For batch mode, extract first message; for single mode, use args[0] directly
            const batch = args[0];
            const msg =
              config.batchMode && Array.isArray(batch) && batch.length > 0
                ? batch[0]
                : batch;
            // Only call hook if we have a message
            if (msg !== undefined) {
              const customAttrs = config.customAttributes(ctx, msg);
              for (const [key, value] of Object.entries(customAttrs)) {
                if (value !== undefined && value !== null) {
                  ctx.setAttribute(key, value as string | number | boolean);
                }
              }
            }
          }

          // Execute user's function
          const userFn = fnFactory(ctx);
          return userFn(...args).catch((error) => {
            if (config.onError) {
              config.onError(error as Error, ctx);
            }
            throw error;
          });
        };
      },
    );
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extend base context with producer-specific methods
 */
function extendContextForProducer(
  baseCtx: TraceContext,
  config: ProducerConfig,
): ProducerContext {
  // Create a reference for `this` binding in getFullHeaders
  const producerCtx: ProducerContext = {
    ...baseCtx,

    getTraceHeaders(): { traceparent: string; tracestate?: string } {
      const headers: Record<string, string> = {};
      propagation.inject(context.active(), headers);

      const result: { traceparent: string; tracestate?: string } = {
        traceparent: headers['traceparent'] || '',
      };

      if (headers['tracestate']) {
        result.tracestate = headers['tracestate'];
      }

      return result;
    },

    getAllPropagationHeaders(): Record<string, string> {
      const headers: Record<string, string> = {};
      propagation.inject(context.active(), headers);

      // Include baggage if configured
      if (config.propagateBaggage) {
        const baggage = propagation.getBaggage(context.active());
        if (baggage) {
          const entries: string[] = [];
          for (const [key, value] of baggage.getAllEntries()) {
            entries.push(
              `${encodeURIComponent(key)}=${encodeURIComponent(value.value)}`,
            );
          }
          if (entries.length > 0) {
            headers['baggage'] = entries.join(',');
          }
        }
      }

      return headers;
    },

    getFullHeaders(): Record<string, string> {
      // Start with all propagation headers (W3C + baggage)
      const headers = producerCtx.getAllPropagationHeaders();

      // Add custom headers from hook if configured
      if (config.customHeaders) {
        const customHeaders = config.customHeaders(producerCtx);
        Object.assign(headers, customHeaders);
      }

      return headers;
    },
  };

  return producerCtx;
}

/**
 * Mutable storage for producer links (populated during extractAndAddLinks)
 */
interface ProducerLinkStorage {
  links: Link[];
}

/**
 * Ordering state for a single message
 */
interface OrderingState {
  sequenceNumber: number | null;
  partitionKey: string | null;
  messageId: string | null;
  isDuplicate: boolean;
  outOfOrderInfo: OutOfOrderInfo | null;
}

/**
 * Global sequence tracker for out-of-order detection (per partition)
 */
const sequenceTrackers = new Map<string, number>();

/**
 * Global deduplication window (LRU-style using Map insertion order)
 */
const deduplicationWindow = new Map<string, number>();
const DEFAULT_DEDUP_WINDOW_SIZE = 1000;

/**
 * Clean up old entries from deduplication window
 */
function trimDeduplicationWindow(maxSize: number): void {
  if (deduplicationWindow.size > maxSize) {
    const excess = deduplicationWindow.size - maxSize;
    const iterator = deduplicationWindow.keys();
    for (let i = 0; i < excess; i++) {
      const key = iterator.next().value;
      if (key) deduplicationWindow.delete(key);
    }
  }
}

/**
 * Consumer group state tracking for a single consumer
 */
interface ConsumerGroupStateInternal {
  memberId: string | null;
  groupInstanceId: string | null;
  assignedPartitions: PartitionAssignment[];
  generation: number | null;
  isActive: boolean;
  lastHeartbeat: number | null;
  state: ConsumerGroupState['state'] | null;
}

/**
 * Extend base context with consumer-specific methods
 */
function extendContextForConsumer(
  baseCtx: TraceContext,
  config: ConsumerConfig,
  linkStorage: ProducerLinkStorage,
  orderingState: OrderingState,
  groupState: ConsumerGroupStateInternal,
): ConsumerContext {
  const consumerCtx: ConsumerContext = {
    ...baseCtx,

    recordDLQ(
      reason: string,
      dlqNameOrOptions?: string | DLQOptions,
      optionsParam?: DLQOptions,
    ): void {
      // Parse overloaded arguments
      let dlqName: string | undefined;
      let options: DLQOptions | undefined;

      if (typeof dlqNameOrOptions === 'string') {
        dlqName = dlqNameOrOptions;
        options = optionsParam;
      } else if (typeof dlqNameOrOptions === 'object') {
        options = dlqNameOrOptions;
      }

      // Default linkToProducer to true
      const linkToProducer = options?.linkToProducer ?? true;

      // Set basic DLQ attributes
      baseCtx.setAttribute('messaging.dlq.reason', reason);
      if (dlqName) {
        baseCtx.setAttribute('messaging.dlq.name', dlqName);
      }

      // Set enhanced DLQ attributes
      if (options?.reasonCategory) {
        baseCtx.setAttribute(
          'messaging.dlq.reason_category',
          options.reasonCategory,
        );
      }
      if (options?.attemptCount !== undefined) {
        baseCtx.setAttribute(
          'messaging.dlq.attempt_count',
          options.attemptCount,
        );
      }
      if (options?.originalError) {
        baseCtx.setAttribute(
          'messaging.dlq.error.type',
          options.originalError.name,
        );
        baseCtx.setAttribute(
          'messaging.dlq.error.message',
          options.originalError.message,
        );
      }

      // Set custom metadata
      if (options?.metadata) {
        for (const [key, value] of Object.entries(options.metadata)) {
          baseCtx.setAttribute(`messaging.dlq.metadata.${key}`, value);
        }
      }

      // Auto-link to producer span if available and enabled
      const producerLink = linkStorage.links[0];
      if (linkToProducer && producerLink) {
        baseCtx.setAttribute(
          'messaging.dlq.producer_trace_id',
          producerLink.context.traceId,
        );
        baseCtx.setAttribute(
          'messaging.dlq.producer_span_id',
          producerLink.context.spanId,
        );
      }

      // Record event with all attributes
      const eventAttrs: Record<string, string | number | boolean> = {
        'messaging.dlq.reason': reason,
        ...(dlqName && { 'messaging.dlq.name': dlqName }),
        ...(options?.reasonCategory && {
          'messaging.dlq.reason_category': options.reasonCategory,
        }),
        ...(options?.attemptCount !== undefined && {
          'messaging.dlq.attempt_count': options.attemptCount,
        }),
        ...(options?.originalError && {
          'messaging.dlq.error.type': options.originalError.name,
          'messaging.dlq.error.message': options.originalError.message,
        }),
      };

      // Add producer link info to event if available
      if (linkToProducer && producerLink) {
        eventAttrs['messaging.dlq.producer_trace_id'] =
          producerLink.context.traceId;
        eventAttrs['messaging.dlq.producer_span_id'] =
          producerLink.context.spanId;
      }

      baseCtx.addEvent('dlq_routed', eventAttrs);

      // Call user's onDLQ callback if provided
      if (config.onDLQ) {
        config.onDLQ(consumerCtx, reason);
      }
    },

    recordReplay(options?: DLQReplayOptions): void {
      baseCtx.setAttribute('messaging.replay', true);

      if (options?.replayAttempt !== undefined) {
        baseCtx.setAttribute('messaging.replay.attempt', options.replayAttempt);
      }
      if (options?.dlqDwellTimeMs !== undefined) {
        baseCtx.setAttribute(
          'messaging.replay.dwell_time_ms',
          options.dlqDwellTimeMs,
        );
      }

      // Create span link to original DLQ span if provided
      if (options?.originalDLQSpanContext) {
        baseCtx.addLinks([
          {
            context: options.originalDLQSpanContext,
            attributes: { 'messaging.link.source': 'dlq_replay' },
          },
        ]);
      }

      const eventAttrs: Record<string, string | number | boolean> = {
        'messaging.replay': true,
        ...(options?.replayAttempt !== undefined && {
          'messaging.replay.attempt': options.replayAttempt,
        }),
        ...(options?.dlqDwellTimeMs !== undefined && {
          'messaging.replay.dwell_time_ms': options.dlqDwellTimeMs,
        }),
      };

      baseCtx.addEvent('dlq_replay', eventAttrs);
    },

    recordRetry(attemptNumber: number, maxAttempts?: number): void {
      baseCtx.setAttribute('messaging.retry.count', attemptNumber);
      if (maxAttempts !== undefined) {
        baseCtx.setAttribute('messaging.retry.max_attempts', maxAttempts);
      }
      baseCtx.addEvent('retry_attempt', {
        'messaging.retry.count': attemptNumber,
        ...(maxAttempts !== undefined && {
          'messaging.retry.max_attempts': maxAttempts,
        }),
      });
    },

    getProducerLinks(): Link[] {
      return [...linkStorage.links];
    },

    // ---- Ordering Methods ----

    isDuplicate(): boolean {
      return orderingState.isDuplicate;
    },

    getOutOfOrderInfo(): OutOfOrderInfo | null {
      return orderingState.outOfOrderInfo;
    },

    getSequenceNumber(): number | null {
      return orderingState.sequenceNumber;
    },

    getPartitionKey(): string | null {
      return orderingState.partitionKey;
    },

    // ---- Consumer Group Methods ----

    recordRebalance(event: RebalanceEvent): void {
      // Update internal state including consumer group state
      if (event.type === 'assigned') {
        groupState.assignedPartitions = event.partitions;
        groupState.isActive = true;
        // After assignment completes, group is stable
        groupState.state = 'stable';
      } else if (event.type === 'revoked' || event.type === 'lost') {
        // Remove revoked partitions from assignments
        const revokedSet = new Set(
          event.partitions.map((p) => `${p.topic}:${p.partition}`),
        );
        groupState.assignedPartitions = groupState.assignedPartitions.filter(
          (p) => !revokedSet.has(`${p.topic}:${p.partition}`),
        );
        if (event.type === 'lost') {
          groupState.isActive = false;
          // Consumer lost connection, mark as dead
          groupState.state = 'dead';
        } else {
          // Revoked means rebalance is starting
          // If no partitions remain, consumer is empty; otherwise preparing for rebalance
          groupState.state =
            groupState.assignedPartitions.length === 0
              ? 'empty'
              : 'preparing_rebalance';
        }
      }

      if (event.generation !== undefined) {
        groupState.generation = event.generation;
      }
      if (event.memberId) {
        groupState.memberId = event.memberId;
      }

      // Set span attributes
      baseCtx.setAttribute(
        'messaging.consumer_group.rebalance.type',
        event.type,
      );
      baseCtx.setAttribute(
        'messaging.consumer_group.rebalance.partition_count',
        event.partitions.length,
      );
      if (event.generation !== undefined) {
        baseCtx.setAttribute(
          'messaging.consumer_group.generation',
          event.generation,
        );
      }
      if (event.memberId) {
        baseCtx.setAttribute(
          'messaging.consumer_group.member_id',
          event.memberId,
        );
      }
      if (event.reason) {
        baseCtx.setAttribute(
          'messaging.consumer_group.rebalance.reason',
          event.reason,
        );
      }

      // Set the new state on the span
      if (groupState.state) {
        baseCtx.setAttribute(
          'messaging.consumer_group.state',
          groupState.state,
        );
      }

      // Record event
      const eventAttrs: Record<string, string | number | boolean> = {
        'messaging.consumer_group.rebalance.type': event.type,
        'messaging.consumer_group.rebalance.partition_count':
          event.partitions.length,
        'messaging.consumer_group.rebalance.timestamp': event.timestamp,
        ...(event.generation !== undefined && {
          'messaging.consumer_group.generation': event.generation,
        }),
        ...(event.memberId && {
          'messaging.consumer_group.member_id': event.memberId,
        }),
        ...(event.reason && {
          'messaging.consumer_group.rebalance.reason': event.reason,
        }),
        ...(groupState.state && {
          'messaging.consumer_group.state': groupState.state,
        }),
      };

      // Add partition details if not too many
      if (event.partitions.length <= 10) {
        eventAttrs['messaging.consumer_group.rebalance.partitions'] =
          event.partitions.map((p) => `${p.topic}:${p.partition}`).join(',');
      }

      baseCtx.addEvent(`consumer_group_${event.type}`, eventAttrs);

      // Call user's onRebalance callback if provided
      if (config.consumerGroupTracking?.onRebalance) {
        config.consumerGroupTracking.onRebalance(consumerCtx, event);
      }

      // Call specific callbacks
      if (
        event.type === 'assigned' &&
        config.consumerGroupTracking?.onPartitionsAssigned
      ) {
        config.consumerGroupTracking.onPartitionsAssigned(
          consumerCtx,
          event.partitions,
        );
      }
      if (
        event.type === 'revoked' &&
        config.consumerGroupTracking?.onPartitionsRevoked
      ) {
        config.consumerGroupTracking.onPartitionsRevoked(
          consumerCtx,
          event.partitions,
        );
      }
    },

    recordHeartbeat(healthy: boolean, latencyMs?: number): void {
      groupState.lastHeartbeat = Date.now();

      baseCtx.setAttribute(
        'messaging.consumer_group.heartbeat.healthy',
        healthy,
      );
      if (latencyMs !== undefined) {
        baseCtx.setAttribute(
          'messaging.consumer_group.heartbeat.latency_ms',
          latencyMs,
        );
      }

      baseCtx.addEvent('consumer_group_heartbeat', {
        'messaging.consumer_group.heartbeat.healthy': healthy,
        'messaging.consumer_group.heartbeat.timestamp':
          groupState.lastHeartbeat,
        ...(latencyMs !== undefined && {
          'messaging.consumer_group.heartbeat.latency_ms': latencyMs,
        }),
      });
    },

    recordPartitionLag(lag: PartitionLag): void {
      const prefix = `messaging.consumer_group.lag.${lag.topic}.${lag.partition}`;

      baseCtx.setAttribute(`${prefix}.current_offset`, lag.currentOffset);
      baseCtx.setAttribute(`${prefix}.end_offset`, lag.endOffset);
      baseCtx.setAttribute(`${prefix}.lag`, lag.lag);

      baseCtx.addEvent('partition_lag_recorded', {
        'messaging.consumer_group.lag.topic': lag.topic,
        'messaging.consumer_group.lag.partition': lag.partition,
        'messaging.consumer_group.lag.current_offset': lag.currentOffset,
        'messaging.consumer_group.lag.end_offset': lag.endOffset,
        'messaging.consumer_group.lag.lag': lag.lag,
        'messaging.consumer_group.lag.timestamp': lag.timestamp,
      });
    },

    getConsumerGroupState(): ConsumerGroupState | null {
      if (!config.consumerGroup) {
        return null;
      }

      return {
        groupId: config.consumerGroup,
        memberId: groupState.memberId ?? undefined,
        groupInstanceId: groupState.groupInstanceId ?? undefined,
        assignedPartitions: [...groupState.assignedPartitions],
        generation: groupState.generation ?? undefined,
        isActive: groupState.isActive,
        lastHeartbeat: groupState.lastHeartbeat ?? undefined,
        state: groupState.state ?? undefined,
      };
    },

    getMemberId(): string | null {
      return groupState.memberId;
    },

    getAssignedPartitions(): PartitionAssignment[] {
      return [...groupState.assignedPartitions];
    },
  };

  return consumerCtx;
}

/**
 * Set OTel semantic convention attributes for producer
 */
function setProducerAttributes(
  ctx: TraceContext,
  config: ProducerConfig,
): void {
  ctx.setAttribute('messaging.system', config.system);
  ctx.setAttribute('messaging.operation', 'publish');
  ctx.setAttribute('messaging.destination.name', config.destination);

  // Set system-specific destination attribute
  if (config.system === 'kafka') {
    ctx.setAttribute('messaging.kafka.destination.topic', config.destination);
  }

  // Set custom attributes
  if (config.attributes) {
    setCustomAttributes(ctx, config.attributes);
  }
}

/**
 * Set dynamic producer attributes from arguments
 */
function setDynamicProducerAttributes(
  ctx: TraceContext,
  config: ProducerConfig,
  args: unknown[],
): void {
  // Message ID
  if (config.messageIdFrom) {
    const messageId = extractValue(config.messageIdFrom, args);
    if (messageId !== undefined) {
      ctx.setAttribute('messaging.message.id', String(messageId));
    }
  }

  // Partition (Kafka-specific)
  if (config.partitionFrom) {
    const partition = extractValue(config.partitionFrom, args);
    if (partition !== undefined) {
      ctx.setAttribute(
        'messaging.kafka.destination.partition',
        Number(partition),
      );
    }
  }

  // Key (Kafka-specific)
  if (config.keyFrom) {
    const key = extractValue(config.keyFrom, args);
    if (key !== undefined) {
      ctx.setAttribute('messaging.kafka.message.key', String(key));
    }
  }
}

/**
 * Set OTel semantic convention attributes for consumer
 */
function setConsumerAttributes(
  ctx: TraceContext,
  config: ConsumerConfig,
): void {
  ctx.setAttribute('messaging.system', config.system);
  ctx.setAttribute(
    'messaging.operation',
    config.batchMode ? 'receive' : 'process',
  );
  ctx.setAttribute('messaging.destination.name', config.destination);

  // Consumer group
  if (config.consumerGroup) {
    ctx.setAttribute('messaging.consumer.group', config.consumerGroup);

    // System-specific consumer group attribute
    if (config.system === 'kafka') {
      ctx.setAttribute('messaging.kafka.consumer.group', config.consumerGroup);
    }
  }

  // Set system-specific destination attribute
  if (config.system === 'kafka') {
    ctx.setAttribute('messaging.kafka.destination.topic', config.destination);
  }

  // Set custom attributes
  if (config.attributes) {
    setCustomAttributes(ctx, config.attributes);
  }
}

/**
 * Extract links from message headers and add to span
 *
 * Uses W3C trace context by default, falls back to customContextExtractor if provided.
 * Also populates linkStorage for getProducerLinks() and DLQ auto-linking.
 */
async function extractAndAddLinks(
  ctx: ConsumerContext,
  config: ConsumerConfig,
  args: unknown[],
  linkStorage: ProducerLinkStorage,
): Promise<void> {
  if (!config.headersFrom && !config.customContextExtractor) {
    return;
  }

  const links: Link[] = [];

  if (config.batchMode && Array.isArray(args[0])) {
    // Batch mode - extract links from all messages
    const messages = args[0] as unknown[];

    if (config.headersFrom) {
      const batchLinks = extractLinksFromBatch(
        messages.map((msg) => {
          const headers = extractHeaders(config.headersFrom!, msg);
          return { headers };
        }),
        'headers',
      );
      links.push(...batchLinks);
    }

    // Try custom context extractor for messages without W3C links
    if (config.customContextExtractor && config.headersFrom) {
      for (const msg of messages) {
        const headers = extractHeaders(config.headersFrom, msg);
        if (headers) {
          // Only use custom extractor if W3C headers weren't present
          const w3cLink = createLinkFromHeaders(headers);
          if (!w3cLink) {
            const customContext = config.customContextExtractor(headers);
            if (customContext) {
              links.push({
                context: customContext,
                attributes: { 'messaging.link.source': 'custom_extractor' },
              });
            }
          }
        }
      }
    }

    // Set batch count
    ctx.setAttribute('messaging.batch.message_count', messages.length);
  } else {
    // Single message mode
    const msg = args[0];
    const headers = config.headersFrom
      ? extractHeaders(config.headersFrom, msg)
      : undefined;

    if (headers) {
      // Try W3C format first
      const w3cLink = createLinkFromHeaders(headers);
      if (w3cLink) {
        links.push(w3cLink);
      } else if (config.customContextExtractor) {
        // Fall back to custom extractor
        const customContext = config.customContextExtractor(headers);
        if (customContext) {
          links.push({
            context: customContext,
            attributes: { 'messaging.link.source': 'custom_extractor' },
          });
        }
      }
    }
  }

  // Add all extracted links and store for getProducerLinks() / DLQ auto-linking
  if (links.length > 0) {
    ctx.addLinks(links);
    linkStorage.links.push(...links);
  }
}

/**
 * Extract lag metrics and set as span attributes
 */
async function extractLagMetrics(
  ctx: ConsumerContext,
  lagConfig: LagMetricsConfig,
  args: unknown[],
): Promise<void> {
  const msg = Array.isArray(args[0]) ? args[0][0] : args[0];

  // Current offset
  let currentOffset: number | undefined;
  if (lagConfig.getCurrentOffset && msg) {
    currentOffset = lagConfig.getCurrentOffset(msg);
    if (currentOffset !== undefined) {
      ctx.setAttribute('messaging.kafka.message.offset', currentOffset);
    }
  }

  // Partition
  if (lagConfig.getPartition && msg) {
    const partition = lagConfig.getPartition(msg);
    if (partition !== undefined) {
      ctx.setAttribute('messaging.kafka.partition', partition);
    }
  }

  // End offset (high watermark) and lag calculation
  if (lagConfig.getEndOffset) {
    try {
      const endOffset = await Promise.resolve(lagConfig.getEndOffset());
      if (endOffset !== undefined && currentOffset !== undefined) {
        const lag = endOffset - currentOffset;
        ctx.setAttribute('messaging.kafka.consumer_lag', lag);

        // Add lag event
        ctx.addEvent('consumer_lag_measured', {
          'messaging.kafka.consumer_lag': lag,
          'messaging.kafka.message.offset': currentOffset,
          'messaging.kafka.high_watermark': endOffset,
        });
      }
    } catch {
      // Ignore lag calculation errors
    }
  }

  // Committed offset
  if (lagConfig.getCommittedOffset) {
    try {
      const committedOffset = await Promise.resolve(
        lagConfig.getCommittedOffset(),
      );
      if (committedOffset !== undefined) {
        ctx.setAttribute('messaging.kafka.committed_offset', committedOffset);
      }
    } catch {
      // Ignore committed offset errors
    }
  }

  // Batch-specific metrics
  if (Array.isArray(args[0]) && args[0].length > 0) {
    const messages = args[0] as unknown[];
    if (lagConfig.getCurrentOffset) {
      const firstOffset = lagConfig.getCurrentOffset(messages[0]);
      const lastMessage = messages.at(-1);
      const lastOffset =
        lastMessage === undefined
          ? undefined
          : lagConfig.getCurrentOffset(lastMessage);

      if (firstOffset !== undefined) {
        ctx.setAttribute('messaging.batch.first_offset', firstOffset);
      }
      if (lastOffset !== undefined) {
        ctx.setAttribute('messaging.batch.last_offset', lastOffset);
      }
    }
  }
}

/**
 * Extract headers from message using config
 */
function extractHeaders(
  headersFrom: string | ((msg: unknown) => Record<string, string> | undefined),
  msg: unknown,
): Record<string, string> | undefined {
  if (typeof headersFrom === 'function') {
    return headersFrom(msg);
  }

  // String path - extract from message property
  if (typeof msg === 'object' && msg !== null) {
    const value = (msg as Record<string, unknown>)[headersFrom];
    if (typeof value === 'object' && value !== null) {
      return value as Record<string, string>;
    }
  }

  return undefined;
}

/**
 * Extract value from arguments using config
 */
function extractValue(
  extractor: string | ((args: unknown[]) => unknown),
  args: unknown[],
): unknown {
  if (typeof extractor === 'function') {
    return extractor(args);
  }

  // String path - extract from first argument
  const firstArg = args[0];
  if (typeof firstArg === 'object' && firstArg !== null) {
    return (firstArg as Record<string, unknown>)[extractor];
  }

  return undefined;
}

/**
 * Set custom attributes on context, handling non-primitive values
 */
function setCustomAttributes(ctx: TraceContext, attributes: Attributes): void {
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) {
      // setAttribute accepts primitives and arrays of primitives
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        ctx.setAttribute(key, value);
      } else if (Array.isArray(value)) {
        // Filter out null/undefined from arrays and ensure proper typing
        const cleanArray = value.filter(
          (v): v is string | number | boolean =>
            v !== null &&
            v !== undefined &&
            (typeof v === 'string' ||
              typeof v === 'number' ||
              typeof v === 'boolean'),
        );
        if (cleanArray.length > 0) {
          ctx.setAttribute(key, cleanArray as string[] | number[] | boolean[]);
        }
      } else {
        ctx.setAttribute(key, JSON.stringify(value));
      }
    }
  }
}

/**
 * Extract and process ordering information from message
 *
 * Handles:
 * - Sequence number extraction and tracking
 * - Out-of-order detection
 * - Duplicate detection
 * - Span attribute setting
 * - Callback invocation
 */
function extractAndProcessOrdering(
  ctx: ConsumerContext,
  config: ConsumerConfig,
  args: unknown[],
  orderingState: OrderingState,
): void {
  const ordering = config.ordering;
  if (!ordering) return;

  // Get messages to process - all messages in batch mode, single message otherwise
  const messages: unknown[] =
    config.batchMode && Array.isArray(args[0]) ? args[0] : [args[0]];

  if (messages.length === 0) return;

  // Track aggregate stats for batch reporting
  let outOfOrderCount = 0;
  let duplicateCount = 0;
  let lastSequence: number | null = null;
  let lastPartitionKey: string | null = null;
  let lastMessageId: string | null = null;

  for (const [i, msg] of messages.entries()) {
    if (!msg) continue;

    // Per-message state for this iteration
    let msgSequence: number | null = null;
    let msgPartitionKey: string | null = null;
    let msgId: string | null = null;

    // Extract sequence number
    if (ordering.sequenceFrom) {
      const seq = ordering.sequenceFrom(msg);
      if (seq !== undefined) {
        msgSequence = seq;
        lastSequence = seq;
      }
    }

    // Extract partition key
    if (ordering.partitionKeyFrom) {
      const key = ordering.partitionKeyFrom(msg);
      if (key !== undefined) {
        msgPartitionKey = key;
        lastPartitionKey = key;
      }
    }

    // Extract message ID for deduplication
    if (ordering.messageIdFrom) {
      const id = ordering.messageIdFrom(msg);
      if (id !== undefined) {
        msgId = id;
        lastMessageId = id;
      }
    }

    // Out-of-order detection for this message
    if (ordering.detectOutOfOrder && msgSequence !== null) {
      // Build tracker key using per-message partition key
      const msgOrderingState: OrderingState = {
        sequenceNumber: msgSequence,
        partitionKey: msgPartitionKey,
        messageId: msgId,
        isDuplicate: false,
        outOfOrderInfo: null,
      };
      const trackerKey = buildTrackerKey(config, msgOrderingState);
      const prevSequence = sequenceTrackers.get(trackerKey);

      if (prevSequence !== undefined) {
        const expectedSequence = prevSequence + 1;

        if (msgSequence !== expectedSequence) {
          outOfOrderCount++;
          const gap = msgSequence - expectedSequence;
          const outOfOrderInfo: OutOfOrderInfo = {
            currentSequence: msgSequence,
            expectedSequence,
            partitionKey: msgPartitionKey ?? undefined,
            gap,
          };

          // Store the first out-of-order info for backward compatibility
          if (!orderingState.outOfOrderInfo) {
            orderingState.outOfOrderInfo = outOfOrderInfo;
          }

          // Add event for each out-of-order message
          ctx.addEvent('message_out_of_order', {
            'messaging.ordering.batch_index': i,
            'messaging.ordering.current_sequence': msgSequence,
            'messaging.ordering.expected_sequence': expectedSequence,
            'messaging.ordering.gap': gap,
            ...(msgPartitionKey && {
              'messaging.ordering.partition_key': msgPartitionKey,
            }),
          });

          // Call user callback if provided
          if (ordering.onOutOfOrder) {
            ordering.onOutOfOrder(ctx, outOfOrderInfo);
          }
        }
      }

      // Update tracker with this message's sequence
      sequenceTrackers.set(trackerKey, msgSequence);
    }

    // Duplicate detection for this message
    if (ordering.detectDuplicates && msgId !== null) {
      const msgOrderingState: OrderingState = {
        sequenceNumber: msgSequence,
        partitionKey: msgPartitionKey,
        messageId: msgId,
        isDuplicate: false,
        outOfOrderInfo: null,
      };
      const dedupKey = buildDedupKey(config, msgOrderingState);

      if (deduplicationWindow.has(dedupKey)) {
        duplicateCount++;

        // Add event for each duplicate
        ctx.addEvent('message_duplicate', {
          'messaging.ordering.batch_index': i,
          'messaging.message.id': msgId,
        });

        // Call user callback if provided
        if (ordering.onDuplicate) {
          ordering.onDuplicate(ctx, msgId);
        }
      } else {
        // Add to deduplication window
        deduplicationWindow.set(dedupKey, Date.now());

        // Trim window if needed
        const windowSize =
          ordering.deduplicationWindowSize ?? DEFAULT_DEDUP_WINDOW_SIZE;
        trimDeduplicationWindow(windowSize);
      }
    }
  }

  // Update orderingState with final values from the batch
  orderingState.sequenceNumber = lastSequence;
  orderingState.partitionKey = lastPartitionKey;
  orderingState.messageId = lastMessageId;
  orderingState.isDuplicate = duplicateCount > 0;

  // Set aggregate span attributes
  if (lastSequence !== null) {
    ctx.setAttribute('messaging.message.sequence_number', lastSequence);
  }
  if (lastPartitionKey !== null) {
    ctx.setAttribute('messaging.message.partition_key', lastPartitionKey);
  }
  if (lastMessageId !== null) {
    ctx.setAttribute('messaging.message.id', lastMessageId);
  }

  // Report batch-level ordering statistics
  if (outOfOrderCount > 0) {
    ctx.setAttribute('messaging.ordering.out_of_order', true);
    ctx.setAttribute('messaging.ordering.out_of_order_count', outOfOrderCount);
  }
  if (duplicateCount > 0) {
    ctx.setAttribute('messaging.ordering.duplicate', true);
    ctx.setAttribute('messaging.ordering.duplicate_count', duplicateCount);
  }
}

/**
 * Build a unique key for sequence tracking based on system, destination, and partition
 */
function buildTrackerKey(
  config: ConsumerConfig,
  orderingState: OrderingState,
): string {
  const parts = [config.system, config.destination];
  if (orderingState.partitionKey) {
    parts.push(orderingState.partitionKey);
  }
  if (config.consumerGroup) {
    parts.push(config.consumerGroup);
  }
  return parts.join(':');
}

/**
 * Build a unique key for deduplication based on system, destination, and message ID
 */
function buildDedupKey(
  config: ConsumerConfig,
  orderingState: OrderingState,
): string {
  const parts = [config.system, config.destination];
  if (orderingState.messageId) {
    parts.push(orderingState.messageId);
  }
  return parts.join(':');
}

/**
 * Clear sequence tracking state (useful for testing)
 */
export function clearOrderingState(): void {
  sequenceTrackers.clear();
  deduplicationWindow.clear();
}
