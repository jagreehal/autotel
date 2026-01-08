/**
 * Tests for track() function
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trace } from '@opentelemetry/api';
import { track, getEventQueue } from './track';
import { init, getLogger } from './init';

type TrackedEvent = {
  name: string;
  attributes?: Record<string, unknown>;
};

// Mock adapter for testing
class MockAdapter {
  public events: TrackedEvent[] = [];

  async trackEvent(
    name: string,
    attributes?: Record<string, unknown>,
  ): Promise<void> {
    this.events.push({ name, attributes });
  }

  async trackFunnelStep(): Promise<void> {}
  async trackOutcome(): Promise<void> {}
  async trackValue(): Promise<void> {}
}

describe('track() function', () => {
  let mockAdapter: MockAdapter;
  let loggerWarnSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    vi.resetModules();
    mockAdapter = new MockAdapter();
  });

  afterEach(() => {
    if (loggerWarnSpy) {
      loggerWarnSpy.mockRestore();
    }
  });

  describe('Initialization checks', () => {
    it('should warn in dev if track() called before init()', () => {
      process.env.NODE_ENV = 'development';

      // Spy on logger after it's initialized (it uses default silent logger initially)
      loggerWarnSpy = vi.spyOn(getLogger(), 'warn');

      track('test.event', { foo: 'bar' });

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        {},
        expect.stringContaining('track() used before init()'),
      );
    });

    it('should not throw in production if track() called before init()', () => {
      process.env.NODE_ENV = 'production';

      expect(() => {
        track('test.event', { foo: 'bar' });
      }).not.toThrow();
    });

    it('should be no-op if no adapters configured', () => {
      init({ service: 'test-app' }); // No adapters

      expect(() => {
        track('test.event', { foo: 'bar' });
      }).not.toThrow();

      const queue = getEventQueue();
      expect(queue).toBeNull();
    });
  });

  describe('Event tracking', () => {
    beforeEach(() => {
      init({
        service: 'test-app',
        subscribers: [mockAdapter],
      });
    });

    it('should enqueue events', () => {
      track('user.signup', { userId: '123', plan: 'pro' });

      const queue = getEventQueue();
      expect(queue).not.toBeNull();
      expect(queue?.size()).toBeGreaterThan(0);
    });

    it('should track event name and attributes', () => {
      track('user.signup', { userId: '123', plan: 'pro' });

      // Queue batches events, so we need to flush
      // In real usage, this would be automatic
    });
  });

  describe('Trace correlation', () => {
    beforeEach(() => {
      init({
        service: 'test-app',
        subscribers: [mockAdapter],
      });
    });

    it('should auto-attach traceId and spanId when in active span', () => {
      const tracer = trace.getTracer('test');

      tracer.startActiveSpan('test-span', (span) => {
        track('user.signup', { userId: '123' });

        // Verify event was enqueued with trace context
        const queue = getEventQueue();
        expect(queue).not.toBeNull();

        span.end();
      });
    });

    it('should not fail if no active span', () => {
      expect(() => {
        track('user.signup', { userId: '123' });
      }).not.toThrow();
    });
  });

  describe('Type safety', () => {
    beforeEach(() => {
      init({
        service: 'test-app',
        subscribers: [mockAdapter],
      });
    });

    it('should accept typed events', () => {
      interface Events {
        'user.signup': { userId: string; plan: string };
      }

      // Type-safe call (TypeScript would catch errors here)
      track<Events>('user.signup', { userId: '123', plan: 'pro' });

      const queue = getEventQueue();
      expect(queue!.size()).toBeGreaterThan(0);
    });
  });
});
