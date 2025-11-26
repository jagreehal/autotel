/**
 * Mock Events Subscriber for Testing
 *
 * In-memory subscriber that captures all events events for testing assertions.
 * Useful for unit testing code that uses Events without making real API calls.
 *
 * @example Basic testing
 * ```typescript
 * import { Events } from 'autotel/events';
 * import { MockEventSubscriber } from 'autotel-subscribers/mock-event-subscriber';
 * import { describe, it, expect, beforeEach } from 'vitest';
 *
 * describe('CheckoutService', () => {
 *   let mockSubscriber: MockEventSubscriber;
 *   let events: Events;
 *
 *   beforeEach(() => {
 *     mockSubscriber = new MockEventSubscriber();
 *     events = new Events('checkout', { subscribers: [mockSubscriber] });
 *   });
 *
 *   it('should track order completion', async () => {
 *     const service = new CheckoutService(events);
 *     await service.completeOrder('ord_123', 99.99);
 *
 *     expect(mockSubscriber.events).toHaveLength(1);
 *     expect(mockSubscriber.events[0]).toMatchObject({
 *       type: 'event',
 *       name: 'order.completed',
 *       attributes: { orderId: 'ord_123', amount: 99.99 }
 *     });
 *   });
 *
 *   it('should track checkout funnel', () => {
 *     events.trackFunnelStep('checkout', 'started', { cartValue: 99.99 });
 *     events.trackFunnelStep('checkout', 'completed', { cartValue: 99.99 });
 *
 *     const funnelEvents = mockSubscriber.getFunnelEvents('checkout');
 *     expect(funnelEvents).toHaveLength(2);
 *     expect(funnelEvents[0].step).toBe('started');
 *     expect(funnelEvents[1].step).toBe('completed');
 *   });
 * });
 * ```
 *
 * @example With Outbox Pattern
 * ```typescript
 * import { createPublisher } from 'autotel-outbox';
 * import { MockOutboxStorage } from 'autotel-outbox/testing';
 *
 * it('should broadcast events to all subscribers', async () => {
 *   const mockOutbox = new MockOutboxStorage();
 *   const mockSubscriber = new MockEventSubscriber();
 *
 *   // Add events to outbox
 *   await mockOutbox.writeEvent({
 *     id: '1',
 *     type: 'order.completed',
 *     aggregateId: 'ord_123',
 *     aggregateType: 'Order',
 *     payload: { amount: 99.99 },
 *     createdAt: new Date().toISOString(),
 *     publishedAt: null
 *   });
 *
 *   // Run publisher
 *   const publisher = createPublisher(mockOutbox, [mockSubscriber]);
 *   await publisher();
 *
 *   // Assert event was broadcast
 *   expect(mockSubscriber.events).toHaveLength(1);
 *   expect(mockSubscriber.events[0].name).toBe('order.completed');
 * });
 * ```
 */

import type {
  EventSubscriber,
  EventAttributes,
  FunnelStatus,
  OutcomeStatus,
} from 'autotel/event-subscriber';

/**
 * Captured event data
 */
export interface CapturedEvent {
  type: 'event' | 'funnel' | 'outcome' | 'value';
  name: string;
  attributes?: EventAttributes;
  funnel?: string;
  step?: FunnelStatus;
  operation?: string;
  outcome?: OutcomeStatus;
  value?: number;
  timestamp: string;
}

/**
 * Mock subscriber for testing
 *
 * Captures all events calls in memory for test assertions.
 * Does not make any real API calls.
 */
export class MockEventSubscriber implements EventSubscriber {
  readonly name = 'MockEventSubscriber';
  readonly version = '1.0.0';

  /**
   * All captured events
   */
  public events: CapturedEvent[] = [];

  /**
   * Track if shutdown was called
   */
  public shutdownCalled = false;

  async trackEvent(name: string, attributes?: EventAttributes): Promise<void> {
    this.events.push({
      type: 'event',
      name,
      attributes,
      timestamp: new Date().toISOString(),
    });
  }

  async trackFunnelStep(
    funnelName: string,
    step: FunnelStatus,
    attributes?: EventAttributes,
  ): Promise<void> {
    this.events.push({
      type: 'funnel',
      name: `${funnelName}.${step}`,
      funnel: funnelName,
      step,
      attributes,
      timestamp: new Date().toISOString(),
    });
  }

  async trackOutcome(
    operationName: string,
    outcome: OutcomeStatus,
    attributes?: EventAttributes,
  ): Promise<void> {
    this.events.push({
      type: 'outcome',
      name: `${operationName}.${outcome}`,
      operation: operationName,
      outcome,
      attributes,
      timestamp: new Date().toISOString(),
    });
  }

  async trackValue(
    name: string,
    value: number,
    attributes?: EventAttributes,
  ): Promise<void> {
    this.events.push({
      type: 'value',
      name,
      value,
      attributes,
      timestamp: new Date().toISOString(),
    });
  }

  async shutdown(): Promise<void> {
    this.shutdownCalled = true;
  }

  /**
   * Reset captured events (useful between tests)
   */
  reset(): void {
    this.events = [];
    this.shutdownCalled = false;
  }

  /**
   * Get events by type
   */
  getEventsByType(
    type: 'event' | 'funnel' | 'outcome' | 'value',
  ): CapturedEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  /**
   * Get events by name
   */
  getEventsByName(name: string): CapturedEvent[] {
    return this.events.filter((e) => e.name === name);
  }

  /**
   * Get funnel events for a specific funnel
   */
  getFunnelEvents(funnelName: string): CapturedEvent[] {
    return this.events.filter(
      (e) => e.type === 'funnel' && e.funnel === funnelName,
    );
  }

  /**
   * Get outcome events for a specific operation
   */
  getOutcomeEvents(operationName: string): CapturedEvent[] {
    return this.events.filter(
      (e) => e.type === 'outcome' && e.operation === operationName,
    );
  }

  /**
   * Get value events by metric name
   */
  getValueEvents(metricName: string): CapturedEvent[] {
    return this.events.filter(
      (e) => e.type === 'value' && e.name === metricName,
    );
  }

  /**
   * Assert that an event was tracked
   */
  assertEventTracked(
    name: string,
    attributes?: Partial<EventAttributes>,
  ): void {
    const events = this.getEventsByName(name);

    if (events.length === 0) {
      throw new Error(`No events found with name: ${name}`);
    }

    if (attributes) {
      const matchingEvent = events.find((event) => {
        if (!event.attributes) return false;

        return Object.entries(attributes).every(
          ([key, value]) => event.attributes![key] === value,
        );
      });

      if (!matchingEvent) {
        throw new Error(
          `Event "${name}" found, but no matching attributes: ${JSON.stringify(attributes)}`,
        );
      }
    }
  }

  /**
   * Assert that a funnel step was tracked
   */
  assertFunnelStepTracked(
    funnelName: string,
    step: FunnelStatus,
    attributes?: Partial<EventAttributes>,
  ): void {
    const events = this.getFunnelEvents(funnelName);
    const matchingEvent = events.find((e) => e.step === step);

    if (!matchingEvent) {
      throw new Error(
        `Funnel "${funnelName}" step "${step}" was not tracked`,
      );
    }

    if (attributes) {
      const hasMatchingAttributes = Object.entries(attributes).every(
        ([key, value]) => matchingEvent.attributes?.[key] === value,
      );

      if (!hasMatchingAttributes) {
        throw new Error(
          `Funnel step tracked, but attributes don't match: ${JSON.stringify(attributes)}`,
        );
      }
    }
  }

  /**
   * Assert that an outcome was tracked
   */
  assertOutcomeTracked(
    operationName: string,
    outcome: OutcomeStatus,
    attributes?: Partial<EventAttributes>,
  ): void {
    const events = this.getOutcomeEvents(operationName);
    const matchingEvent = events.find((e) => e.outcome === outcome);

    if (!matchingEvent) {
      throw new Error(
        `Outcome "${operationName}.${outcome}" was not tracked`,
      );
    }

    if (attributes) {
      const hasMatchingAttributes = Object.entries(attributes).every(
        ([key, value]) => matchingEvent.attributes?.[key] === value,
      );

      if (!hasMatchingAttributes) {
        throw new Error(
          `Outcome tracked, but attributes don't match: ${JSON.stringify(attributes)}`,
        );
      }
    }
  }

  /**
   * Pretty print all captured events (useful for debugging)
   */
  printEvents(): void {
    console.log(`\n[${this.name}] Captured ${this.events.length} events:\n`);
    for (const [index, event] of this.events.entries()) {
      console.log(`${index + 1}. [${event.type}] ${event.name}`);
      if (event.attributes) {
        console.log(`   Attributes:`, event.attributes);
      }
      if (event.value !== undefined) {
        console.log(`   Value: ${event.value}`);
      }
      console.log(`   Timestamp: ${event.timestamp}\n`);
    }
  }
}
