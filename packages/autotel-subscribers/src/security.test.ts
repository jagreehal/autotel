import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SecuritySubscriber, type SecurityAlert } from './security';

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as never;

describe('SecuritySubscriber', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    });
  });

  it('forwards security events at or above minSeverity to the webhook', async () => {
    const subscriber = new SecuritySubscriber({
      webhookUrl: 'https://siem.example.com/alerts',
      minSeverity: 'warning',
    });

    await subscriber.trackEvent('security.auth.login.failed', {
      category: 'authentication',
      outcome: 'failure',
      severity: 'warning',
      reason: 'invalid_password',
      actorId: 'abc123',
    });
    await subscriber.shutdown();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://siem.example.com/alerts');

    const body = JSON.parse(init.body as string) as SecurityAlert;
    expect(body).toMatchObject({
      event: 'security.auth.login.failed',
      severity: 'warning',
      category: 'authentication',
      outcome: 'failure',
      reason: 'invalid_password',
      attributes: { actorId: 'abc123' },
    });
    expect(body.timestamp).toBeTruthy();
  });

  it('drops events below minSeverity', async () => {
    const subscriber = new SecuritySubscriber({
      webhookUrl: 'https://siem.example.com/alerts',
      minSeverity: 'error',
    });

    await subscriber.trackEvent('security.auth.login.failed', {
      severity: 'warning',
    });
    await subscriber.shutdown();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores non-security events', async () => {
    const subscriber = new SecuritySubscriber({
      webhookUrl: 'https://siem.example.com/alerts',
      minSeverity: 'info',
    });

    await subscriber.trackEvent('order.completed', { severity: 'critical' });
    await subscriber.shutdown();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats missing severity as info', async () => {
    const subscriber = new SecuritySubscriber({
      webhookUrl: 'https://siem.example.com/alerts',
      minSeverity: 'warning',
    });

    await subscriber.trackEvent('security.config.changed', {});
    await subscriber.shutdown();

    expect(fetchMock).not.toHaveBeenCalled(); // info < warning
  });

  it('prefers the custom handler over the webhook', async () => {
    const handler = vi.fn();
    const subscriber = new SecuritySubscriber({
      webhookUrl: 'https://siem.example.com/alerts',
      handler,
      minSeverity: 'info',
    });

    await subscriber.trackEvent('security.api_key.created', {
      severity: 'info',
      category: 'secrets',
    });
    await subscriber.shutdown();

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'security.api_key.created',
        category: 'secrets',
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('applies the custom filter after the severity gate', async () => {
    const subscriber = new SecuritySubscriber({
      webhookUrl: 'https://siem.example.com/alerts',
      minSeverity: 'info',
      filter: (payload) => payload.attributes?.tenantId !== 'internal',
    });

    await subscriber.trackEvent('security.access.denied', {
      severity: 'warning',
      tenantId: 'internal',
    });
    await subscriber.trackEvent('security.access.denied', {
      severity: 'warning',
      tenantId: 'customer-1',
    });
    await subscriber.shutdown();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends custom headers', async () => {
    const subscriber = new SecuritySubscriber({
      webhookUrl: 'https://siem.example.com/alerts',
      headers: { Authorization: 'Bearer test-token' },
      minSeverity: 'info',
    });

    await subscriber.trackEvent('security.rate_limit.exceeded', {
      severity: 'warning',
    });
    await subscriber.shutdown();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    });
  });

  it('disables itself without a destination', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const subscriber = new SecuritySubscriber({});
    await subscriber.trackEvent('security.access.denied', {
      severity: 'critical',
    });
    await subscriber.shutdown();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('No webhookUrl or handler'),
    );
    consoleError.mockRestore();
  });

  it('routes webhook failures through handleError without throwing', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'boom',
    });

    const subscriber = new SecuritySubscriber({
      webhookUrl: 'https://siem.example.com/alerts',
      minSeverity: 'info',
      maxRetries: 2,
      retryDelayMs: 1,
    });

    await expect(
      subscriber.trackEvent('security.webhook.signature.failed', {
        severity: 'error',
      }),
    ).resolves.toBeUndefined();
    await subscriber.shutdown();

    expect(fetchMock).toHaveBeenCalledTimes(2); // retriable 500 → retried
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('retries retriable failures and delivers on a later attempt', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
      });

    const subscriber = new SecuritySubscriber({
      webhookUrl: 'https://siem.example.com/alerts',
      minSeverity: 'info',
      maxRetries: 3,
      retryDelayMs: 1,
    });

    await subscriber.trackEvent('security.access.denied', {
      severity: 'critical',
    });
    await subscriber.shutdown();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retriable failures', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => '',
    });

    const subscriber = new SecuritySubscriber({
      webhookUrl: 'https://siem.example.com/alerts',
      minSeverity: 'info',
      maxRetries: 3,
      retryDelayMs: 1,
    });

    await subscriber.trackEvent('security.access.denied', {
      severity: 'critical',
    });
    await subscriber.shutdown();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
