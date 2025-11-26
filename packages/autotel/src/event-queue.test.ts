/**
 * Tests for events queue guardrails
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventQueue } from './event-queue';

// Mock adapter for testing
type MockEvent = {
  name: string;
  attributes?: Record<string, unknown>;
};

class MockAdapter {
  public events: MockEvent[] = [];
  public callCount = 0;
  public shouldFail = false;

  async trackEvent(
    name: string,
    attributes?: Record<string, unknown>,
  ): Promise<void> {
    this.callCount++;
    if (this.shouldFail) {
      throw new Error('Adapter failed');
    }
    this.events.push({ name, attributes });
  }

  async trackFunnelStep(): Promise<void> {}
  async trackOutcome(): Promise<void> {}
  async trackValue(): Promise<void> {}
}

describe('EventQueue', () => {
  let mockAdapter: MockAdapter;
  let queue: EventQueue;

  beforeEach(() => {
    mockAdapter = new MockAdapter();
    queue = new EventQueue([mockAdapter], {
      maxSize: 10,
      batchSize: 3,
      flushInterval: 100,
      maxRetries: 2,
    });
  });

  describe('Batching', () => {
    it('should enqueue events without immediate sending', () => {
      queue.enqueue({ name: 'test1', attributes: {}, timestamp: Date.now() });
      queue.enqueue({ name: 'test2', attributes: {}, timestamp: Date.now() });

      expect(queue.size()).toBe(2);
      expect(mockAdapter.callCount).toBe(0); // Not sent yet
    });

    it('should flush after interval', async () => {
      queue.enqueue({ name: 'test1', attributes: {}, timestamp: Date.now() });
      queue.enqueue({ name: 'test2', attributes: {}, timestamp: Date.now() });

      // Wait for flush interval
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(queue.size()).toBe(0);
      expect(mockAdapter.events.length).toBeGreaterThan(0);
    });

    it('should batch events efficiently', async () => {
      // Enqueue 5 events (batch size is 3)
      for (let i = 0; i < 5; i++) {
        queue.enqueue({
          name: `test${i}`,
          attributes: {},
          timestamp: Date.now(),
        });
      }

      // Manual flush
      await queue.flush();

      expect(queue.size()).toBe(0);
      expect(mockAdapter.events.length).toBe(5);
    });
  });

  describe('Backpressure', () => {
    it('should drop oldest when queue is full in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      // Fill queue to max (10 events)
      for (let i = 0; i < 12; i++) {
        queue.enqueue({
          name: `test${i}`,
          attributes: { index: i },
          timestamp: Date.now(),
        });
      }

      // Queue should be at max size
      expect(queue.size()).toBe(10);

      process.env.NODE_ENV = originalEnv;
    });

    it('should drop oldest and log when queue is full (consistent behavior)', () => {
      // Fill queue to max
      for (let i = 0; i < 10; i++) {
        queue.enqueue({
          name: `test${i}`,
          attributes: {},
          timestamp: Date.now(),
        });
      }

      // Next enqueue should drop oldest (not throw)
      expect(() => {
        queue.enqueue({
          name: 'test11',
          attributes: {},
          timestamp: Date.now(),
        });
      }).not.toThrow();

      // Verify queue is still at max size
      expect(queue['queue']).toHaveLength(10);
    });
  });

  describe('Retry logic', () => {
    it('should retry on failure', async () => {
      mockAdapter.shouldFail = true;

      queue.enqueue({ name: 'test1', attributes: {}, timestamp: Date.now() });

      await queue.flush();

      // Should have tried maxRetries + 1 times (initial + 2 retries = 3)
      expect(mockAdapter.callCount).toBeGreaterThanOrEqual(3);
    });

    it('should succeed after transient failure', async () => {
      let failCount = 0;
      mockAdapter.trackEvent = async () => {
        if (failCount < 2) {
          failCount++;
          throw new Error('Transient failure');
        }
        mockAdapter.events.push({ name: 'test', attributes: {} });
      };

      queue.enqueue({ name: 'test1', attributes: {}, timestamp: Date.now() });

      await queue.flush();

      // Should eventually succeed
      expect(mockAdapter.events.length).toBe(1);
    });
  });

  describe('Graceful flush', () => {
    it('should flush all remaining events', async () => {
      for (let i = 0; i < 5; i++) {
        queue.enqueue({
          name: `test${i}`,
          attributes: {},
          timestamp: Date.now(),
        });
      }

      expect(queue.size()).toBe(5);

      await queue.flush();

      expect(queue.size()).toBe(0);
      expect(mockAdapter.events.length).toBe(5);
    });

    it('should handle empty queue flush', async () => {
      await expect(queue.flush()).resolves.not.toThrow();
    });
  });

  describe('Multiple adapters', () => {
    it('should send to all adapters', async () => {
      const adapter1 = new MockAdapter();
      const adapter2 = new MockAdapter();
      const multiQueue = new EventQueue([adapter1, adapter2]);

      multiQueue.enqueue({
        name: 'test1',
        attributes: {},
        timestamp: Date.now(),
      });

      await multiQueue.flush();

      expect(adapter1.events.length).toBe(1);
      expect(adapter2.events.length).toBe(1);
    });

    it('should handle partial adapter failures', async () => {
      const adapter1 = new MockAdapter();
      const adapter2 = new MockAdapter();
      adapter1.shouldFail = true; // One adapter fails

      const multiQueue = new EventQueue([adapter1, adapter2], {
        maxRetries: 1,
      });

      multiQueue.enqueue({
        name: 'test1',
        attributes: {},
        timestamp: Date.now(),
      });

      // Should not throw, just log error
      await expect(multiQueue.flush()).resolves.not.toThrow();
    });
  });
});
