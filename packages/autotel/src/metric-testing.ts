/**
 * Testing utilities for Metrics
 *
 * Provides in-memory collection of metrics for testing purposes.
 */

import type {
  EventAttributes,
  FunnelStatus,
  OutcomeStatus,
} from './event-subscriber';

export interface MetricsEvent {
  event: string;
  attributes?: EventAttributes;
  service: string;
  timestamp: number;
}

export interface MetricsFunnelStep {
  funnel: string;
  status: FunnelStatus;
  attributes?: EventAttributes;
  service: string;
  timestamp: number;
}

export interface MetricsOutcome {
  operation: string;
  status: OutcomeStatus;
  attributes?: EventAttributes;
  service: string;
  timestamp: number;
}

export interface MetricsValue {
  metric: string;
  value: number;
  attributes?: EventAttributes;
  service: string;
  timestamp: number;
}

/**
 * In-memory metrics collector for testing
 */
export interface MetricsCollector {
  /** Get all collected events */
  getEvents(): MetricsEvent[];
  /** Get all collected funnel steps */
  getFunnelSteps(): MetricsFunnelStep[];
  /** Get all collected outcomes */
  getOutcomes(): MetricsOutcome[];
  /** Get all collected values */
  getValues(): MetricsValue[];
  /** Clear all collected metrics */
  clear(): void;
  /** Record an event (internal use) */
  recordEvent(event: MetricsEvent): void;
  /** Record a funnel step (internal use) */
  recordFunnelStep(step: MetricsFunnelStep): void;
  /** Record an outcome (internal use) */
  recordOutcome(outcome: MetricsOutcome): void;
  /** Record a value (internal use) */
  recordValue(value: MetricsValue): void;
}

/**
 * Create an in-memory metrics collector for testing
 *
 * @example
 * ```typescript
 * const collector = createMetricsCollector()
 *
 * const metrics = new Metric('test-service', { collector })
 * metrics.trackEvent('order.completed', { orderId: '123' })
 *
 * const event =collector.getEvents()
 * expect(events).toHaveLength(1)
 * expect(events[0].event).toBe('order.completed')
 * ```
 */
export function createMetricsCollector(): MetricsCollector {
  const events: MetricsEvent[] = [];
  const funnelSteps: MetricsFunnelStep[] = [];
  const outcomes: MetricsOutcome[] = [];
  const values: MetricsValue[] = [];

  return {
    getEvents(): MetricsEvent[] {
      return [...events];
    },

    getFunnelSteps(): MetricsFunnelStep[] {
      return [...funnelSteps];
    },

    getOutcomes(): MetricsOutcome[] {
      return [...outcomes];
    },

    getValues(): MetricsValue[] {
      return [...values];
    },

    clear(): void {
      events.length = 0;
      funnelSteps.length = 0;
      outcomes.length = 0;
      values.length = 0;
    },

    recordEvent(event: MetricsEvent): void {
      events.push(event);
    },

    recordFunnelStep(step: MetricsFunnelStep): void {
      funnelSteps.push(step);
    },

    recordOutcome(outcome: MetricsOutcome): void {
      outcomes.push(outcome);
    },

    recordValue(value: MetricsValue): void {
      values.push(value);
    },
  };
}

/**
 * Assert that a metric event was tracked
 *
 * @example
 * ```typescript
 * assertEventTracked({
 *   collector,
 *   eventName: 'order.completed',
 *   attributes: { orderId: '123' }
 * })
 * ```
 */
export function assertEventTracked(options: {
  collector: MetricsCollector;
  eventName: string;
  attributes?: Record<string, unknown>;
}): void {
  const events = options.collector.getEvents();
  const matching = events.filter((e) => e.event === options.eventName);

  if (matching.length === 0) {
    throw new Error(`No events found with name: ${options.eventName}`);
  }

  if (options.attributes) {
    const matchingWithAttrs = matching.filter((e) =>
      Object.entries(options.attributes!).every(
        ([key, value]) => e.attributes && e.attributes[key] === value,
      ),
    );

    if (matchingWithAttrs.length === 0) {
      throw new Error(
        `Event ${options.eventName} found but attributes don't match: ${JSON.stringify(options.attributes)}`,
      );
    }
  }
}

/**
 * Assert that an outcome was tracked
 *
 * @example
 * ```typescript
 * assertOutcomeTracked({
 *   collector,
 *   operation: 'payment.process',
 *   status: 'success'
 * })
 * ```
 */
export function assertOutcomeTracked(options: {
  collector: MetricsCollector;
  operation: string;
  status: 'success' | 'failure' | 'partial';
}): void {
  const outcomes = options.collector.getOutcomes();
  const matching = outcomes.filter(
    (o) => o.operation === options.operation && o.status === options.status,
  );

  if (matching.length === 0) {
    throw new Error(
      `No outcomes found with operation: ${options.operation} and status: ${options.status}`,
    );
  }
}
