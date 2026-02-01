/**
 * Batch consumer wrapper for KafkaJS batch processing.
 *
 * Provides observability for eachBatch processing while preserving
 * the exact KafkaJS signature and passing through all functions.
 *
 * @example Basic batch consumer
 * ```typescript
 * import { withBatchConsumer } from 'autotel-plugins/kafka';
 *
 * await consumer.run({
 *   eachBatch: withBatchConsumer({
 *     name: 'orders.batch',
 *     consumerGroup: 'processor',
 *   }, async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary, isRunning, isStale, pause }) => {
 *     for (const message of batch.messages) {
 *       await processOrder(message);
 *       resolveOffset(message.offset);
 *     }
 *   }),
 * });
 * ```
 */

import {
  otelTrace as trace,
  context,
  SpanKind,
  SpanStatusCode,
  type Span,
} from 'autotel';
import {
  SEMATTRS_MESSAGING_SYSTEM,
  SEMATTRS_MESSAGING_DESTINATION_NAME,
  SEMATTRS_MESSAGING_KAFKA_CONSUMER_GROUP,
  SEMATTRS_MESSAGING_KAFKA_PARTITION,
  SEMATTRS_MESSAGING_KAFKA_OFFSET,
  SEMATTRS_MESSAGING_KAFKA_MESSAGE_KEY,
  SEMATTRS_MESSAGING_BATCH_MESSAGE_COUNT,
  SEMATTRS_MESSAGING_KAFKA_BATCH_FIRST_OFFSET,
  SEMATTRS_MESSAGING_KAFKA_BATCH_LAST_OFFSET,
  SEMATTRS_MESSAGING_KAFKA_BATCH_MESSAGES_PROCESSED,
  SEMATTRS_MESSAGING_KAFKA_BATCH_MESSAGES_FAILED,
  SEMATTRS_MESSAGING_KAFKA_BATCH_PROCESSING_TIME_MS,
} from '../common/constants';
import { normalizeHeaders, extractTraceContext } from './headers';

const DEFAULT_TRACER_NAME = 'autotel-plugins/kafka';

/**
 * KafkaJS batch payload interface.
 * Matches the exact signature from KafkaJS.
 */
export interface EachBatchPayload {
  batch: {
    topic: string;
    partition: number;
    messages: Array<{
      offset: string;
      key?: Buffer | null;
      value: Buffer | null;
      headers?: Record<string, Buffer | string | undefined>;
    }>;
    firstOffset(): string | null;
    lastOffset(): string;
    highWatermark: string;
  };
  resolveOffset(offset: string): void;
  heartbeat(): Promise<void>;
  commitOffsetsIfNecessary(
    offsets?: Record<string, Record<number, string>>,
  ): Promise<void>;
  uncommittedOffsets(): Record<string, Record<number, string>>;
  isRunning(): boolean;
  isStale(): boolean;
  pause(): () => void;
}

/**
 * Batch consumer handler type.
 */
export type EachBatchHandler = (payload: EachBatchPayload) => Promise<void>;

/**
 * Progress metrics during batch processing.
 */
export interface BatchProgressMetrics {
  /** Number of messages processed so far */
  processed: number;
  /** Number of messages that failed processing */
  failed: number;
  /** Number of messages skipped */
  skipped: number;
  /** Batch processing time in milliseconds */
  batchProcessingTimeMs: number;
}

/**
 * Per-message span mode.
 * - 'all': Create spans for every message. Message spans are parented to extracted trace context from message headers when valid (trace continuation); otherwise to the batch span. All per-message spans are ended when the batch completes, including messages never resolved via resolveOffset (no span leak).
 * - 'errors': Only create spans for messages that fail. When the handler throws, a per-message error span is created for the first message. Use createMessageErrorSpan in your catch block for per-message error spans.
 * - 'none': No per-message spans (default)
 */
export type PerMessageSpanMode = 'all' | 'errors' | 'none';

/**
 * Configuration for batch consumer wrapper.
 */
export interface BatchConsumerConfig {
  /**
   * Name for the batch processing span (e.g., "orders.batch")
   */
  name: string;

  /**
   * Consumer group name. Sets `messaging.kafka.consumer.group` attribute.
   */
  consumerGroup?: string;

  /**
   * Per-message span creation mode. When 'all', message spans follow extracted trace context from headers when valid (trace continuation), otherwise parent to the batch span; all per-message spans are ended on batch completion.
   * @default 'none' (to avoid cardinality explosion)
   */
  perMessageSpans?: PerMessageSpanMode;

  /**
   * Optional callback for real-time visibility into batch processing.
   */
  onProgress?: (metrics: BatchProgressMetrics) => void;
}

/**
 * Wrap a KafkaJS eachBatch handler with observability.
 *
 * Preserves the exact KafkaJS signature, passing through all functions unchanged.
 * Per-message spans are never leaked: all are ended on batch success or on handler throw.
 *
 * @param config - Batch consumer configuration
 * @param handler - The eachBatch handler to wrap
 * @returns Wrapped handler with observability
 *
 * @example With progress tracking
 * ```typescript
 * await consumer.run({
 *   eachBatch: withBatchConsumer({
 *     name: 'orders.batch',
 *     consumerGroup: 'processor',
 *     perMessageSpans: 'errors',
 *     onProgress: (metrics) => {
 *       console.log(`Processed ${metrics.processed}, failed ${metrics.failed}`);
 *     },
 *   }, async ({ batch, resolveOffset, heartbeat }) => {
 *     for (const message of batch.messages) {
 *       try {
 *         await processOrder(message);
 *         resolveOffset(message.offset);
 *       } catch (error) {
 *         // Per-message span created on error when perMessageSpans='errors'
 *       }
 *       await heartbeat();
 *     }
 *   }),
 * });
 * ```
 */
export function withBatchConsumer(
  config: BatchConsumerConfig,
  handler: EachBatchHandler,
): EachBatchHandler {
  const { name, consumerGroup, perMessageSpans = 'none', onProgress } = config;

  const tracer = trace.getTracer(DEFAULT_TRACER_NAME);

  return async (payload: EachBatchPayload): Promise<void> => {
    const { batch } = payload;
    const startTime = Date.now();

    // Metrics tracking
    let processed = 0;
    let failed = 0;
    let skipped = 0;

    // Create batch span
    const batchSpan = tracer.startSpan(name, {
      kind: SpanKind.CONSUMER,
    });

    // Set batch attributes
    setBatchAttributes(batchSpan, {
      topic: batch.topic,
      partition: batch.partition,
      consumerGroup,
      messageCount: batch.messages.length,
      firstOffset: batch.firstOffset() ?? undefined,
      lastOffset: batch.lastOffset(),
    });

    const spanContext = trace.setSpan(context.active(), batchSpan);

    // Create wrapped payload with optional per-message tracking
    const {
      wrappedPayload,
      endOpenMessageSpans,
      endRemainingMessageSpansOnSuccess,
    } = createWrappedPayload(
      payload,
      perMessageSpans,
      tracer,
      spanContext,
      (type: 'processed' | 'failed' | 'skipped') => {
        if (type === 'processed') processed++;
        else if (type === 'failed') failed++;
        else skipped++;

        if (onProgress) {
          onProgress({
            processed,
            failed,
            skipped,
            batchProcessingTimeMs: Date.now() - startTime,
          });
        }
      },
    );

    try {
      await context.with(spanContext, async () => {
        await handler(wrappedPayload);
      });

      // End any per-message spans that were never resolved (skipped/unresolved messages)
      endRemainingMessageSpansOnSuccess?.();

      // Set final metrics
      const processingTime = Date.now() - startTime;
      batchSpan.setAttribute(
        SEMATTRS_MESSAGING_KAFKA_BATCH_MESSAGES_PROCESSED,
        processed,
      );
      batchSpan.setAttribute(
        SEMATTRS_MESSAGING_KAFKA_BATCH_MESSAGES_FAILED,
        failed,
      );
      batchSpan.setAttribute(
        SEMATTRS_MESSAGING_KAFKA_BATCH_PROCESSING_TIME_MS,
        processingTime,
      );

      batchSpan.setStatus({ code: SpanStatusCode.OK });
      batchSpan.end();
    } catch (error) {
      // End any open per-message spans (e.g. handler threw after accessing message)
      endOpenMessageSpans?.(error);

      // In 'errors' mode, create a per-message error span for the first message when handler throws
      const firstMessage = batch.messages[0];
      if (perMessageSpans === 'errors' && firstMessage !== undefined) {
        createMessageErrorSpan(
          name,
          {
            offset: firstMessage.offset,
            key: firstMessage.key ?? undefined,
            headers: firstMessage.headers,
          },
          error instanceof Error ? error : new Error(String(error)),
          batch.topic,
          batch.partition,
        );
      }

      const processingTime = Date.now() - startTime;
      batchSpan.setAttribute(
        SEMATTRS_MESSAGING_KAFKA_BATCH_MESSAGES_PROCESSED,
        processed,
      );
      batchSpan.setAttribute(
        SEMATTRS_MESSAGING_KAFKA_BATCH_MESSAGES_FAILED,
        failed + 1, // Count the batch error
      );
      batchSpan.setAttribute(
        SEMATTRS_MESSAGING_KAFKA_BATCH_PROCESSING_TIME_MS,
        processingTime,
      );

      batchSpan.setStatus({ code: SpanStatusCode.ERROR });
      if (error instanceof Error) {
        batchSpan.recordException(error);
      } else {
        batchSpan.recordException(new Error(String(error)));
      }
      batchSpan.end();

      throw error;
    }
  };
}

/**
 * Set batch-level attributes on the span.
 */
function setBatchAttributes(
  span: Span,
  attrs: {
    topic: string;
    partition: number;
    consumerGroup?: string;
    messageCount: number;
    firstOffset?: string;
    lastOffset: string;
  },
): void {
  span.setAttribute(SEMATTRS_MESSAGING_SYSTEM, 'kafka');
  span.setAttribute(SEMATTRS_MESSAGING_DESTINATION_NAME, attrs.topic);
  span.setAttribute(SEMATTRS_MESSAGING_KAFKA_PARTITION, attrs.partition);
  span.setAttribute(SEMATTRS_MESSAGING_BATCH_MESSAGE_COUNT, attrs.messageCount);

  if (attrs.consumerGroup) {
    span.setAttribute(
      SEMATTRS_MESSAGING_KAFKA_CONSUMER_GROUP,
      attrs.consumerGroup,
    );
  }

  if (attrs.firstOffset) {
    span.setAttribute(
      SEMATTRS_MESSAGING_KAFKA_BATCH_FIRST_OFFSET,
      attrs.firstOffset,
    );
  }

  span.setAttribute(
    SEMATTRS_MESSAGING_KAFKA_BATCH_LAST_OFFSET,
    attrs.lastOffset,
  );
}

/**
 * Result of createWrappedPayload: wrapped payload and optional cleanup for open spans.
 */
interface WrappedPayloadResult {
  wrappedPayload: EachBatchPayload;
  endOpenMessageSpans?: (error: unknown) => void;
  endRemainingMessageSpansOnSuccess?: () => void;
}

/**
 * Create a wrapped payload that optionally tracks per-message processing.
 */
function createWrappedPayload(
  original: EachBatchPayload,
  perMessageSpans: PerMessageSpanMode,
  tracer: ReturnType<typeof trace.getTracer>,
  parentContext: ReturnType<typeof context.active>,
  onMetric: (type: 'processed' | 'failed' | 'skipped') => void,
): WrappedPayloadResult {
  if (perMessageSpans === 'none') {
    // Pass through unchanged, just track resolveOffset calls
    return {
      wrappedPayload: {
        ...original,
        resolveOffset: (offset: string) => {
          onMetric('processed');
          original.resolveOffset(offset);
        },
      },
    };
  }

  // For 'all' mode, create per-message spans upfront
  const messageSpans = new Map<string, Span>();

  // Pre-create spans for 'all' mode so they're created regardless of property access.
  // Use extracted trace context from message headers when valid (trace continuation);
  // otherwise parent to the batch span so message spans are not root spans.
  if (perMessageSpans === 'all') {
    for (const message of original.batch.messages) {
      const normalizedHeaders = normalizeHeaders(message.headers);
      const extractedCtx = extractTraceContext(normalizedHeaders);
      const spanContext = trace.getSpanContext(extractedCtx);
      const parentCtx =
        spanContext && trace.isSpanContextValid(spanContext)
          ? extractedCtx
          : parentContext;

      const span = tracer.startSpan(
        `${original.batch.topic}.${original.batch.partition}.${message.offset}`,
        {
          kind: SpanKind.CONSUMER,
        },
        parentCtx,
      );

      span.setAttributes({
        [SEMATTRS_MESSAGING_SYSTEM]: 'kafka',
        [SEMATTRS_MESSAGING_DESTINATION_NAME]: original.batch.topic,
        [SEMATTRS_MESSAGING_KAFKA_PARTITION]: original.batch.partition,
        [SEMATTRS_MESSAGING_KAFKA_OFFSET]: message.offset,
        ...(message.key && {
          [SEMATTRS_MESSAGING_KAFKA_MESSAGE_KEY]: message.key.toString(),
        }),
      });

      messageSpans.set(message.offset, span);
    }
  }

  const wrappedMessages = original.batch.messages.map((message) => ({
    ...message,
  }));

  const wrappedBatch = {
    ...original.batch,
    messages: wrappedMessages,
  };

  const wrappedPayload: EachBatchPayload = {
    ...original,
    batch: wrappedBatch,
    resolveOffset: (offset: string) => {
      onMetric('processed');
      // End the per-message span if one was created for this offset
      const span = messageSpans.get(offset);
      if (span) {
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        messageSpans.delete(offset);
      }
      original.resolveOffset(offset);
    },
  };

  const endOpenMessageSpans =
    perMessageSpans === 'all'
      ? (error: unknown) => {
          for (const [, span] of messageSpans) {
            span.setStatus({ code: SpanStatusCode.ERROR });
            if (error instanceof Error) {
              span.recordException(error);
            } else {
              span.recordException(new Error(String(error)));
            }
            span.end();
          }
          messageSpans.clear();
        }
      : undefined;

  const endRemainingMessageSpansOnSuccess =
    perMessageSpans === 'all'
      ? () => {
          for (const [, span] of messageSpans) {
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
          }
          messageSpans.clear();
        }
      : undefined;

  return {
    wrappedPayload,
    endOpenMessageSpans,
    endRemainingMessageSpansOnSuccess,
  };
}

/**
 * Helper to create a per-message span for error cases.
 * Call this in your error handler when using perMessageSpans: 'errors'.
 */
export function createMessageErrorSpan(
  name: string,
  message: {
    offset: string;
    key?: Buffer | null;
    headers?: Record<string, Buffer | string | undefined>;
  },
  error: Error,
  topic: string,
  partition: number,
): void {
  const tracer = trace.getTracer(DEFAULT_TRACER_NAME);

  const normalizedHeaders = normalizeHeaders(message.headers);
  const extractedCtx = extractTraceContext(normalizedHeaders);

  const span = tracer.startSpan(
    `${name}.error`,
    {
      kind: SpanKind.CONSUMER,
    },
    extractedCtx,
  );

  span.setAttributes({
    [SEMATTRS_MESSAGING_SYSTEM]: 'kafka',
    [SEMATTRS_MESSAGING_DESTINATION_NAME]: topic,
    [SEMATTRS_MESSAGING_KAFKA_PARTITION]: partition,
    [SEMATTRS_MESSAGING_KAFKA_OFFSET]: message.offset,
    ...(message.key && {
      [SEMATTRS_MESSAGING_KAFKA_MESSAGE_KEY]: message.key.toString(),
    }),
  });

  span.setStatus({ code: SpanStatusCode.ERROR });
  span.recordException(error);
  span.end();
}
