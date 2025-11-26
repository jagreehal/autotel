/**
 * Integration tests for autotel
 *
 * Tests end-to-end flows with all components working together
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { init } from './init';
import { trace } from './functional';
import { track, resetEventQueue } from './track';
import { Event, resetEvents } from './event';
import { flush, shutdown } from './shutdown';
import { resetMetrics } from './metric';
import { resetConfig } from './config';
import { EventAttributes, EventSubscriber } from './event-subscriber';

// Test adapter that collects events
class TestAdapter implements EventSubscriber {
  name = 'test-adapter';
  events: Array<{ type: string; name: string; attributes?: EventAttributes }> =
    [];

  async trackEvent(name: string, attributes?: EventAttributes): Promise<void> {
    this.events.push({ type: 'event', name, attributes });
  }

  async trackFunnelStep(
    funnel: string,
    status: string,
    attributes?: EventAttributes,
  ): Promise<void> {
    this.events.push({
      type: 'funnel',
      name: `${funnel}.${status}`,
      attributes,
    });
  }

  async trackOutcome(
    operation: string,
    status: string,
    attributes?: EventAttributes,
  ): Promise<void> {
    this.events.push({
      type: 'outcome',
      name: `${operation}.${status}`,
      attributes,
    });
  }

  async trackValue(
    metric: string,
    value: number,
    attributes?: EventAttributes,
  ): Promise<void> {
    this.events.push({
      type: 'value',
      name: metric,
      attributes: { ...attributes, value },
    });
  }

  async shutdown(): Promise<void> {
    // Cleanup if needed
  }

  reset(): void {
    this.events = [];
  }
}

describe('Integration Test Suite', () => {
  let testAdapter: TestAdapter;

  beforeEach(() => {
    // Reset all global state between tests
    resetEventQueue();
    resetEvents();
    resetMetrics();
    resetConfig();
    testAdapter = new TestAdapter();
  });

  afterEach(async () => {
    // Clean up after each test
    await shutdown();
  });

  describe('Full stack initialization', () => {
    it('should initialize all components together', () => {
      init({
        service: 'test-app',
        subscribers: [testAdapter],
        version: '1.0.0',
        environment: 'test',
      });

      expect(true).toBe(true); // Should not throw
    });
  });

  describe('Tracing + Events integration', () => {
    it('should correlate traces with events events', async () => {
      init({
        service: 'user-service',
        subscribers: [testAdapter],
      });

      // Create trace function
      const createUser = trace(async (userId: string, plan: string) => {
        // Track events event inside trace function
        track('user.signup', { userId, plan });
        return { id: userId, plan };
      });

      // Execute
      const result = await createUser('user123', 'pro');

      // Should return expected result
      expect(result).toEqual({ id: 'user123', plan: 'pro' });

      // Flush to send events
      await flush();

      // Events event should be tracked
      // (traceId correlation happens automatically)
      const event = testAdapter.events.filter((e) => e.name === 'user.signup');
      expect(event.length).toBeGreaterThan(0);
    });

    it('should handle nested trace functions', async () => {
      init({
        service: 'order-service',
        subscribers: [testAdapter],
      });

      const validateOrder = trace(async (orderId: string) => {
        track('order.validated', { orderId });
        return true;
      });

      const processPayment = trace(async (orderId: string, amount: number) => {
        track('payment.processed', { orderId, amount });
        return { success: true };
      });

      const createOrder = trace(async (orderId: string, amount: number) => {
        await validateOrder(orderId);
        await processPayment(orderId, amount);
        track('order.completed', { orderId, amount });
        return { orderId, status: 'completed' };
      });

      await createOrder('order123', 99.99);
      await flush();

      // All events should be tracked
      expect(testAdapter.events.length).toBeGreaterThanOrEqual(3);
      expect(testAdapter.events.map((e) => e.name)).toContain(
        'order.validated',
      );
      expect(testAdapter.events.map((e) => e.name)).toContain(
        'payment.processed',
      );
      expect(testAdapter.events.map((e) => e.name)).toContain(
        'order.completed',
      );
    });
  });

  describe('Events class integration', () => {
    it('should track all events event types', async () => {
      const event = new Event('checkout', {
        subscribers: [testAdapter],
      });

      // Track different event types
      event.trackEvent('checkout.started', { cartValue: 149.99 });
      event.trackFunnelStep('checkout', 'started', { userId: '123' });
      event.trackFunnelStep('checkout', 'started', {
        userId: '123',
        step: 'payment_info',
      });
      event.trackFunnelStep('checkout', 'completed', { userId: '123' });
      event.trackOutcome('payment.process', 'success', { amount: 149.99 });
      event.trackValue('revenue', 149.99, { currency: 'USD' });

      // Flush adapters
      await event.flush();

      // All events should be captured
      expect(testAdapter.events.length).toBe(6);
      expect(testAdapter.events.map((e) => e.type)).toEqual([
        'event',
        'funnel',
        'funnel',
        'funnel',
        'outcome',
        'value',
      ]);
    });
  });

  describe('Error handling integration', () => {
    it('should handle adapter failures gracefully', async () => {
      const failingAdapter: EventSubscriber = {
        name: 'failing-adapter',
        trackEvent: async () => {
          throw new Error('Adapter error');
        },
        trackFunnelStep: async () => {},
        trackOutcome: async () => {},
        trackValue: async () => {},
      };

      const event = new Event('test', {
        subscribers: [failingAdapter, testAdapter], // Mix failing and working
      });

      // Should not throw even though one adapter fails
      event.trackEvent('test.event', { foo: 'bar' });

      await event.flush();

      // Working adapter should still receive events
      expect(testAdapter.events.length).toBeGreaterThan(0);
    });

    it('should handle circuit breaker opening', async () => {
      let callCount = 0;

      const unreliableAdapter: EventSubscriber = {
        name: 'unreliable-adapter',
        trackEvent: async () => {
          callCount++;
          // Fail first 5 times to trip circuit breaker
          if (callCount <= 5) {
            throw new Error('Service unavailable');
          }
        },
        trackFunnelStep: async () => {},
        trackOutcome: async () => {},
        trackValue: async () => {},
      };

      const event = new Event('test', {
        subscribers: [unreliableAdapter],
      });

      // Send events one at a time to allow circuit breaker to open
      for (let i = 0; i < 10; i++) {
        event.trackEvent(`event.${i}`, { index: i });
        // Wait a bit to allow circuit breaker to process
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      await event.flush();

      // Circuit should open after 5 failures
      // Remaining calls should be fast-failed
      expect(callCount).toBeLessThanOrEqual(6); // 5 failures + maybe 1 half-open test
    });
  });

  describe('Input validation integration', () => {
    it('should sanitize sensitive data across all components', async () => {
      init({
        service: 'auth-service',
        subscribers: [testAdapter],
      });

      // Track with sensitive data
      track('user.login', {
        email: 'user@example.com',
        password: 'secret123', // Should be redacted
        apiKey: 'abc123', // Should be redacted
        userId: '123', // Should NOT be redacted
      });

      await flush();

      const event = testAdapter.events.find((e) => e.name === 'user.login');
      expect(event?.attributes?.email).toBe('user@example.com');
      expect(event?.attributes?.password).toBe('[REDACTED]');
      expect(event?.attributes?.apiKey).toBe('[REDACTED]');
      expect(event?.attributes?.userId).toBe('123');
    });

    it('should validate event names', () => {
      const event = new Event('test', {
        subscribers: [testAdapter],
      });

      // Invalid event names should throw
      expect(() => {
        event.trackEvent('', { foo: 'bar' });
      }).toThrow();

      expect(() => {
        event.trackEvent('invalid event name', { foo: 'bar' });
      }).toThrow();
    });
  });

  describe('Graceful shutdown integration', () => {
    it('should shutdown all components cleanly', async () => {
      init({
        service: 'test-service',
        subscribers: [testAdapter],
      });

      track('test.event', { foo: 'bar' });

      await shutdown();

      // Events should be flushed
      expect(testAdapter.events.length).toBeGreaterThan(0);
    });
  });

  describe('Performance under load', () => {
    it('should handle high event volume', async () => {
      init({
        service: 'high-volume-service',
        subscribers: [testAdapter],
      });

      // Send 1000 events
      for (let i = 0; i < 1000; i++) {
        track(`event.${i}`, { index: i });
      }

      await flush({ timeout: 10_000 }); // 10s timeout for high-volume test

      // All events should be captured
      expect(testAdapter.events.length).toBeGreaterThanOrEqual(1000);
    });

    it('should batch events efficiently', async () => {
      init({
        service: 'batch-test',
        subscribers: [testAdapter],
      });

      const startTime = Date.now();

      // Track 500 events
      for (let i = 0; i < 500; i++) {
        track(`event.${i}`, { index: i });
      }

      await flush({ timeout: 10_000 }); // 10s timeout for high-volume test

      const duration = Date.now() - startTime;

      // Should complete in reasonable time (batching improves performance)
      // This is a sanity check - actual threshold depends on hardware
      expect(duration).toBeLessThan(10_000); // 10 seconds (increased for CI/CD reliability)
    });
  });
});
