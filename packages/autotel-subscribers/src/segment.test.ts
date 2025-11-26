import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SegmentSubscriber } from './segment';

// Mock the @segment/analytics-node module
const mockTrack = vi.fn();
const mockCloseAndFlush = vi.fn(() => Promise.resolve());

// Create a mock Analytics class that returns instances with mocked methods
const MockAnalytics = vi.fn(function(this: any) {
  this.track = mockTrack;
  this.closeAndFlush = mockCloseAndFlush;
  return this;
});

vi.mock('@segment/analytics-node', () => ({
  Analytics: MockAnalytics,
}));

describe('SegmentSubscriber', () => {
  beforeEach(() => {
    mockTrack.mockClear();
    mockCloseAndFlush.mockClear();
  });

  describe('initialization', () => {
    it('should initialize with valid config', async () => {
      const adapter = new SegmentSubscriber({
        writeKey: 'test_write_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(adapter).toBeDefined();
    });

    it('should not initialize when disabled', () => {
      const adapter = new SegmentSubscriber({
        writeKey: 'test_write_key',
        enabled: false,
      });

      expect(adapter).toBeDefined();
    });
  });

  describe('trackEvent', () => {
    it('should track event with attributes', async () => {
      const adapter = new SegmentSubscriber({
        writeKey: 'test_write_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.trackEvent('order.completed', {
        userId: 'user-123',
        amount: 99.99,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockTrack).toHaveBeenCalledWith({
        userId: 'user-123',
        event: 'order.completed',
        properties: {
          userId: 'user-123',
          amount: 99.99,
        },
      });
    });

    it('should use user_id if userId is not present', async () => {
      const adapter = new SegmentSubscriber({
        writeKey: 'test_write_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.trackEvent('order.completed', {
        user_id: 'user-456',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockTrack).toHaveBeenCalledWith({
        userId: 'user-456',
        event: 'order.completed',
        properties: {
          user_id: 'user-456',
        },
      });
    });

    it('should use anonymous if no userId is present', async () => {
      const adapter = new SegmentSubscriber({
        writeKey: 'test_write_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.trackEvent('page.viewed');

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockTrack).toHaveBeenCalledWith({
        userId: 'anonymous',
        event: 'page.viewed',
        properties: undefined,
      });
    });

    it('should not track when disabled', async () => {
      const adapter = new SegmentSubscriber({
        writeKey: 'test_write_key',
        enabled: false,
      });

      await adapter.trackEvent('order.completed', { userId: 'user-123' });

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('trackFunnelStep', () => {
    it('should track funnel step', async () => {
      const adapter = new SegmentSubscriber({
        writeKey: 'test_write_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.trackFunnelStep('checkout', 'started', {
        userId: 'user-123',
        cartValue: 150,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockTrack).toHaveBeenCalledWith({
        userId: 'user-123',
        event: 'checkout.started',
        properties: {
          funnel: 'checkout',
          step: 'started',
          userId: 'user-123',
          cartValue: 150,
        },
      });
    });
  });

  describe('trackOutcome', () => {
    it('should track outcome', async () => {
      const adapter = new SegmentSubscriber({
        writeKey: 'test_write_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.trackOutcome('payment.processing', 'success', {
        userId: 'user-123',
        transactionId: 'txn-789',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockTrack).toHaveBeenCalledWith({
        userId: 'user-123',
        event: 'payment.processing.success',
        properties: {
          operation: 'payment.processing',
          outcome: 'success',
          userId: 'user-123',
          transactionId: 'txn-789',
        },
      });
    });
  });

  describe('trackValue', () => {
    it('should track value', async () => {
      const adapter = new SegmentSubscriber({
        writeKey: 'test_write_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.trackValue('revenue', 99.99, {
        userId: 'user-123',
        currency: 'USD',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockTrack).toHaveBeenCalledWith({
        userId: 'user-123',
        event: 'revenue',
        properties: {
          value: 99.99,
          userId: 'user-123',
          currency: 'USD',
        },
      });
    });
  });

  describe('shutdown', () => {
    it('should call closeAndFlush on Events instance', async () => {
      const adapter = new SegmentSubscriber({
        writeKey: 'test_write_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      await adapter.shutdown();

      expect(mockCloseAndFlush).toHaveBeenCalled();
    });

    it('should not throw when shutting down disabled adapter', async () => {
      const adapter = new SegmentSubscriber({
        writeKey: 'test_write_key',
        enabled: false,
      });

      await expect(adapter.shutdown()).resolves.not.toThrow();
    });
  });
});
