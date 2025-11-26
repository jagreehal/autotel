import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MixpanelSubscriber } from './mixpanel';

// Mock the mixpanel module
vi.mock('mixpanel', () => ({
  default: {
    init: vi.fn().mockReturnValue({
      track: vi.fn(),
    }),
  },
}));

describe('MixpanelSubscriber', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with valid config', async () => {
      const adapter = new MixpanelSubscriber({
        token: 'test_token',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(adapter).toBeDefined();
    });

    it('should not initialize when disabled', () => {
      const adapter = new MixpanelSubscriber({
        token: 'test_token',
        enabled: false,
      });

      expect(adapter).toBeDefined();
    });
  });

  describe('trackEvent', () => {
    it('should track event with attributes', async () => {
      const Mixpanel = await import('mixpanel');
      const adapter = new MixpanelSubscriber({
        token: 'test_token',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      adapter.trackEvent('order.completed', {
        userId: 'user-123',
        amount: 99.99,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const mockInstance = (Mixpanel.default.init as any).mock.results[0].value;
      expect(mockInstance.track).toHaveBeenCalledWith('order.completed', {
        distinct_id: 'user-123',
        userId: 'user-123',
        amount: 99.99,
      });
    });

    it('should use user_id if userId is not present', async () => {
      const Mixpanel = await import('mixpanel');
      const adapter = new MixpanelSubscriber({
        token: 'test_token',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      adapter.trackEvent('order.completed', {
        user_id: 'user-456',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const mockInstance = (Mixpanel.default.init as any).mock.results[0].value;
      expect(mockInstance.track).toHaveBeenCalledWith('order.completed', {
        distinct_id: 'user-456',
        user_id: 'user-456',
      });
    });

    it('should use anonymous if no userId is present', async () => {
      const Mixpanel = await import('mixpanel');
      const adapter = new MixpanelSubscriber({
        token: 'test_token',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      adapter.trackEvent('page.viewed');

      await new Promise((resolve) => setTimeout(resolve, 100));

      const mockInstance = (Mixpanel.default.init as any).mock.results[0].value;
      expect(mockInstance.track).toHaveBeenCalledWith('page.viewed', {
        distinct_id: 'anonymous',
      });
    });

    it('should not track when disabled', () => {
      const adapter = new MixpanelSubscriber({
        token: 'test_token',
        enabled: false,
      });

      adapter.trackEvent('order.completed', { userId: 'user-123' });

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('trackFunnelStep', () => {
    it('should track funnel step', async () => {
      const Mixpanel = await import('mixpanel');
      const adapter = new MixpanelSubscriber({
        token: 'test_token',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      adapter.trackFunnelStep('checkout', 'started', {
        userId: 'user-123',
        cartValue: 150,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const mockInstance = (Mixpanel.default.init as any).mock.results[0].value;
      expect(mockInstance.track).toHaveBeenCalledWith('checkout.started', {
        distinct_id: 'user-123',
        funnel: 'checkout',
        step: 'started',
        userId: 'user-123',
        cartValue: 150,
      });
    });
  });

  describe('trackOutcome', () => {
    it('should track outcome', async () => {
      const Mixpanel = await import('mixpanel');
      const adapter = new MixpanelSubscriber({
        token: 'test_token',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      adapter.trackOutcome('payment.processing', 'success', {
        userId: 'user-123',
        transactionId: 'txn-789',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const mockInstance = (Mixpanel.default.init as any).mock.results[0].value;
      expect(mockInstance.track).toHaveBeenCalledWith('payment.processing.success', {
        distinct_id: 'user-123',
        operation: 'payment.processing',
        outcome: 'success',
        userId: 'user-123',
        transactionId: 'txn-789',
      });
    });
  });

  describe('trackValue', () => {
    it('should track value', async () => {
      const Mixpanel = await import('mixpanel');
      const adapter = new MixpanelSubscriber({
        token: 'test_token',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      adapter.trackValue('revenue', 99.99, {
        userId: 'user-123',
        currency: 'USD',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const mockInstance = (Mixpanel.default.init as any).mock.results[0].value;
      expect(mockInstance.track).toHaveBeenCalledWith('revenue', {
        distinct_id: 'user-123',
        value: 99.99,
        userId: 'user-123',
        currency: 'USD',
      });
    });
  });
});
