import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebhookSubscriber } from './webhook';

globalThis.fetch = vi.fn();

describe('WebhookSubscriber', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
    });
  });

  it('sends event payload to webhook', async () => {
    const subscriber = new WebhookSubscriber({
      url: 'https://hooks.example.com/webhook',
    });

    await subscriber.trackEvent('order.completed', {
      userId: 'user-123',
      amount: 99.99,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://hooks.example.com/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('order.completed'),
      }),
    );
  });

  it('includes custom headers and method', async () => {
    const subscriber = new WebhookSubscriber({
      url: 'https://hooks.example.com/webhook',
      method: 'PUT',
      headers: { 'X-API-Key': 'secret' },
    });

    await subscriber.trackEvent('order.completed', { userId: 'user-123' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://hooks.example.com/webhook',
      expect.objectContaining({
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'secret',
        },
      }),
    );
  });

  it('does nothing when disabled', async () => {
    const subscriber = new WebhookSubscriber({
      url: 'https://hooks.example.com/webhook',
      enabled: false,
    });

    await subscriber.trackEvent('order.completed', { userId: 'user-123' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('retries network failures', async () => {
    (globalThis.fetch as any)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '',
      });

    const subscriber = new WebhookSubscriber({
      url: 'https://hooks.example.com/webhook',
      maxRetries: 3,
      retryDelayMs: 1,
    });

    await subscriber.trackEvent('order.completed', { userId: 'user-123' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retriable http status', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'no auth',
    });

    const subscriber = new WebhookSubscriber({
      url: 'https://hooks.example.com/webhook',
      maxRetries: 3,
      retryDelayMs: 1,
    });

    await expect(
      subscriber.trackEvent('order.completed', { userId: 'user-123' }),
    ).rejects.toThrow('Webhook returned 401: Unauthorized');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries retriable http status', async () => {
    (globalThis.fetch as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => 'down',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '',
      });

    const subscriber = new WebhookSubscriber({
      url: 'https://hooks.example.com/webhook',
      maxRetries: 2,
      retryDelayMs: 1,
    });

    await subscriber.trackEvent('order.completed', { userId: 'user-123' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('shutdown waits for pending requests', async () => {
    const subscriber = new WebhookSubscriber({
      url: 'https://hooks.example.com/webhook',
    });

    const first = subscriber.trackEvent('order.completed', { userId: 'user-1' });
    const second = subscriber.trackEvent('order.completed', { userId: 'user-2' });

    await subscriber.shutdown();
    await Promise.all([first, second]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
