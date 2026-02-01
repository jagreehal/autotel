/**
 * RabbitMQ plugin types - Processing spans, ack tracking, and correlation
 *
 * This plugin provides a composition layer for RabbitMQ observability,
 * working alongside @opentelemetry/instrumentation-amqplib.
 */

import type { Span, SpanContext, SpanLink } from 'autotel';

/**
 * Raw AMQP headers as provided by amqplib.
 * Values can be string, Buffer, number, boolean, or undefined.
 */
export type RawAmqpHeaders =
  | Record<string, string | Buffer | number | boolean | object | undefined>
  | undefined;

/**
 * Context mode for processing spans.
 *
 * Controls how the processing span relates to extracted remote context:
 *
 * - `inherit`: Extracted remote context becomes the **parent** of consumer span.
 *   If headers contain context, it overrides any active span (messaging receive
 *   continues producer trace).
 * - `link`: Consumer span parents to current active context (or root). Extracted
 *   context becomes a **SpanLink**. Baggage is propagated into span attributes.
 * - `none`: Ignore extracted context entirely. Consumer span uses current active
 *   context (or root). No links created.
 *
 * @remarks
 * In `inherit` mode, if both active span exists AND headers contain context,
 * extracted context wins as parent (messaging should continue producer trace).
 */
export type ContextMode = 'inherit' | 'link' | 'none';

/**
 * Ack outcome for tracking message acknowledgment results.
 */
export type AckOutcome = 'ack' | 'nack' | 'reject';

/**
 * Controls for deferred ack tracking mode.
 */
export interface AckControls {
  /**
   * Acknowledge the message successfully. Ends the span with success.
   */
  ack(): void;

  /**
   * Negative acknowledge the message. Ends the span with the nack outcome.
   * @param options - Options for nack behavior
   */
  nack(options?: { requeue?: boolean }): void;

  /**
   * Reject the message. Ends the span with the reject outcome.
   * @param options - Options for reject behavior
   */
  reject(options?: { requeue?: boolean }): void;
}

/**
 * Descriptor for creating a consume/processing span.
 */
export interface ConsumeDescriptor {
  /**
   * Name for the processing span (e.g., "order.process")
   */
  name: string;

  /**
   * AMQP message headers for context extraction.
   */
  headers: RawAmqpHeaders;

  /**
   * Context mode for relating to extracted remote context.
   * @default 'inherit'
   */
  contextMode?: ContextMode;

  /**
   * Additional span links to include.
   */
  links?: SpanLink[];

  /**
   * Queue name. Sets `messaging.destination.name` attribute.
   */
  queue?: string;

  /**
   * Source exchange name. Sets `messaging.rabbitmq.destination.exchange` attribute.
   */
  exchange?: string;

  /**
   * Routing key. Sets `messaging.rabbitmq.destination.routing_key` attribute.
   */
  routingKey?: string;

  /**
   * AMQP message ID. Sets `messaging.message.id` attribute.
   */
  messageId?: string;

  /**
   * AMQP correlation ID. Sets `messaging.message.conversation_id` attribute.
   */
  correlationId?: string;

  /**
   * Consumer tag. Sets `messaging.consumer.id` attribute.
   */
  consumerTag?: string;

  /**
   * Defer span end until ack/nack/reject is called.
   * When true, the callback receives AckControls and span ends when one is called.
   * @default false
   */
  deferSpanEnd?: boolean;

  /**
   * Timeout in milliseconds for deferred span end.
   * Required when `deferSpanEnd` is true.
   */
  ackTimeoutMs?: number;
}

/**
 * Descriptor for creating a publish span.
 */
export interface PublishDescriptor {
  /**
   * Name for the publish span (e.g., "order.publish")
   */
  name: string;

  /**
   * Exchange name. Sets `messaging.destination.name` attribute.
   * Defaults to 'amq.default' for default exchange.
   */
  exchange?: string;

  /**
   * Routing key. Sets `messaging.rabbitmq.destination.routing_key` attribute.
   */
  routingKey: string;

  /**
   * AMQP message ID. Sets `messaging.message.id` attribute.
   */
  messageId?: string;

  /**
   * AMQP correlation ID. Sets `messaging.message.conversation_id` attribute.
   */
  correlationId?: string;

  /**
   * Messaging system. Defaults to 'rabbitmq'.
   */
  system?: string;
}

/**
 * Options for injecting trace headers.
 */
export interface InjectOptions {
  /**
   * Explicit correlation ID to use. If not provided, derives from current context.
   */
  correlationId?: string;

  /**
   * Whether to include x-correlation-id header.
   * @default true
   */
  includeCorrelationIdHeader?: boolean;
}

/**
 * Options for batch lineage extraction.
 */
export interface BatchLineageOptions {
  /**
   * Include raw trace IDs in the result.
   * @default false (privacy consideration)
   */
  includeTraceIds?: boolean;

  /**
   * Maximum number of links to include.
   * @default 128
   */
  maxLinks?: number;
}

/**
 * Result of batch lineage extraction.
 */
export interface BatchLineageResult {
  /**
   * Count of unique, linked trace IDs.
   */
  linked_trace_id_count: number;

  /**
   * Hash of sorted trace IDs (16 hex chars, 64-bit).
   * Useful for comparing batches without exposing individual trace IDs.
   */
  linked_trace_id_hash: string;

  /**
   * Raw trace IDs, only if includeTraceIds was true.
   */
  trace_ids?: string[];

  /**
   * Valid SpanLinks from extracted contexts (capped at maxLinks).
   */
  links: SpanLink[];
}

/**
 * Type for the consume span callback function without deferred ack.
 */
export type ConsumeSpanCallback<T> = (span: Span) => Promise<T>;

/**
 * Type for the consume span callback function with deferred ack controls.
 */
export type DeferredConsumeSpanCallback<T> = (
  span: Span,
  controls: AckControls,
) => Promise<T>;

/**
 * Type for the publish span callback function.
 */
export type PublishSpanCallback<T> = (span: Span) => Promise<T>;

/**
 * Item with optional headers for batch lineage extraction.
 */
export interface BatchItem {
  headers?: RawAmqpHeaders;
}

/**
 * Internal type for extracted span context with trace ID for deduplication.
 */
export interface ExtractedContext {
  traceId: string;
  spanContext: SpanContext;
}
