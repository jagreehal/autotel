/**
 * Processing span wrapper for RabbitMQ message handling.
 *
 * Creates processing spans with proper context handling, supporting:
 * - Context mode control (inherit/link/none)
 * - Messaging attributes for consistent querying
 * - Integration with official amqplib instrumentation
 * - Deferred ack tracking mode
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
import type {
  ConsumeDescriptor,
  ContextMode,
  ConsumeSpanCallback,
  DeferredConsumeSpanCallback,
  AckControls,
} from './types';
import { normalizeHeaders, extractTraceContext } from './headers';
import {
  SEMATTRS_MESSAGING_SYSTEM,
  SEMATTRS_MESSAGING_DESTINATION_NAME,
  SEMATTRS_MESSAGING_OPERATION_NAME,
  SEMATTRS_MESSAGING_RABBITMQ_DESTINATION_EXCHANGE,
  SEMATTRS_MESSAGING_RABBITMQ_DESTINATION_ROUTING_KEY,
  SEMATTRS_MESSAGING_MESSAGE_ID,
  SEMATTRS_MESSAGING_MESSAGE_CONVERSATION_ID,
  SEMATTRS_MESSAGING_CONSUMER_ID,
  SEMATTRS_MESSAGING_RABBITMQ_ACK_RESULT,
  SEMATTRS_MESSAGING_RABBITMQ_REQUEUE,
} from '../common/constants';

const DEFAULT_TRACER_NAME = 'autotel-plugins/rabbitmq';

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
 * Validate configuration for deferred span mode.
 */
function validateDeferredConfig(descriptor: ConsumeDescriptor): void {
  if (descriptor.deferSpanEnd && !descriptor.ackTimeoutMs) {
    throw new Error('deferSpanEnd requires ackTimeoutMs to be set');
  }
}

/**
 * Create a consume/processing span for RabbitMQ message handling.
 *
 * **Context Mode Behavior:**
 *
 * | Mode | Behavior |
 * |------|----------|
 * | `inherit` | Extracted remote context becomes the **parent**. If headers contain context, it overrides any active span. |
 * | `link` | Consumer span parents to current active context (or root). Extracted context becomes a **SpanLink**. |
 * | `none` | Ignore extracted context entirely. Consumer span uses current active context (or root). No links created. |
 *
 * @param descriptor - Processing span configuration
 * @param fn - Async callback to execute within the span
 * @returns Promise resolving to callback result
 * @throws Error if span creation fails or callback throws
 *
 * @example Basic usage
 * ```typescript
 * import { withConsumeSpan } from 'autotel-plugins/rabbitmq';
 *
 * channel.consume('queue', async (msg) => {
 *   if (!msg) return;
 *   try {
 *     await withConsumeSpan({
 *       name: 'order.process',
 *       headers: msg.properties.headers,
 *       contextMode: 'inherit',
 *       queue: 'orders',
 *       exchange: 'orders-exchange',
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
 * @example With deferred ack tracking
 * ```typescript
 * await withConsumeSpan({
 *   name: 'order.process',
 *   headers: msg.properties.headers,
 *   deferSpanEnd: true,
 *   ackTimeoutMs: 60000,
 * }, async (span, controls) => {
 *   await processOrder(msg);
 *   controls.ack();  // Ends span with success
 * });
 * ```
 */
export function withConsumeSpan<T>(
  descriptor: ConsumeDescriptor & { deferSpanEnd: true; ackTimeoutMs: number },
  fn: DeferredConsumeSpanCallback<T>,
): Promise<T>;
export function withConsumeSpan<T>(
  descriptor: ConsumeDescriptor & { deferSpanEnd?: false },
  fn: ConsumeSpanCallback<T>,
): Promise<T>;
export function withConsumeSpan<T>(
  descriptor: ConsumeDescriptor,
  fn: ConsumeSpanCallback<T> | DeferredConsumeSpanCallback<T>,
): Promise<T>;
export async function withConsumeSpan<T>(
  descriptor: ConsumeDescriptor,
  fn: ConsumeSpanCallback<T> | DeferredConsumeSpanCallback<T>,
): Promise<T> {
  validateDeferredConfig(descriptor);

  const {
    name,
    headers,
    contextMode = 'inherit',
    links = [],
    queue,
    exchange,
    routingKey,
    messageId,
    correlationId,
    consumerTag,
    deferSpanEnd = false,
    ackTimeoutMs,
  } = descriptor;

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
    queue,
    exchange,
    routingKey,
    messageId,
    correlationId,
    consumerTag,
  });

  // Execute callback within span context
  const spanContext = trace.setSpan(context.active(), span);

  if (deferSpanEnd) {
    return executeDeferredMode(
      span,
      spanContext,
      fn as DeferredConsumeSpanCallback<T>,
      ackTimeoutMs!,
    );
  }

  return executeImmediateMode(span, spanContext, fn as ConsumeSpanCallback<T>);
}

/**
 * Execute callback in immediate mode - span ends when callback completes.
 */
async function executeImmediateMode<T>(
  span: Span,
  spanContext: ReturnType<typeof context.active>,
  fn: ConsumeSpanCallback<T>,
): Promise<T> {
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

/**
 * Execute callback in deferred mode - span ends when ack/nack/reject is called.
 */
async function executeDeferredMode<T>(
  span: Span,
  spanContext: ReturnType<typeof context.active>,
  fn: DeferredConsumeSpanCallback<T>,
  ackTimeoutMs: number,
): Promise<T> {
  let spanEnded = false;

  // Create a reference object to hold the timeout ID
  const timeoutRef: { id?: ReturnType<typeof setTimeout> } = {};

  const endSpan = (
    status: 'ok' | 'error',
    outcome?: 'ack' | 'nack' | 'reject',
    requeue?: boolean,
  ) => {
    if (spanEnded) return;
    spanEnded = true;

    if (timeoutRef.id) {
      clearTimeout(timeoutRef.id);
    }

    if (outcome) {
      span.setAttribute(SEMATTRS_MESSAGING_RABBITMQ_ACK_RESULT, outcome);
    }
    if (requeue !== undefined) {
      span.setAttribute(SEMATTRS_MESSAGING_RABBITMQ_REQUEUE, requeue);
    }

    span.setStatus({
      code: status === 'ok' ? SpanStatusCode.OK : SpanStatusCode.ERROR,
    });
    span.end();
  };

  const controls: AckControls = {
    ack() {
      endSpan('ok', 'ack');
    },
    nack(options?: { requeue?: boolean }) {
      endSpan('ok', 'nack', options?.requeue ?? true);
    },
    reject(options?: { requeue?: boolean }) {
      endSpan('ok', 'reject', options?.requeue ?? false);
    },
  };

  // Set up timeout
  timeoutRef.id = setTimeout(() => {
    if (!spanEnded) {
      span.setAttribute('messaging.rabbitmq.ack_timeout', true);
      endSpan('error');
    }
  }, ackTimeoutMs);

  try {
    const result = await context.with(spanContext, async () => {
      return await fn(span, controls);
    });

    // If span wasn't ended by controls, end it now with OK
    if (!spanEnded) {
      endSpan('ok');
    }

    return result;
  } catch (error) {
    if (!spanEnded) {
      if (error instanceof Error) {
        span.recordException(error);
      } else {
        span.recordException(new Error(String(error)));
      }
      endSpan('error');
    }

    throw error;
  }
}

/**
 * Resolve parent context and links based on context mode.
 *
 * RabbitMQ context mode differs from Kafka:
 * - `inherit` mode always uses extracted context as parent (messaging continues producer trace)
 * - This matches the expectation that RabbitMQ messages carry trace context
 */
function resolveContextAndLinks(
  contextMode: ContextMode,
  extractedSpanContext: SpanContext | undefined,
  additionalLinks: SpanLink[],
): {
  parentContext: ReturnType<typeof context.active>;
  spanLinks: SpanLink[];
} {
  const activeContext = context.active();
  const hasValidExtracted = isValidSpanContext(extractedSpanContext);

  const spanLinks: SpanLink[] = [...additionalLinks];

  switch (contextMode) {
    case 'inherit': {
      // In inherit mode, extracted context always wins as parent
      // This is the key difference from Kafka - messaging should continue producer trace
      if (hasValidExtracted) {
        const extractedParentCtx = trace.setSpanContext(
          activeContext,
          extractedSpanContext,
        );
        return { parentContext: extractedParentCtx, spanLinks };
      }
      // No extracted context: use current active context
      return { parentContext: activeContext, spanLinks };
    }

    case 'link': {
      // Parent to current context (active span or root)
      // Link to extracted if valid
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
 * Set standard RabbitMQ messaging attributes on a span.
 */
function setMessagingAttributes(
  span: Span,
  attrs: {
    queue?: string;
    exchange?: string;
    routingKey?: string;
    messageId?: string;
    correlationId?: string;
    consumerTag?: string;
  },
): void {
  const { queue, exchange, routingKey, messageId, correlationId, consumerTag } =
    attrs;

  span.setAttribute(SEMATTRS_MESSAGING_SYSTEM, 'rabbitmq');
  span.setAttribute(SEMATTRS_MESSAGING_OPERATION_NAME, 'receive');

  if (queue) {
    span.setAttribute(SEMATTRS_MESSAGING_DESTINATION_NAME, queue);
  }

  if (exchange) {
    span.setAttribute(
      SEMATTRS_MESSAGING_RABBITMQ_DESTINATION_EXCHANGE,
      exchange,
    );
  }

  if (routingKey) {
    span.setAttribute(
      SEMATTRS_MESSAGING_RABBITMQ_DESTINATION_ROUTING_KEY,
      routingKey,
    );
  }

  if (messageId) {
    span.setAttribute(SEMATTRS_MESSAGING_MESSAGE_ID, messageId);
  }

  if (correlationId) {
    span.setAttribute(
      SEMATTRS_MESSAGING_MESSAGE_CONVERSATION_ID,
      correlationId,
    );
  }

  if (consumerTag) {
    span.setAttribute(SEMATTRS_MESSAGING_CONSUMER_ID, consumerTag);
  }
}
