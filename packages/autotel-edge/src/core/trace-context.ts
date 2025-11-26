/**
 * Trace context types and utilities
 */

import type {
  AttributeValue,
  Link,
  Span,
  SpanStatusCode,
  TimeInput,
} from '@opentelemetry/api';

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
  /** Set a single attribute on the span */
  setAttribute(key: string, value: AttributeValue): void;
  /** Set multiple attributes on the span */
  setAttributes(attrs: Record<string, AttributeValue>): void;
  /** Set the status of the span */
  setStatus(status: { code: SpanStatusCode; message?: string }): void;
  /** Record an exception on the span */
  recordException(exception: Error, time?: TimeInput): void;
  /** Add an event to the span (for logging milestones/checkpoints) */
  addEvent(
    name: string,
    attributesOrStartTime?: Record<string, AttributeValue> | TimeInput,
    startTime?: TimeInput,
  ): void;
  /** Add a link to another span */
  addLink(link: Link): void;
  /** Add multiple links to other spans */
  addLinks(links: Link[]): void;
  /** Update the span name dynamically */
  updateName(name: string): void;
  /** Check if the span is recording */
  isRecording(): boolean;
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
    addEvent: span.addEvent.bind(span),
    addLink: span.addLink.bind(span),
    addLinks: span.addLinks.bind(span),
    updateName: span.updateName.bind(span),
    isRecording: span.isRecording.bind(span),
  };
}

/**
 * Store the span name for later retrieval via trace context helpers.
 */
export function setSpanName(span: Span, name: string): void {
  spanNameMap.set(span, name);
}
