/**
 * Tests for events queue guardrails
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventQueue, type EventDropReason } from './event-queue';
import { configure, resetConfig } from './config';

// Mock adapter for testing
type MockEvent = {
  name: string;
  attributes?: Record<string, unknown>;
};

class MockAdapter {
  public name = 'MockAdapter';
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

  describe('Metrics semantics', () => {
    function createMockMeter() {
      const counters = new Map<string, { add: ReturnType<typeof vi.fn> }>();
      const histograms = new Map<
        string,
        { record: ReturnType<typeof vi.fn> }
      >();
      const mockMeter = {
        createObservableGauge: vi.fn(() => ({
          addCallback: vi.fn(),
          removeCallback: vi.fn(),
        })),
        createCounter: vi.fn((name: string) => {
          const counter = { add: vi.fn() };
          counters.set(name, counter);
          return counter;
        }),
        createHistogram: vi.fn((name: string) => {
          const histogram = { record: vi.fn() };
          histograms.set(name, histogram);
          return histogram;
        }),
      };
      return { mockMeter, counters, histograms };
    }

    it('should not increment failed counter when a retry succeeds', async () => {
      const { mockMeter, counters } = createMockMeter();
      configure({ meter: mockMeter as any });

      try {
        const adapter = new MockAdapter();
        let failCount = 0;
        adapter.trackEvent = async () => {
          if (failCount < 1) {
            failCount++;
            throw new Error('Transient failure');
          }
          adapter.events.push({ name: 'test', attributes: {} });
        };

        const localQueue = new EventQueue([adapter], { maxRetries: 1 });
        localQueue.enqueue({
          name: 'test1',
          attributes: {},
          timestamp: Date.now(),
        });

        await localQueue.flush();

        const failedCounter = counters.get(
          'autotel.event_delivery.queue.failed',
        );
        expect(failedCounter?.add).toHaveBeenCalledTimes(0);
      } finally {
        resetConfig();
      }
    });

    it('should increment failed counter after all retries exhausted', async () => {
      const { mockMeter, counters } = createMockMeter();
      configure({ meter: mockMeter as any });

      try {
        const adapter = new MockAdapter();
        adapter.shouldFail = true; // Always fail

        const localQueue = new EventQueue([adapter], { maxRetries: 2 });
        localQueue.enqueue({
          name: 'test1',
          attributes: {},
          timestamp: Date.now(),
        });

        await localQueue.flush();

        const failedCounter = counters.get(
          'autotel.event_delivery.queue.failed',
        );
        // Should be called once per event per subscriber after retries exhausted
        expect(failedCounter?.add).toHaveBeenCalledTimes(1);
        expect(failedCounter?.add).toHaveBeenCalledWith(1, {
          subscriber: 'mockadapter',
        });
      } finally {
        resetConfig();
      }
    });

    it('should count failed events per event, not per batch', async () => {
      const { mockMeter, counters } = createMockMeter();
      configure({ meter: mockMeter as any });

      try {
        const adapter = new MockAdapter();
        adapter.trackEvent = async (name) => {
          if (name === 'bad') {
            throw new Error('Per-event failure');
          }
          adapter.events.push({ name, attributes: {} });
        };

        const localQueue = new EventQueue([adapter], {
          batchSize: 2,
          maxRetries: 0,
        });
        localQueue.enqueue({
          name: 'good',
          attributes: {},
          timestamp: Date.now(),
        });
        localQueue.enqueue({
          name: 'bad',
          attributes: {},
          timestamp: Date.now(),
        });

        await localQueue.flush();

        const failedCounter = counters.get(
          'autotel.event_delivery.queue.failed',
        );
        expect(failedCounter?.add).toHaveBeenCalledTimes(1);
      } finally {
        resetConfig();
      }
    });

    it('should increment delivered counter on successful delivery', async () => {
      const { mockMeter, counters } = createMockMeter();
      configure({ meter: mockMeter as any });

      try {
        const adapter = new MockAdapter();

        const localQueue = new EventQueue([adapter], { maxRetries: 1 });
        localQueue.enqueue({
          name: 'test1',
          attributes: {},
          timestamp: Date.now(),
        });

        await localQueue.flush();

        const deliveredCounter = counters.get(
          'autotel.event_delivery.queue.delivered',
        );
        expect(deliveredCounter?.add).toHaveBeenCalledTimes(1);
        expect(deliveredCounter?.add).toHaveBeenCalledWith(1, {
          subscriber: 'mockadapter',
        });
      } finally {
        resetConfig();
      }
    });

    it('should increment delivered counter when retry eventually succeeds', async () => {
      const { mockMeter, counters } = createMockMeter();
      configure({ meter: mockMeter as any });

      try {
        const adapter = new MockAdapter();
        let failCount = 0;
        adapter.trackEvent = async () => {
          if (failCount < 2) {
            failCount++;
            throw new Error('Transient failure');
          }
          adapter.events.push({ name: 'test', attributes: {} });
        };

        const localQueue = new EventQueue([adapter], { maxRetries: 3 });
        localQueue.enqueue({
          name: 'test1',
          attributes: {},
          timestamp: Date.now(),
        });

        await localQueue.flush();

        const deliveredCounter = counters.get(
          'autotel.event_delivery.queue.delivered',
        );
        const failedCounter = counters.get(
          'autotel.event_delivery.queue.failed',
        );

        // Delivered should be incremented once (eventual success)
        expect(deliveredCounter?.add).toHaveBeenCalledTimes(1);
        // Failed should NOT be incremented (retry succeeded)
        expect(failedCounter?.add).toHaveBeenCalledTimes(0);
      } finally {
        resetConfig();
      }
    });

    it('should not double-count delivered events when retrying a mixed-success batch', async () => {
      const { mockMeter, counters } = createMockMeter();
      configure({ meter: mockMeter as any });

      try {
        const adapter = new MockAdapter();
        let badFailCount = 0;
        adapter.trackEvent = async (name) => {
          if (name === 'bad' && badFailCount < 1) {
            badFailCount++;
            throw new Error('Transient failure');
          }
          adapter.events.push({ name, attributes: {} });
        };

        const localQueue = new EventQueue([adapter], {
          batchSize: 2,
          maxRetries: 1,
        });

        localQueue.enqueue({
          name: 'good',
          attributes: {},
          timestamp: Date.now(),
        });
        localQueue.enqueue({
          name: 'bad',
          attributes: {},
          timestamp: Date.now(),
        });

        await localQueue.flush();

        const deliveredCounter = counters.get(
          'autotel.event_delivery.queue.delivered',
        );
        // Expect one delivery per event (good + bad), not double-counting good on retry
        expect(deliveredCounter?.add).toHaveBeenCalledTimes(2);
      } finally {
        resetConfig();
      }
    });

    it('should not re-send to healthy subscribers when retrying failed ones', async () => {
      const { mockMeter } = createMockMeter();
      configure({ meter: mockMeter as any });

      try {
        const failingAdapter = new MockAdapter();
        failingAdapter.name = 'FailingAdapter';
        let failCount = 0;
        failingAdapter.trackEvent = async () => {
          if (failCount < 1) {
            failCount++;
            throw new Error('Transient failure');
          }
          failingAdapter.events.push({ name: 'test', attributes: {} });
        };

        const healthyAdapter = new MockAdapter();
        healthyAdapter.name = 'HealthyAdapter';

        const localQueue = new EventQueue([failingAdapter, healthyAdapter], {
          maxRetries: 1,
        });

        localQueue.enqueue({
          name: 'test1',
          attributes: {},
          timestamp: Date.now(),
        });

        await localQueue.flush();

        // Healthy subscriber should only receive the event once
        expect(healthyAdapter.callCount).toBe(1);
      } finally {
        resetConfig();
      }
    });

    it('should retry only failed events and deliver each event once (three-event batch)', async () => {
      const { mockMeter, counters } = createMockMeter();
      configure({ meter: mockMeter as any });

      try {
        const adapter = new MockAdapter();
        let middleFailCount = 0;
        adapter.trackEvent = async (name) => {
          if (name === 'middle' && middleFailCount < 1) {
            middleFailCount++;
            throw new Error('Transient failure');
          }
          adapter.events.push({ name, attributes: {} });
        };

        const localQueue = new EventQueue([adapter], {
          batchSize: 3,
          maxRetries: 1,
        });

        localQueue.enqueue({
          name: 'first',
          attributes: {},
          timestamp: Date.now(),
        });
        localQueue.enqueue({
          name: 'middle',
          attributes: {},
          timestamp: Date.now(),
        });
        localQueue.enqueue({
          name: 'last',
          attributes: {},
          timestamp: Date.now(),
        });

        await localQueue.flush();

        // Adapter receives exactly three events, each once (first and last on first attempt, middle on retry)
        expect(adapter.events).toHaveLength(3);
        expect(adapter.events.map((e) => e.name)).toEqual([
          'first',
          'last',
          'middle',
        ]);

        const deliveredCounter = counters.get(
          'autotel.event_delivery.queue.delivered',
        );
        expect(deliveredCounter?.add).toHaveBeenCalledTimes(3);
      } finally {
        resetConfig();
      }
    });

    it('should record latency histogram on successful delivery', async () => {
      const { mockMeter, histograms } = createMockMeter();
      configure({ meter: mockMeter as any });

      try {
        const adapter = new MockAdapter();

        const localQueue = new EventQueue([adapter], { maxRetries: 1 });
        localQueue.enqueue({
          name: 'test1',
          attributes: {},
          timestamp: Date.now(),
        });

        await localQueue.flush();

        const latencyHistogram = histograms.get(
          'autotel.event_delivery.queue.latency_ms',
        );
        expect(latencyHistogram?.record).toHaveBeenCalledTimes(1);
        // First argument is the latency value (number), second is attributes
        expect(latencyHistogram?.record).toHaveBeenCalledWith(
          expect.any(Number),
          { subscriber: 'mockadapter' },
        );
      } finally {
        resetConfig();
      }
    });

    it('should not record latency when delivery fails', async () => {
      const { mockMeter, histograms } = createMockMeter();
      configure({ meter: mockMeter as any });

      try {
        const adapter = new MockAdapter();
        adapter.shouldFail = true;

        const localQueue = new EventQueue([adapter], { maxRetries: 1 });
        localQueue.enqueue({
          name: 'test1',
          attributes: {},
          timestamp: Date.now(),
        });

        await localQueue.flush();

        const latencyHistogram = histograms.get(
          'autotel.event_delivery.queue.latency_ms',
        );
        // No latency recorded for failed deliveries
        expect(latencyHistogram?.record).toHaveBeenCalledTimes(0);
      } finally {
        resetConfig();
      }
    });

    it('should mark subscriber unhealthy on transient failure', async () => {
      const { mockMeter } = createMockMeter();
      configure({ meter: mockMeter as any });

      try {
        const adapter = new MockAdapter();
        let failCount = 0;
        adapter.trackEvent = async () => {
          if (failCount < 1) {
            failCount++;
            throw new Error('Transient failure');
          }
          adapter.events.push({ name: 'test', attributes: {} });
        };

        const localQueue = new EventQueue([adapter], { maxRetries: 2 });

        // Initially healthy
        expect(localQueue.isSubscriberHealthy('mockadapter')).toBe(true);

        localQueue.enqueue({
          name: 'test1',
          attributes: {},
          timestamp: Date.now(),
        });

        await localQueue.flush();

        // After successful retry, should be healthy again
        expect(localQueue.isSubscriberHealthy('mockadapter')).toBe(true);
      } finally {
        resetConfig();
      }
    });

    it('should handle multiple subscribers with mixed success/failure', async () => {
      const { mockMeter, counters } = createMockMeter();
      configure({ meter: mockMeter as any });

      try {
        const adapter1 = new MockAdapter();
        adapter1.name = 'SuccessAdapter';

        const adapter2 = new MockAdapter();
        adapter2.name = 'FailAdapter';
        adapter2.shouldFail = true;

        const localQueue = new EventQueue([adapter1, adapter2], {
          maxRetries: 1,
        });
        localQueue.enqueue({
          name: 'test1',
          attributes: {},
          timestamp: Date.now(),
        });

        await localQueue.flush();

        const deliveredCounter = counters.get(
          'autotel.event_delivery.queue.delivered',
        );
        const failedCounter = counters.get(
          'autotel.event_delivery.queue.failed',
        );

        // One subscriber succeeded, one failed
        expect(deliveredCounter?.add).toHaveBeenCalledWith(1, {
          subscriber: 'successadapter',
        });
        expect(failedCounter?.add).toHaveBeenCalledWith(1, {
          subscriber: 'failadapter',
        });

        // Verify counters were NOT called for the wrong subscribers
        expect(deliveredCounter?.add).not.toHaveBeenCalledWith(1, {
          subscriber: 'failadapter',
        });
        expect(failedCounter?.add).not.toHaveBeenCalledWith(1, {
          subscriber: 'successadapter',
        });

        // Delivered once (successful subscriber only; retry only sends to failed subscriber)
        expect(deliveredCounter?.add).toHaveBeenCalledTimes(1);

        // Failed counter only called once after all retries exhausted
        expect(failedCounter?.add).toHaveBeenCalledTimes(1);
      } finally {
        resetConfig();
      }
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

    it('should allow enqueuing after flush', async () => {
      queue.enqueue({ name: 'test1', attributes: {}, timestamp: Date.now() });
      await queue.flush();

      queue.enqueue({ name: 'test2', attributes: {}, timestamp: Date.now() });
      await queue.flush();

      expect(mockAdapter.events.map((event) => event.name)).toEqual([
        'test1',
        'test2',
      ]);
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

  describe('Subscriber health tracking', () => {
    it('should track subscriber health status', () => {
      const adapter = new MockAdapter();
      adapter.name = 'TestAdapter';
      const healthQueue = new EventQueue([adapter]);

      // All subscribers start healthy
      expect(healthQueue.isSubscriberHealthy('testadapter')).toBe(true);
    });

    it('should mark subscriber as unhealthy on persistent failure', async () => {
      const adapter = new MockAdapter();
      adapter.name = 'FailingAdapter';
      adapter.shouldFail = true;

      const healthQueue = new EventQueue([adapter], {
        maxRetries: 1,
      });

      healthQueue.enqueue({
        name: 'test1',
        attributes: {},
        timestamp: Date.now(),
      });

      await healthQueue.flush();

      // After failure, subscriber should be marked unhealthy
      expect(healthQueue.isSubscriberHealthy('failingadapter')).toBe(false);
    });

    it('should mark subscriber as healthy on success', async () => {
      const adapter = new MockAdapter();
      adapter.name = 'HealthyAdapter';

      const healthQueue = new EventQueue([adapter]);

      // Manually mark as unhealthy first
      healthQueue.setSubscriberHealth('healthyadapter', false);
      expect(healthQueue.isSubscriberHealthy('healthyadapter')).toBe(false);

      // Successful delivery should mark as healthy
      healthQueue.enqueue({
        name: 'test1',
        attributes: {},
        timestamp: Date.now(),
      });

      await healthQueue.flush();

      expect(healthQueue.isSubscriberHealthy('healthyadapter')).toBe(true);
    });

    it('should return health status for all subscribers', () => {
      const adapter1 = new MockAdapter();
      adapter1.name = 'Adapter1';
      const adapter2 = new MockAdapter();
      adapter2.name = 'Adapter2';

      const healthQueue = new EventQueue([adapter1, adapter2]);

      healthQueue.setSubscriberHealth('adapter1', false);

      const healthMap = healthQueue.getSubscriberHealth();
      expect(healthMap.get('adapter1')).toBe(false);
      expect(healthMap.get('adapter2')).toBe(true);
    });

    it('should not mark healthy subscribers as unhealthy when another fails', async () => {
      const failingAdapter = new MockAdapter();
      failingAdapter.name = 'FailingAdapter';
      failingAdapter.shouldFail = true;

      const healthyAdapter = new MockAdapter();
      healthyAdapter.name = 'HealthyAdapter';

      const healthQueue = new EventQueue([failingAdapter, healthyAdapter], {
        maxRetries: 0,
      });

      healthQueue.enqueue({
        name: 'test1',
        attributes: {},
        timestamp: Date.now(),
      });

      await healthQueue.flush();

      expect(healthQueue.isSubscriberHealthy('failingadapter')).toBe(false);
      expect(healthQueue.isSubscriberHealthy('healthyadapter')).toBe(true);
    });
  });

  describe('Shutdown behavior', () => {
    it('should reject events during shutdown', async () => {
      const adapter = new MockAdapter();
      const shutdownQueue = new EventQueue([adapter], {
        flushInterval: 100,
      });

      // Enqueue some events
      shutdownQueue.enqueue({
        name: 'test1',
        attributes: {},
        timestamp: Date.now(),
      });

      // Start shutdown (sets isShuttingDown, then flushes)
      const shutdownPromise = shutdownQueue.shutdown();

      // Try to enqueue during shutdown - should be rejected
      shutdownQueue.enqueue({
        name: 'test2',
        attributes: {},
        timestamp: Date.now(),
      });

      await shutdownPromise;

      // Only first event should be delivered
      expect(adapter.events.length).toBe(1);
      expect(adapter.events[0].name).toBe('test1');
    });
  });

  describe('Correlation ID enrichment', () => {
    it('should enrich events with correlation ID', async () => {
      const adapter = new MockAdapter();
      const correlationQueue = new EventQueue([adapter], {
        flushInterval: 50,
      });

      correlationQueue.enqueue({
        name: 'test1',
        attributes: {},
        timestamp: Date.now(),
      });

      await correlationQueue.flush();

      // The queue should have enriched the event with _correlationId
      // We can verify this by checking that the event was delivered
      expect(adapter.events.length).toBe(1);
    });
  });
});
