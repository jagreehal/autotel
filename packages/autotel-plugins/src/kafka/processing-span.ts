/**
 * Processing span wrapper for Kafka message handling.
 *
 * Creates processing spans with proper context handling, supporting:
 * - Context mode control (inherit/link/none)
 * - Messaging attributes for consistent querying
 * - Integration with official KafkaJS instrumentation
 */

import {
  otelTrace as trace,
  context,
  SpanKind,
  SpanStatusCode,
  type Span,
  type SpanContext,
  type SpanLink,
} from 'autotel';
import { ok, err, type AsyncResult } from 'awaitly';
import type {
  ProcessingDescriptor,
  SpanError,
  ContextMode,
  ProcessingSpanCallback,
} from './types';
import { normalizeHeaders, extractTraceContext } from './headers';
import {
  SEMATTRS_MESSAGING_SYSTEM,
  SEMATTRS_MESSAGING_DESTINATION_NAME,
  SEMATTRS_MESSAGING_KAFKA_CONSUMER_GROUP,
  SEMATTRS_MESSAGING_KAFKA_PARTITION,
  SEMATTRS_MESSAGING_KAFKA_OFFSET,
  SEMATTRS_MESSAGING_KAFKA_MESSAGE_KEY,
} from '../common/constants';

const DEFAULT_TRACER_NAME = 'autotel-plugins/kafka';

/**
 * Check if a span context is valid (has both traceId and spanId).
 */
function isValidSpanContext(
  spanContext: SpanContext | undefined,
): spanContext is SpanContext {
  return !!(
    spanContext &&
    spanContext.traceId &&
    spanContext.spanId &&
    trace.isSpanContextValid(spanContext)
  );
}

/**
 * Create a processing span for Kafka message handling.
 *
 * **Context Mode Behavior:**
 *
 * | Mode | Active Span Exists | No Active Span |
 * |------|-------------------|----------------|
 * | `inherit` | Parent = active span. Link to extracted if different trace. | Parent = extracted context |
 * | `link` | Parent = active span. Link to extracted context. | Parent = root. Link to extracted. |
 * | `none` | Parent = active span. No links. | Parent = root. No links. |
 *
 * @param descriptor - Processing span configuration
 * @param fn - Async callback to execute within the span
 * @returns AsyncResult with callback result or SpanError
 *
 * @example Basic usage
 * ```typescript
 * import { withProcessingSpan } from 'autotel-plugins/kafka';
 *
 * await consumer.run({
 *   eachMessage: async ({ topic, partition, message }) => {
 *     const result = await withProcessingSpan({
 *       name: 'order.process',
 *       headers: message.headers,
 *       contextMode: 'inherit',
 *       topic,
 *       consumerGroup: 'payments',
 *       partition,
 *       offset: message.offset,
 *     }, async (span) => {
 *       return await processOrder(message);
 *     });
 *
 *     if (!result.ok) {
 *       logger.error('Processing failed', { error: result.error });
 *     }
 *   },
 * });
 * ```
 *
 * @example With batch lineage links
 * ```typescript
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
 *   await processSettlement(batch);
 * });
 * ```
 */
export async function withProcessingSpan<T>(
  descriptor: ProcessingDescriptor,
  fn: ProcessingSpanCallback<T>,
): AsyncResult<T, SpanError> {
  const {
    name,
    headers,
    contextMode = 'inherit',
    links = [],
    topic,
    consumerGroup,
    partition,
    offset,
    key,
  } = descriptor;

  try {
    const tracer = trace.getTracer(DEFAULT_TRACER_NAME);
    const normalizedHeaders = normalizeHeaders(headers);
    const extractedCtx = extractTraceContext(normalizedHeaders);
    const extractedSpanContext = trace.getSpanContext(extractedCtx);

    // Determine parent context and links based on context mode
    const { parentContext, spanLinks } = resolveContextAndLinks(
      contextMode,
      extractedSpanContext,
      links,
    );

    // Create span with computed parent and links
    const span = tracer.startSpan(
      name,
      {
        kind: SpanKind.CONSUMER,
        links: spanLinks,
      },
      parentContext,
    );

    // Set messaging attributes
    setMessagingAttributes(span, {
      topic,
      consumerGroup,
      partition,
      offset,
      key,
    });

    // Execute callback within span context
    const spanContext = trace.setSpan(context.active(), span);

    try {
      const result = await context.with(spanContext, async () => {
        return await fn(span);
      });

      span.setStatus({ code: SpanStatusCode.OK });
      span.end();

      return ok(result);
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      if (error instanceof Error) {
        span.recordException(error);
      } else {
        span.recordException(new Error(String(error)));
      }
      span.end();

      return err({ type: 'CALLBACK_ERROR', cause: error });
    }
  } catch (error) {
    return err({ type: 'SPAN_CREATION_FAILED', cause: error });
  }
}

/**
 * Resolve parent context and links based on context mode.
 */
function resolveContextAndLinks(
  contextMode: ContextMode,
  extractedSpanContext: SpanContext | undefined,
  additionalLinks: SpanLink[],
): {
  parentContext: typeof context extends { active(): infer T } ? T : never;
  spanLinks: SpanLink[];
} {
  const activeSpan = trace.getActiveSpan();
  const activeContext = context.active();
  const hasActiveSpan = activeSpan !== undefined;
  const hasValidExtracted = isValidSpanContext(extractedSpanContext);

  const spanLinks: SpanLink[] = [...additionalLinks];

  switch (contextMode) {
    case 'inherit': {
      if (hasActiveSpan) {
        // Parent = active span
        // Link to extracted if different trace
        if (hasValidExtracted) {
          const activeSpanContext = activeSpan.spanContext();
          if (activeSpanContext.traceId !== extractedSpanContext.traceId) {
            spanLinks.push({ context: extractedSpanContext });
          }
        }
        return { parentContext: activeContext, spanLinks };
      } else {
        // No active span: parent = extracted context
        if (hasValidExtracted) {
          const extractedParentCtx = trace.setSpanContext(
            activeContext,
            extractedSpanContext,
          );
          return { parentContext: extractedParentCtx, spanLinks };
        }
        // No extracted context either: root span
        return { parentContext: activeContext, spanLinks };
      }
    }

    case 'link': {
      // Always parent to current context (active span or root)
      // Always link to extracted if valid
      if (hasValidExtracted) {
        spanLinks.push({ context: extractedSpanContext });
      }
      return { parentContext: activeContext, spanLinks };
    }

    case 'none': {
      // Parent to current context, no links to extracted
      return { parentContext: activeContext, spanLinks };
    }

    default: {
      // TypeScript exhaustive check
      const exhaustive: never = contextMode;
      throw new Error(`Unknown context mode: ${exhaustive}`);
    }
  }
}

/**
 * Set standard messaging attributes on a span.
 */
function setMessagingAttributes(
  span: Span,
  attrs: {
    topic?: string;
    consumerGroup?: string;
    partition?: number;
    offset?: string;
    key?: string;
  },
): void {
  const { topic, consumerGroup, partition, offset, key } = attrs;

  if (topic) {
    span.setAttribute(SEMATTRS_MESSAGING_SYSTEM, 'kafka');
    span.setAttribute(SEMATTRS_MESSAGING_DESTINATION_NAME, topic);
  }

  if (consumerGroup) {
    span.setAttribute(SEMATTRS_MESSAGING_KAFKA_CONSUMER_GROUP, consumerGroup);
  }

  if (partition !== undefined) {
    span.setAttribute(SEMATTRS_MESSAGING_KAFKA_PARTITION, partition);
  }

  if (offset !== undefined) {
    span.setAttribute(SEMATTRS_MESSAGING_KAFKA_OFFSET, offset);
  }

  if (key !== undefined) {
    span.setAttribute(SEMATTRS_MESSAGING_KAFKA_MESSAGE_KEY, key);
  }
}
