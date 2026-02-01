/**
 * Kafka plugin types - Processing spans, batch lineage, and correlation
 *
 * This plugin provides a composition layer for Kafka observability,
 * working alongside @opentelemetry/instrumentation-kafkajs.
 */

import type { Span, SpanContext, SpanLink } from 'autotel';

/**
 * Raw Kafka headers as provided by KafkaJS.
 * Values can be string, Buffer, or undefined.
 * Also accepts Map for compatibility with @platformatic/kafka and other clients.
 */
export type RawKafkaHeaders =
  | Record<string, string | Buffer | undefined>
  | Map<string, string | Buffer | undefined>
  | undefined;

/**
 * Context mode for processing spans.
 *
 * Controls how the processing span relates to extracted remote context:
 *
 * - `inherit` (default): If active span exists, parent = active span, link to extracted if different trace.
 *   If no active span, parent = extracted context.
 * - `link`: Always parent to current context (active span or root). Link to extracted context.
 * - `none`: Parent to current context. No links to extracted context.
 *
 * This prevents "surprising re-parenting" when auto-instrumentation is enabled.
 */
export type ContextMode = 'inherit' | 'link' | 'none';

/**
 * Descriptor for creating a processing span.
 */
export interface ProcessingDescriptor {
  /**
   * Name for the processing span (e.g., "order.process")
   */
  name: string;

  /**
   * Kafka message headers for context extraction.
   * Use normalizeHeaders() to convert from RawKafkaHeaders.
   */
  headers: RawKafkaHeaders;

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
   * Kafka topic name. Sets `messaging.destination.name` attribute.
   */
  topic?: string;

  /**
   * Consumer group name. Sets `messaging.kafka.consumer.group` attribute.
   */
  consumerGroup?: string;

  /**
   * Kafka partition number. Sets `messaging.kafka.partition` attribute.
   */
  partition?: number;

  /**
   * Message offset. Sets `messaging.kafka.offset` attribute.
   */
  offset?: string;

  /**
   * Message key. Sets `messaging.kafka.message.key` attribute.
   */
  key?: string;
}

/**
 * Descriptor for creating a producer span.
 */
export interface ProducerDescriptor {
  /**
   * Name for the producer span (e.g., "order.publish")
   */
  name: string;

  /**
   * Kafka topic name. Sets `messaging.destination.name` attribute.
   */
  topic: string;

  /**
   * Message key. Sets `messaging.kafka.message.key` attribute.
   */
  messageKey?: string;

  /**
   * Messaging system. Defaults to 'kafka'.
   */
  system?: string;
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
   * SHA-256 hash of sorted trace IDs (16 hex chars, 64-bit).
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
 * Options for injecting trace headers.
 *
 * Note: Baggage injection is controlled by your OTel propagator configuration.
 * If W3CBaggagePropagator is registered, baggage will be injected automatically.
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
 * Type for the processing span callback function.
 */
export type ProcessingSpanCallback<T> = (span: Span) => Promise<T>;

/**
 * Type for the producer span callback function.
 */
export type ProducerSpanCallback<T> = (span: Span) => Promise<T>;

/**
 * Item with optional headers for batch lineage extraction.
 */
export interface BatchItem {
  headers?: RawKafkaHeaders;
}

/**
 * Internal type for extracted span context with trace ID for deduplication.
 */
export interface ExtractedContext {
  traceId: string;
  spanContext: SpanContext;
}
