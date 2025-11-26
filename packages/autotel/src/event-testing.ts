/**
 * Testing utilities for Events
 *
 * Provides in-memory collection of events for testing purposes.
 */

import type {
  EventAttributes,
  FunnelStatus,
  OutcomeStatus,
} from './event-subscriber';

export interface EventData {
  event: string;
  attributes?: EventAttributes;
  service: string;
  timestamp: number;
}

export interface EventsFunnelStep {
  funnel: string;
  status: FunnelStatus;
  attributes?: EventAttributes;
  service: string;
  timestamp: number;
}

export interface EventsOutcome {
  operation: string;
  status: OutcomeStatus;
  attributes?: EventAttributes;
  service: string;
  timestamp: number;
}

export interface EventsValue {
  metric: string;
  value: number;
  attributes?: EventAttributes;
  service: string;
  timestamp: number;
}

/**
 * In-memory events collector for testing
 */
export interface EventCollector {
  /** Get all collected events */
  getEvents(): EventData[];
  /** Get all collected funnel steps */
  getFunnelSteps(): EventsFunnelStep[];
  /** Get all collected outcomes */
  getOutcomes(): EventsOutcome[];
  /** Get all collected values */
  getValues(): EventsValue[];
  /** Clear all collected events */
  clear(): void;
  /** Record an event (internal use) */
  recordEvent(event: EventData): void;
  /** Record a funnel step (internal use) */
  recordFunnelStep(step: EventsFunnelStep): void;
  /** Record an outcome (internal use) */
  recordOutcome(outcome: EventsOutcome): void;
  /** Record a value (internal use) */
  recordValue(value: EventsValue): void;
}

/**
 * Create an in-memory events collector for testing
 *
 * @example
 * ```typescript
 * const collector = createEventCollector()
 *
 * const events = new Event('test-service', { collector })
 * events.trackEvent('application.submitted', { jobId: '123' })
 *
 * const event =collector.getEvents()
 * expect(events).toHaveLength(1)
 * expect(events[0].event).toBe('application.submitted')
 * ```
 */
export function createEventCollector(): EventCollector {
  const events: EventData[] = [];
  const funnelSteps: EventsFunnelStep[] = [];
  const outcomes: EventsOutcome[] = [];
  const values: EventsValue[] = [];

  return {
    getEvents(): EventData[] {
      return [...events];
    },

    getFunnelSteps(): EventsFunnelStep[] {
      return [...funnelSteps];
    },

    getOutcomes(): EventsOutcome[] {
      return [...outcomes];
    },

    getValues(): EventsValue[] {
      return [...values];
    },

    clear(): void {
      events.length = 0;
      funnelSteps.length = 0;
      outcomes.length = 0;
      values.length = 0;
    },

    recordEvent(event: EventData): void {
      events.push(event);
    },

    recordFunnelStep(step: EventsFunnelStep): void {
      funnelSteps.push(step);
    },

    recordOutcome(outcome: EventsOutcome): void {
      outcomes.push(outcome);
    },

    recordValue(value: EventsValue): void {
      values.push(value);
    },
  };
}

/**
 * Assert that an events event was tracked
 *
 * @example
 * ```typescript
 * assertEventTracked({
 *   collector,
 *   eventName: 'application.submitted',
 *   attributes: { jobId: '123' }
 * })
 * ```
 */
export function assertEventTracked(options: {
  collector: EventCollector;
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
 *   operation: 'email.delivery',
 *   status: 'success'
 * })
 * ```
 */
export function assertOutcomeTracked(options: {
  collector: EventCollector;
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
