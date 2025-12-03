import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostHogSubscriber } from './posthog';
import type { PostHog } from 'posthog-node';

// Mock the posthog-node module
const mockCapture = vi.fn();
const mockShutdown = vi.fn(() => Promise.resolve());
const mockIsFeatureEnabled = vi.fn();
const mockGetFeatureFlag = vi.fn();
const mockGetAllFlags = vi.fn();
const mockReloadFeatureFlags = vi.fn();
const mockIdentify = vi.fn();
const mockGroupIdentify = vi.fn();
const mockDebug = vi.fn();
const mockOn = vi.fn();

vi.mock('posthog-node', () => ({
  PostHog: vi.fn(function (this: any) {
    this.capture = mockCapture;
    this.shutdown = mockShutdown;
    this.isFeatureEnabled = mockIsFeatureEnabled;
    this.getFeatureFlag = mockGetFeatureFlag;
    this.getAllFlags = mockGetAllFlags;
    this.reloadFeatureFlags = mockReloadFeatureFlags;
    this.identify = mockIdentify;
    this.groupIdentify = mockGroupIdentify;
    this.debug = mockDebug;
    this.on = mockOn;
  }),
}));

describe('PostHogSubscriber', () => {
  beforeEach(() => {
    mockCapture.mockClear();
    mockShutdown.mockClear();
    mockIsFeatureEnabled.mockClear();
    mockGetFeatureFlag.mockClear();
    mockGetAllFlags.mockClear();
    mockReloadFeatureFlags.mockClear();
    mockIdentify.mockClear();
    mockGroupIdentify.mockClear();
    mockDebug.mockClear();
    mockOn.mockClear();
  });

  describe('initialization', () => {
    it('should initialize with valid config', async () => {
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
        host: 'https://us.i.posthog.com',
      });

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(adapter).toBeDefined();
    });

    it('should initialize with default host', async () => {
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(adapter).toBeDefined();
    });

    it('should not initialize when disabled', () => {
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
        enabled: false,
      });

      expect(adapter).toBeDefined();
    });

    it('should accept custom PostHog client', async () => {
      const customClient = {
        capture: mockCapture,
        shutdown: mockShutdown,
      } as unknown as PostHog;

      const adapter = new PostHogSubscriber({
        client: customClient,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(adapter).toBeDefined();
    });

    it('should throw if no apiKey and no client provided', () => {
      expect(() => new PostHogSubscriber({})).toThrow(
        'PostHogSubscriber requires either apiKey, client, or useGlobalClient to be provided',
      );
    });

    it('should setup error handling when onError is provided', async () => {
      const onError = vi.fn();
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
        onError,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(adapter).toBeDefined();
      expect(mockOn).toHaveBeenCalledWith('error', onError);
    });

    it('should enable debug mode when debug is true', async () => {
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
        debug: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(adapter).toBeDefined();
      expect(mockDebug).toHaveBeenCalled();
    });

    it('should pass serverless config options', async () => {
      const { PostHog } = await import('posthog-node');

      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
        flushAt: 1,
        flushInterval: 0,
        disableGeoip: true,
        requestTimeout: 5000,
        sendFeatureFlags: false,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(adapter).toBeDefined();
      expect(PostHog).toHaveBeenCalledWith('phc_test_key', {
        host: 'https://us.i.posthog.com',
        flushAt: 1,
        flushInterval: 0,
        disableGeoip: true,
        requestTimeout: 5000,
        sendFeatureFlagEvent: false,
      });
    });
  });

  describe('trackEvent', () => {
    it('should track event with attributes', async () => {
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.trackEvent('order.completed', {
        userId: 'user-123',
        amount: 99.99,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockCapture).toHaveBeenCalledWith({
        distinctId: 'user-123',
        event: 'order.completed',
        properties: {
          userId: 'user-123',
          amount: 99.99,
        },
      });
    });

    it('should use user_id if userId is not present', async () => {
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.trackEvent('order.completed', {
        user_id: 'user-456',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockCapture).toHaveBeenCalledWith({
        distinctId: 'user-456',
        event: 'order.completed',
        properties: {
          user_id: 'user-456',
        },
      });
    });

    it('should use anonymous if no userId is present', async () => {
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.trackEvent('page.viewed');

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockCapture).toHaveBeenCalledWith({
        distinctId: 'anonymous',
        event: 'page.viewed',
        properties: {}, // Empty object due to automatic undefined/null filtering
      });
    });

    it('should not track when disabled', async () => {
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
        enabled: false,
      });

      await adapter.trackEvent('order.completed', { userId: 'user-123' });

      // Should not call capture
      expect(mockCapture).not.toHaveBeenCalled();
    });

    it('should include groups in capture payload', async () => {
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.trackEvent('feature.used', {
        userId: 'user-123',
        groups: { company: 'acme-corp' } as any,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockCapture).toHaveBeenCalledWith({
        distinctId: 'user-123',
        event: 'feature.used',
        properties: {
          userId: 'user-123',
          groups: { company: 'acme-corp' },
        },
        groups: { company: 'acme-corp' },
      });
    });
  });

  describe('trackFunnelStep', () => {
    it('should track funnel step', async () => {
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.trackFunnelStep('checkout', 'started', {
        userId: 'user-123',
        cartValue: 150,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          distinctId: 'user-123',
          event: 'checkout.started',
          properties: expect.objectContaining({
            userId: 'user-123',
            cartValue: 150,
          }),
        }),
      );
    });
  });

  describe('trackOutcome', () => {
    it('should track outcome', async () => {
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.trackOutcome('payment.processing', 'success', {
        userId: 'user-123',
        transactionId: 'txn-789',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          distinctId: 'user-123',
          event: 'payment.processing.success',
          properties: expect.objectContaining({
            userId: 'user-123',
            transactionId: 'txn-789',
          }),
        }),
      );
    });
  });

  describe('trackValue', () => {
    it('should track value', async () => {
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.trackValue('revenue', 99.99, {
        userId: 'user-123',
        currency: 'USD',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          distinctId: 'user-123',
          event: 'revenue',
          properties: expect.objectContaining({
            value: 99.99,
            userId: 'user-123',
            currency: 'USD',
          }),
        }),
      );
    });
  });

  describe('feature flags', () => {
    it('should check if feature is enabled', async () => {
      mockIsFeatureEnabled.mockResolvedValue(true);

      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const isEnabled = await adapter.isFeatureEnabled('new-checkout', 'user-123');

      expect(isEnabled).toBe(true);
      expect(mockIsFeatureEnabled).toHaveBeenCalledWith('new-checkout', 'user-123', undefined);
    });

    it('should check feature with options', async () => {
      mockIsFeatureEnabled.mockResolvedValue(true);

      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const options = {
        groups: { company: 'acme-corp' },
        personProperties: { plan: 'premium' },
      };

      await adapter.isFeatureEnabled('beta-features', 'user-123', options);

      expect(mockIsFeatureEnabled).toHaveBeenCalledWith('beta-features', 'user-123', options);
    });

    it('should return false when feature check fails', async () => {
      mockIsFeatureEnabled.mockRejectedValue(new Error('Network error'));
      const onError = vi.fn();

      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
        onError,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const isEnabled = await adapter.isFeatureEnabled('new-checkout', 'user-123');

      expect(isEnabled).toBe(false);
      expect(onError).toHaveBeenCalled();
    });

    it('should get feature flag value', async () => {
      mockGetFeatureFlag.mockResolvedValue('test-variant');

      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const variant = await adapter.getFeatureFlag('experiment', 'user-123');

      expect(variant).toBe('test-variant');
      expect(mockGetFeatureFlag).toHaveBeenCalledWith('experiment', 'user-123', undefined);
    });

    it('should get all flags', async () => {
      const flags = { 'new-checkout': true, experiment: 'test' };
      mockGetAllFlags.mockResolvedValue(flags);

      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await adapter.getAllFlags('user-123');

      expect(result).toEqual(flags);
      expect(mockGetAllFlags).toHaveBeenCalledWith('user-123', undefined);
    });

    it('should reload feature flags', async () => {
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.reloadFeatureFlags();

      expect(mockReloadFeatureFlags).toHaveBeenCalled();
    });

    it('should not call feature flags when disabled', async () => {
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
        enabled: false,
      });

      const isEnabled = await adapter.isFeatureEnabled('test', 'user-123');
      const variant = await adapter.getFeatureFlag('test', 'user-123');
      const flags = await adapter.getAllFlags('user-123');
      await adapter.reloadFeatureFlags();

      expect(isEnabled).toBe(false);
      expect(variant).toBeUndefined();
      expect(flags).toEqual({});
      expect(mockIsFeatureEnabled).not.toHaveBeenCalled();
      expect(mockGetFeatureFlag).not.toHaveBeenCalled();
      expect(mockGetAllFlags).not.toHaveBeenCalled();
      expect(mockReloadFeatureFlags).not.toHaveBeenCalled();
    });
  });

  describe('person and group events', () => {
    it('should identify user with properties', async () => {
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.identify('user-123', {
        $set: {
          email: 'user@example.com',
          plan: 'premium',
        },
      });

      expect(mockIdentify).toHaveBeenCalledWith({
        distinctId: 'user-123',
        properties: {
          $set: {
            email: 'user@example.com',
            plan: 'premium',
          },
        },
      });
    });

    it('should identify user with $set_once', async () => {
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.identify('user-123', {
        $set_once: {
          signup_date: '2025-01-17',
        },
      });

      expect(mockIdentify).toHaveBeenCalledWith({
        distinctId: 'user-123',
        properties: {
          $set_once: {
            signup_date: '2025-01-17',
          },
        },
      });
    });

    it('should identify group', async () => {
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.groupIdentify('company', 'acme-corp', {
        $set: {
          name: 'Acme Corporation',
          industry: 'saas',
          employees: 500,
        },
      });

      expect(mockGroupIdentify).toHaveBeenCalledWith({
        groupType: 'company',
        groupKey: 'acme-corp',
        properties: {
          $set: {
            name: 'Acme Corporation',
            industry: 'saas',
            employees: 500,
          },
        },
      });
    });

    it('should track event with groups', async () => {
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.trackEventWithGroups(
        'feature.used',
        {
          userId: 'user-123',
          feature: 'events',
        },
        { company: 'acme-corp' },
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockCapture).toHaveBeenCalledWith({
        distinctId: 'user-123',
        event: 'feature.used',
        properties: {
          userId: 'user-123',
          feature: 'events',
          groups: { company: 'acme-corp' },
        },
        groups: { company: 'acme-corp' },
      });
    });

    it('should handle identify errors', async () => {
      mockIdentify.mockImplementation(() => {
        throw new Error('Network error');
      });

      const onError = vi.fn();
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
        onError,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await adapter.identify('user-123', { $set: { email: 'test@example.com' } });

      expect(onError).toHaveBeenCalled();
    });

    it('should not call identify when disabled', async () => {
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
        enabled: false,
      });

      await adapter.identify('user-123', { $set: { email: 'test@example.com' } });
      await adapter.groupIdentify('company', 'acme-corp', {});

      expect(mockIdentify).not.toHaveBeenCalled();
      expect(mockGroupIdentify).not.toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    it('should call shutdown on PostHog instance', async () => {
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      await adapter.shutdown();

      expect(mockShutdown).toHaveBeenCalled();
    });

    it('should not throw when shutting down disabled adapter', async () => {
      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
        enabled: false,
      });

      await expect(adapter.shutdown()).resolves.not.toThrow();
    });

    it('should handle shutdown errors', async () => {
      mockShutdown.mockRejectedValue(new Error('Shutdown error'));
      const onError = vi.fn();

      const adapter = new PostHogSubscriber({
        apiKey: 'phc_test_key',
        onError,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      await adapter.shutdown();

      expect(onError).toHaveBeenCalled();
    });
  });
});
