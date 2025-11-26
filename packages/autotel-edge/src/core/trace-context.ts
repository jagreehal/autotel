/**
 * Trace context types and utilities
 */

import type { AttributeValue, Span, SpanStatusCode } from '@opentelemetry/api';

/**
 * WeakMap to store span names for active spans.
 * Enables retrieving span names for correlation helpers.
 */
const spanNameMap = new WeakMap<Span, string>();

/**
 * Base trace context containing trace identifiers
 */
export interface TraceContextBase {
  traceId: string;
  spanId: string;
  correlationId: string;
  'code.function'?: string;
}

/**
 * Span methods available on trace context
 */
export interface SpanMethods {
  setAttribute(key: string, value: AttributeValue): void;
  setAttributes(attrs: Record<string, AttributeValue>): void;
  setStatus(status: { code: SpanStatusCode; message?: string }): void;
  recordException(exception: Error): void;
}

/**
 * Complete trace context that merges base context and span methods
 *
 * This is the ctx parameter passed to factory functions in trace().
 * It provides access to trace IDs and span manipulation methods.
 */
export type TraceContext = TraceContextBase & SpanMethods;

/**
 * Create a TraceContext from an OpenTelemetry Span
 *
 * This utility extracts trace context information from a span
 * and provides span manipulation methods in a consistent format.
 */
export function createTraceContext(span: Span): TraceContext {
  const spanContext = span.spanContext();
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    correlationId: spanContext.traceId.slice(0, 16),
    'code.function': spanNameMap.get(span),
    setAttribute: span.setAttribute.bind(span),
    setAttributes: span.setAttributes.bind(span),
    setStatus: span.setStatus.bind(span),
    recordException: span.recordException.bind(span),
  };
}

/**
 * Store the span name for later retrieval via trace context helpers.
 */
export function setSpanName(span: Span, name: string): void {
  spanNameMap.set(span, name);
}
