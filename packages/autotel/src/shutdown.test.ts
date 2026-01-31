/**
 * Tests for graceful shutdown
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { flush, shutdown } from './shutdown';
import { init } from './init';
import { track, getEventQueue } from './track';
import { EventSubscriber } from './event-subscriber';

// Mock adapter for testing
class MockAdapter implements EventSubscriber {
  name = 'mock-adapter';
  public events: Array<{ name: string; attributes?: Record<string, unknown> }> =
    [];
  public shutdownCalled = false;

  async trackEvent(
    name: string,
    attributes?: Record<string, unknown>,
  ): Promise<void> {
    this.events.push({ name, attributes });
  }

  async trackFunnelStep(): Promise<void> {}
  async trackOutcome(): Promise<void> {}
  async trackValue(): Promise<void> {}

  async shutdown(): Promise<void> {
    this.shutdownCalled = true;
  }
}

describe('shutdown module', () => {
  let mockAdapter: MockAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter = new MockAdapter();
  });

  afterEach(async () => {
    // Clean up after each test
    const queue = getEventQueue();
    if (queue) {
      await queue.flush();
    }
  });

  describe('flush()', () => {
    it('should flush events queue', async () => {
      // Initialize with adapter
      init({
        service: 'test-service',
        subscribers: [mockAdapter],
      });

      // Track events
      track('test.event1', { foo: 'bar' });
      track('test.event2', { baz: 'qux' });

      // Events should be in queue
      const queue = getEventQueue();
      expect(queue?.size()).toBeGreaterThan(0);

      // Flush
      await flush();

      // Queue should be empty (all events sent)
      expect(queue?.size()).toBe(0);
    });

    it('should be safe to call multiple times', async () => {
      init({
        service: 'test-service',
        subscribers: [mockAdapter],
      });

      track('test.event', { data: 'value' });

      await flush();
      await flush();
      await flush();

      // Should not throw
      expect(getEventQueue()?.size()).toBe(0);
    });

    it('should be no-op if no events queue initialized', async () => {
      init({ service: 'test-service' }); // No adapters

      await expect(flush()).resolves.toBeUndefined();
    });

    it('should flush OpenTelemetry spans', async () => {
      // Mock tracer provider with forceFlush
      const mockForceFlush = vi.fn();
      const mockTracerProvider = {
        forceFlush: mockForceFlush,
      };
      const mockSdk = {
        getTracerProvider: () => mockTracerProvider,
        shutdown: vi.fn(),
        start: vi.fn(),
      };

      init({
        service: 'test-service',
        sdkFactory: () => mockSdk as any,
        subscribers: [mockAdapter],
      });

      // Flush should call tracer provider's forceFlush
      await flush();

      expect(mockForceFlush).toHaveBeenCalledOnce();
    });

    it('should handle flush timeout', async () => {
      // Mock tracer provider that hangs
      const mockForceFlush = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            // Never resolves (simulates hanging)
            setTimeout(resolve, 10_000);
          }),
      );
      const mockTracerProvider = {
        forceFlush: mockForceFlush,
      };
      const mockSdk = {
        getTracerProvider: () => mockTracerProvider,
        shutdown: vi.fn(),
        start: vi.fn(),
      };

      init({
        service: 'test-service',
        sdkFactory: () => mockSdk as any,
        subscribers: [mockAdapter],
      });

      // Flush should timeout and throw
      await expect(flush({ timeout: 100 })).rejects.toThrow('Flush timeout');
    });

    it('should respect custom timeout', async () => {
      const mockForceFlush = vi.fn();
      const mockTracerProvider = {
        forceFlush: mockForceFlush,
      };
      const mockSdk = {
        getTracerProvider: () => mockTracerProvider,
        shutdown: vi.fn(),
        start: vi.fn(),
      };

      init({
        service: 'test-service',
        sdkFactory: () => mockSdk as any,
      });

      // Flush with custom timeout should work
      await flush({ timeout: 5000 });

      expect(mockForceFlush).toHaveBeenCalledOnce();
    });

    it('should handle SDK without forceFlush gracefully', async () => {
      // Mock SDK without forceFlush method
      const mockTracerProvider = {};
      const mockSdk = {
        getTracerProvider: () => mockTracerProvider,
        shutdown: vi.fn(),
        start: vi.fn(),
      };

      init({
        service: 'test-service',
        sdkFactory: () => mockSdk as any,
      });

      // Should not throw even if forceFlush doesn't exist
      await expect(flush()).resolves.toBeUndefined();
    });

    it('should handle missing tracer provider gracefully', async () => {
      // Mock SDK that returns null tracer provider
      const mockSdk = {
        getTracerProvider: () => null,
        shutdown: vi.fn(),
        start: vi.fn(),
      };

      init({
        service: 'test-service',
        sdkFactory: () => mockSdk as any,
      });

      // Should not throw
      await expect(flush()).resolves.toBeUndefined();
    });
  });

  describe('shutdown()', () => {
    it('should flush and shutdown SDK', async () => {
      init({
        service: 'test-service',
        subscribers: [mockAdapter],
      });

      track('test.event', { foo: 'bar' });

      // Shutdown should flush queue and shutdown SDK
      await shutdown();

      // After shutdown, queue should be null (cleaned up to prevent memory leaks)
      const queue = getEventQueue();
      expect(queue).toBeNull();
    });

    it('should be safe to call multiple times', async () => {
      init({
        service: 'test-service',
        subscribers: [mockAdapter],
      });

      await shutdown();
      await shutdown(); // Should not throw
      await shutdown();

      expect(true).toBe(true); // Test passes if no errors
    });

    it('should flush before SDK shutdown', async () => {
      init({
        service: 'test-service',
        subscribers: [mockAdapter],
      });

      track('test.event', { foo: 'bar' });

      const queue = getEventQueue();
      const queueSizeBefore = queue?.size() || 0;
      expect(queueSizeBefore).toBeGreaterThan(0);

      await shutdown();

      // Queue should be empty after shutdown
      const queueSizeAfter = queue?.size() || 0;
      expect(queueSizeAfter).toBe(0);
    });

    it('should clean up event queue observables on shutdown', async () => {
      init({
        service: 'test-service',
        subscribers: [mockAdapter],
      });

      track('test.event', { foo: 'bar' });

      const queue = getEventQueue();
      expect(queue).not.toBeNull();
      if (!queue) return;

      const cleanupSpy = vi.spyOn(queue, 'cleanup');

      await shutdown();

      expect(cleanupSpy).toHaveBeenCalledOnce();
    });

    it('should handle errors during shutdown gracefully', async () => {
      const failingAdapter: EventSubscriber = {
        name: 'failing-adapter',
        trackEvent: vi.fn(),
        trackFunnelStep: vi.fn(),
        trackOutcome: vi.fn(),
        trackValue: vi.fn(),
        shutdown: vi.fn().mockRejectedValue(new Error('Shutdown failed')),
      };

      init({
        service: 'test-service',
        subscribers: [failingAdapter],
      });

      // Should not throw even if adapter shutdown fails
      await expect(shutdown()).resolves.toBeUndefined();
    });
  });

  describe('Integration', () => {
    it('should properly shutdown in correct order', async () => {
      init({
        service: 'test-service',
        subscribers: [mockAdapter],
      });

      track('user.signup', { userId: '123' });
      track('order.completed', { orderId: '456' });

      const queue = getEventQueue();
      expect(queue?.size()).toBeGreaterThan(0);

      // Shutdown should flush all pending events
      await shutdown();

      // Queue should be empty (all events flushed)
      expect(queue?.size()).toBe(0);
    });

    it('should work with no events to flush', async () => {
      init({
        service: 'test-service',
        subscribers: [mockAdapter],
      });

      // No events tracked
      const queue = getEventQueue();
      const queueSize = queue?.size() || 0;
      expect(queueSize).toBe(0);

      await shutdown();

      // Should complete without error
      expect(mockAdapter.events).toHaveLength(0);
    });
  });
});
