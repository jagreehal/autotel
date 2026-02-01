/**
 * Stream events instrumentation for Kafka consumers.
 *
 * Provides visibility into consumer lifecycle events like rebalances,
 * errors, and heartbeats. Defaults to events mode (not spans) to
 * avoid span explosion.
 *
 * @example
 * ```typescript
 * import { instrumentConsumerEvents } from 'autotel-plugins/kafka';
 *
 * instrumentConsumerEvents(consumer, {
 *   mode: 'events',
 *   traceRebalances: true,
 *   traceErrors: true,
 *   traceHeartbeats: false,
 * });
 * ```
 */

import {
  otelTrace as trace,
  SpanKind,
  SpanStatusCode,
  type Span,
} from 'autotel';

const DEFAULT_TRACER_NAME = 'autotel-plugins/kafka';

/**
 * Event mode for consumer events.
 * - 'events': Attach events to existing lifecycle span (lower overhead)
 * - 'spans': Create separate spans for each event (more detail)
 */
export type EventMode = 'events' | 'spans';

/**
 * Minimal Kafka consumer interface for event instrumentation.
 */
export interface EventConsumer {
  on(event: string, listener: (...args: unknown[]) => void): void;
  off?(event: string, listener: (...args: unknown[]) => void): void;
}

/**
 * Configuration for consumer event instrumentation.
 */
export interface ConsumerEventsConfig {
  /**
   * Event mode: 'events' attaches to spans, 'spans' creates new spans.
   * @default 'events'
   */
  mode?: EventMode;

  /**
   * Trace rebalance events (GROUP_JOIN, REBALANCING).
   * @default true
   */
  traceRebalances?: boolean;

  /**
   * Trace error events (CRASH, DISCONNECT).
   * @default true
   */
  traceErrors?: boolean;

  /**
   * Trace heartbeat events.
   * @default false (too noisy for most use cases)
   */
  traceHeartbeats?: boolean;

  /**
   * Optional lifecycle span to attach events to.
   * Only used when mode is 'events'.
   */
  lifecycleSpan?: Span;
}

/**
 * Cleanup function returned by instrumentConsumerEvents.
 */
export type CleanupFunction = () => void;

/**
 * KafkaJS event types we're interested in.
 */
const REBALANCE_EVENTS = [
  'consumer.group_join',
  'consumer.rebalancing',
  'consumer.stop',
] as const;

const ERROR_EVENTS = [
  'consumer.crash',
  'consumer.disconnect',
  'consumer.network.request_timeout',
] as const;

const HEARTBEAT_EVENTS = ['consumer.heartbeat'] as const;

/**
 * Instrument a Kafka consumer's lifecycle events.
 *
 * Returns a cleanup function to remove event listeners.
 *
 * @param consumer - Kafka consumer to instrument
 * @param config - Instrumentation configuration
 * @returns Cleanup function
 *
 * @example
 * ```typescript
 * const cleanup = instrumentConsumerEvents(consumer, {
 *   mode: 'events',
 *   traceRebalances: true,
 *   traceErrors: true,
 * });
 *
 * // Later, to clean up:
 * cleanup();
 * ```
 */
export function instrumentConsumerEvents(
  consumer: EventConsumer,
  config: ConsumerEventsConfig = {},
): CleanupFunction {
  const {
    mode = 'events',
    traceRebalances = true,
    traceErrors = true,
    traceHeartbeats = false,
    lifecycleSpan,
  } = config;

  const tracer = trace.getTracer(DEFAULT_TRACER_NAME);
  const listeners: Array<{
    event: string;
    listener: (...args: unknown[]) => void;
  }> = [];

  // Helper to add a listener and track it
  const addListener = (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => {
    consumer.on(event, listener);
    listeners.push({ event, listener });
  };

  // Rebalance events
  if (traceRebalances) {
    for (const event of REBALANCE_EVENTS) {
      addListener(event, (payload: unknown) => {
        if (mode === 'spans') {
          createEventSpan(tracer, event, payload);
        } else if (lifecycleSpan) {
          lifecycleSpan.addEvent(event, extractEventAttributes(payload));
        }
      });
    }
  }

  // Error events
  if (traceErrors) {
    for (const event of ERROR_EVENTS) {
      addListener(event, (payload: unknown) => {
        if (mode === 'spans') {
          createErrorSpan(tracer, event, payload);
        } else if (lifecycleSpan) {
          lifecycleSpan.addEvent(event, {
            ...extractEventAttributes(payload),
            'event.severity': 'error',
          });

          // Also record exception if it's a crash
          if (event === 'consumer.crash' && isErrorPayload(payload)) {
            lifecycleSpan.recordException(payload.error);
          }
        }
      });
    }
  }

  // Heartbeat events
  if (traceHeartbeats) {
    for (const event of HEARTBEAT_EVENTS) {
      addListener(event, (payload: unknown) => {
        if (mode === 'spans') {
          createEventSpan(tracer, event, payload);
        } else if (lifecycleSpan) {
          lifecycleSpan.addEvent(event, extractEventAttributes(payload));
        }
      });
    }
  }

  // Return cleanup function
  return () => {
    if (consumer.off) {
      for (const { event, listener } of listeners) {
        consumer.off(event, listener);
      }
    }
    listeners.length = 0;
  };
}

/**
 * Create a span for a consumer event.
 */
function createEventSpan(
  tracer: ReturnType<typeof trace.getTracer>,
  eventName: string,
  payload: unknown,
): void {
  const span = tracer.startSpan(`kafka.consumer.${eventName}`, {
    kind: SpanKind.INTERNAL,
  });

  const attributes = extractEventAttributes(payload);
  for (const [key, value] of Object.entries(attributes)) {
    span.setAttribute(key, value);
  }

  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

/**
 * Create an error span for a consumer error event.
 */
function createErrorSpan(
  tracer: ReturnType<typeof trace.getTracer>,
  eventName: string,
  payload: unknown,
): void {
  const span = tracer.startSpan(`kafka.consumer.${eventName}`, {
    kind: SpanKind.INTERNAL,
  });

  const attributes = extractEventAttributes(payload);
  for (const [key, value] of Object.entries(attributes)) {
    span.setAttribute(key, value);
  }

  span.setStatus({ code: SpanStatusCode.ERROR });

  if (isErrorPayload(payload)) {
    span.recordException(payload.error);
  }

  span.end();
}

/**
 * Extract attributes from event payload.
 */
function extractEventAttributes(
  payload: unknown,
): Record<string, string | number | boolean> {
  const attributes: Record<string, string | number | boolean> = {};

  if (!payload || typeof payload !== 'object') {
    return attributes;
  }

  const p = payload as Record<string, unknown>;

  if (typeof p.groupId === 'string') {
    attributes['messaging.kafka.consumer.group'] = p.groupId;
  }

  if (typeof p.memberId === 'string') {
    attributes['messaging.kafka.consumer.member_id'] = p.memberId;
  }

  if (typeof p.leaderId === 'string') {
    attributes['messaging.kafka.consumer.leader_id'] = p.leaderId;
  }

  if (typeof p.duration === 'number') {
    attributes['event.duration_ms'] = p.duration;
  }

  if (typeof p.isLeader === 'boolean') {
    attributes['messaging.kafka.consumer.is_leader'] = p.isLeader;
  }

  if (Array.isArray(p.memberAssignment)) {
    attributes['messaging.kafka.consumer.assignment_count'] =
      p.memberAssignment.length;
  }

  if (typeof p.type === 'string') {
    attributes['event.type'] = p.type;
  }

  return attributes;
}

/**
 * Type guard for error payloads.
 */
function isErrorPayload(payload: unknown): payload is { error: Error } {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    'error' in payload &&
    payload.error instanceof Error
  );
}
