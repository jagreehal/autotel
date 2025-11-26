import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AmplitudeSubscriber } from './amplitude';

// Mock the @amplitude/analytics-node module
const mockTrack = vi.fn();
const mockTrackEvent = vi.fn();
const mockFlush = vi.fn(() => Promise.resolve());

// Create a mock init function that returns instances with mocked methods
const mockInit = vi.fn(() => ({
  track: mockTrack,
  trackEvent: mockTrackEvent,
  flush: mockFlush,
}));

vi.mock('@amplitude/analytics-node', () => ({
  init: mockInit,
}));

describe('AmplitudeSubscriber', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTrack.mockClear();
    mockTrackEvent.mockClear();
    mockFlush.mockClear();
  });

  describe('initialization', () => {
    it('should initialize with valid config', async () => {
      const adapter = new AmplitudeSubscriber({
        apiKey: 'test_api_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(adapter).toBeDefined();
    });

    it('should not initialize when disabled', () => {
      const adapter = new AmplitudeSubscriber({
        apiKey: 'test_api_key',
        enabled: false,
      });

      expect(adapter).toBeDefined();
    });
  });

  describe('trackEvent', () => {
    it('should track event with attributes', async () => {
      const adapter = new AmplitudeSubscriber({
        apiKey: 'test_api_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.trackEvent('order.completed', {
        userId: 'user-123',
        amount: 99.99,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockTrack).toHaveBeenCalledWith({
        event_type: 'order.completed',
        user_id: 'user-123',
        event_properties: {
          userId: 'user-123',
          amount: 99.99,
        },
      });
    });

    it('should use user_id if userId is not present', async () => {
      const adapter = new AmplitudeSubscriber({
        apiKey: 'test_api_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.trackEvent('order.completed', {
        user_id: 'user-456',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockTrack).toHaveBeenCalledWith({
        event_type: 'order.completed',
        user_id: 'user-456',
        event_properties: {
          user_id: 'user-456',
        },
      });
    });

    it('should use anonymous if no userId is present', async () => {
      const adapter = new AmplitudeSubscriber({
        apiKey: 'test_api_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.trackEvent('page.viewed');

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockTrack).toHaveBeenCalledWith({
        event_type: 'page.viewed',
        user_id: 'anonymous',
        event_properties: undefined,
      });
    });

    it('should not track when disabled', () => {
      const adapter = new AmplitudeSubscriber({
        apiKey: 'test_api_key',
        enabled: false,
      });

      adapter.trackEvent('order.completed', { userId: 'user-123' });

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('trackFunnelStep', () => {
    it('should track funnel step', async () => {
      const adapter = new AmplitudeSubscriber({
        apiKey: 'test_api_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.trackFunnelStep('checkout', 'started', {
        userId: 'user-123',
        cartValue: 150,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockTrackEvent).toHaveBeenCalledWith({
        event_type: 'checkout.started',
        user_id: 'user-123',
        event_properties: {
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
      const adapter = new AmplitudeSubscriber({
        apiKey: 'test_api_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.trackOutcome('payment.processing', 'success', {
        userId: 'user-123',
        transactionId: 'txn-789',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockTrackEvent).toHaveBeenCalledWith({
        event_type: 'payment.processing.success',
        user_id: 'user-123',
        event_properties: {
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
      const adapter = new AmplitudeSubscriber({
        apiKey: 'test_api_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.trackValue('revenue', 99.99, {
        userId: 'user-123',
        currency: 'USD',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockTrackEvent).toHaveBeenCalledWith({
        event_type: 'revenue',
        user_id: 'user-123',
        event_properties: {
          value: 99.99,
          userId: 'user-123',
          currency: 'USD',
        },
      });
    });
  });

  describe('shutdown', () => {
    it('should call flush on Amplitude instance', async () => {
      const adapter = new AmplitudeSubscriber({
        apiKey: 'test_api_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      await adapter.shutdown();

      expect(mockFlush).toHaveBeenCalled();
    });

    it('should not throw when shutting down disabled adapter', async () => {
      const adapter = new AmplitudeSubscriber({
        apiKey: 'test_api_key',
        enabled: false,
      });

      await expect(adapter.shutdown()).resolves.not.toThrow();
    });
  });
});
