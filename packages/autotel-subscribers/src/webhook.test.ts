import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebhookSubscriber } from './webhook';

// Mock fetch globally
globalThis.fetch = vi.fn();

describe('WebhookSubscriber', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });
  });

  describe('initialization', () => {
    it('should initialize with valid config', () => {
      const adapter = new WebhookSubscriber({
        url: 'https://hooks.example.com/webhook',
      });

      expect(adapter).toBeDefined();
    });

    it('should initialize with custom headers', () => {
      const adapter = new WebhookSubscriber({
        url: 'https://hooks.example.com/webhook',
        headers: { 'X-API-Key': 'secret' },
      });

      expect(adapter).toBeDefined();
    });

    it('should not send when disabled', () => {
      const adapter = new WebhookSubscriber({
        url: 'https://hooks.example.com/webhook',
        enabled: false,
      });

      expect(adapter).toBeDefined();
    });
  });

  describe('trackEvent', () => {
    it('should send event to webhook', async () => {
      const adapter = new WebhookSubscriber({
        url: 'https://hooks.example.com/webhook',
      });

      adapter.trackEvent('order.completed', {
        userId: 'user-123',
        amount: 99.99,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://hooks.example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: expect.stringContaining('order.completed'),
        }),
      );
    });

    it('should include custom headers', async () => {
      const adapter = new WebhookSubscriber({
        url: 'https://hooks.example.com/webhook',
        headers: { 'X-API-Key': 'secret' },
      });

      adapter.trackEvent('order.completed', { userId: 'user-123' });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://hooks.example.com/webhook',
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'secret',
          },
        }),
      );
    });

    it('should not send when disabled', async () => {
      const adapter = new WebhookSubscriber({
        url: 'https://hooks.example.com/webhook',
        enabled: false,
      });

      adapter.trackEvent('order.completed', { userId: 'user-123' });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  describe('trackFunnelStep', () => {
    it('should send funnel step to webhook', async () => {
      const adapter = new WebhookSubscriber({
        url: 'https://hooks.example.com/webhook',
      });

      adapter.trackFunnelStep('checkout', 'started', {
        userId: 'user-123',
        cartValue: 150,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://hooks.example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('funnel'),
        }),
      );

      const callBody = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
      expect(callBody).toMatchObject({
        type: 'funnel',
        funnel: 'checkout',
        step: 'started',
      });
    });
  });

  describe('trackOutcome', () => {
    it('should send outcome to webhook', async () => {
      const adapter = new WebhookSubscriber({
        url: 'https://hooks.example.com/webhook',
      });

      adapter.trackOutcome('payment.processing', 'success', {
        userId: 'user-123',
        transactionId: 'txn-789',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://hooks.example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('outcome'),
        }),
      );

      const callBody = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
      expect(callBody).toMatchObject({
        type: 'outcome',
        operation: 'payment.processing',
        outcome: 'success',
      });
    });
  });

  describe('trackValue', () => {
    it('should send value to webhook', async () => {
      const adapter = new WebhookSubscriber({
        url: 'https://hooks.example.com/webhook',
      });

      adapter.trackValue('revenue', 99.99, {
        userId: 'user-123',
        currency: 'USD',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://hooks.example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('value'),
        }),
      );

      const callBody = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
      expect(callBody).toMatchObject({
        type: 'value',
        name: 'revenue',
        value: 99.99,
      });
    });
  });

  describe('retry logic', () => {
    it(
      'should retry on failure',
      async () => {
        (globalThis.fetch as any)
          .mockRejectedValueOnce(new Error('Network error'))
          .mockRejectedValueOnce(new Error('Network error'))
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            statusText: 'OK',
          });

        const adapter = new WebhookSubscriber({
          url: 'https://hooks.example.com/webhook',
          maxRetries: 3,
        });

        adapter.trackEvent('order.completed', { userId: 'user-123' });

        await new Promise((resolve) => setTimeout(resolve, 5000));

        expect(globalThis.fetch).toHaveBeenCalledTimes(3);
      },
      10_000,
    );

    it(
      'should respect maxRetries setting',
      async () => {
        (globalThis.fetch as any).mockRejectedValue(new Error('Network error'));

        const adapter = new WebhookSubscriber({
          url: 'https://hooks.example.com/webhook',
          maxRetries: 2,
        });

        adapter.trackEvent('order.completed', { userId: 'user-123' });

        await new Promise((resolve) => setTimeout(resolve, 5000));

        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      },
      10_000,
    );
  });

  describe('shutdown', () => {
    it('should wait for pending requests', async () => {
      const adapter = new WebhookSubscriber({
        url: 'https://hooks.example.com/webhook',
      });

      adapter.trackEvent('order.completed', { userId: 'user-123' });
      adapter.trackEvent('order.completed', { userId: 'user-456' });

      await adapter.shutdown();

      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('should not throw when no pending requests', async () => {
      const adapter = new WebhookSubscriber({
        url: 'https://hooks.example.com/webhook',
      });

      await expect(adapter.shutdown()).resolves.not.toThrow();
    });
  });
});
