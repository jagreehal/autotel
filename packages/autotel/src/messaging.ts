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
import type { Attributes, Link } from '@opentelemetry/api';
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
}

/**
 * Extended trace context for consumers
 */
export interface ConsumerContext extends TraceContext {
  /**
   * Record that a message is being sent to DLQ
   *
   * @param reason - Reason for DLQ routing
   * @param dlqName - Optional DLQ name
   */
  recordDLQ(reason: string, dlqName?: string): void;

  /**
   * Record retry attempt
   *
   * @param attemptNumber - Current retry attempt (1-based)
   * @param maxAttempts - Maximum retry attempts
   */
  recordRetry(attemptNumber: number, maxAttempts?: number): void;
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
        // Extend context with consumer-specific methods
        const ctx = extendContextForConsumer(baseCtx, config);

        // Set semantic convention attributes
        setConsumerAttributes(ctx, config);

        return async (...args: TArgs) => {
          // Extract links from message headers
          await extractAndAddLinks(ctx, config, args);

          // Extract lag metrics if configured
          if (config.lagMetrics) {
            await extractLagMetrics(ctx, config.lagMetrics, args);
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
  return {
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
  };
}

/**
 * Extend base context with consumer-specific methods
 */
function extendContextForConsumer(
  baseCtx: TraceContext,
  config: ConsumerConfig,
): ConsumerContext {
  return {
    ...baseCtx,

    recordDLQ(reason: string, dlqName?: string): void {
      baseCtx.setAttribute('messaging.dlq.reason', reason);
      if (dlqName) {
        baseCtx.setAttribute('messaging.dlq.name', dlqName);
      }
      baseCtx.addEvent('dlq_routed', {
        'messaging.dlq.reason': reason,
        ...(dlqName && { 'messaging.dlq.name': dlqName }),
      });

      // Call user's onDLQ callback if provided
      if (config.onDLQ) {
        config.onDLQ(this, reason);
      }
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
  };
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
 */
async function extractAndAddLinks(
  ctx: ConsumerContext,
  config: ConsumerConfig,
  args: unknown[],
): Promise<void> {
  if (!config.headersFrom) {
    return;
  }

  const links: Link[] = [];

  if (config.batchMode && Array.isArray(args[0])) {
    // Batch mode - extract links from all messages
    const messages = args[0] as unknown[];
    const batchLinks = extractLinksFromBatch(
      messages.map((msg) => {
        const headers = extractHeaders(config.headersFrom!, msg);
        return { headers };
      }),
      'headers',
    );
    links.push(...batchLinks);

    // Set batch count
    ctx.setAttribute('messaging.batch.message_count', messages.length);
  } else {
    // Single message mode
    const msg = args[0];
    const headers = extractHeaders(config.headersFrom, msg);
    if (headers) {
      const link = createLinkFromHeaders(headers);
      if (link) {
        links.push(link);
      }
    }
  }

  // Add all extracted links
  if (links.length > 0) {
    ctx.addLinks(links);
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
