import { describe, it, expect, vi } from 'vitest';

describe('PostHogSubscriber redactPaths', () => {
  it('redacts known sensitive paths in event properties', async () => {
    const mockCapture = vi.fn();
    const { PostHogSubscriber } = await import('./posthog');

    const subscriber = new PostHogSubscriber({
      client: {
        capture: mockCapture,
        shutdown: vi.fn(() => Promise.resolve()),
        on: vi.fn(),
      } as any,
      redactPaths: ['user.password', 'headers.authorization'],
    });

    await subscriber.trackEvent('test.event', {
      userId: 'user-123',
      user: { password: 'secret123', name: 'John' },
      headers: { authorization: 'Bearer token123', contentType: 'json' },
    } as any);

    const captured = mockCapture.mock.calls[0][0];
    expect(captured.properties.user.password).toBe('[REDACTED]');
    expect(captured.properties.user.name).toBe('John');
    expect(captured.properties.headers.authorization).toBe('[REDACTED]');
    expect(captured.properties.headers.contentType).toBe('json');
  });

  it('works without redactPaths (backwards compatible)', async () => {
    const mockCapture = vi.fn();
    const { PostHogSubscriber } = await import('./posthog');

    const subscriber = new PostHogSubscriber({
      client: {
        capture: mockCapture,
        shutdown: vi.fn(() => Promise.resolve()),
        on: vi.fn(),
      } as any,
    });

    await subscriber.trackEvent('test.event', {
      userId: 'user-123',
      password: 'secret123',
    } as any);

    const captured = mockCapture.mock.calls[0][0];
    expect(captured.properties.password).toBe('secret123');
  });
});

describe('PostHogSubscriber setStringRedactor', () => {
  it('exposes a setStringRedactor method', async () => {
    const { PostHogSubscriber } = await import('./posthog');

    const subscriber = new PostHogSubscriber({
      client: {
        capture: vi.fn(),
        shutdown: vi.fn(() => Promise.resolve()),
        on: vi.fn(),
      } as any,
    });

    expect(typeof subscriber.setStringRedactor).toBe('function');
  });

  it('applies redactor set via setStringRedactor to event properties', async () => {
    const mockCapture = vi.fn();
    const { PostHogSubscriber } = await import('./posthog');

    const subscriber = new PostHogSubscriber({
      client: {
        capture: mockCapture,
        shutdown: vi.fn(() => Promise.resolve()),
        on: vi.fn(),
      } as any,
    });

    // Set redactor after construction (simulates init() wiring)
    subscriber.setStringRedactor((value: string) =>
      value.replaceAll(/secret/gi, '[REDACTED]'),
    );

    await subscriber.trackEvent('test.event', {
      userId: 'user-123',
      message: 'This is a secret value',
    } as any);

    const captured = mockCapture.mock.calls[0][0];
    expect(captured.properties.message).toBe('This is a [REDACTED] value');
  });
});

describe('PostHogSubscriber stringRedactor', () => {
  it('applies string redactor to string attribute values', async () => {
    const mockCapture = vi.fn();
    const { PostHogSubscriber } = await import('./posthog');

    const mockRedactor = (value: string) =>
      value.replaceAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi, '[REDACTED]');

    const subscriber = new PostHogSubscriber({
      client: {
        capture: mockCapture,
        shutdown: vi.fn(() => Promise.resolve()),
        on: vi.fn(),
      } as any,
      stringRedactor: mockRedactor,
    });

    await subscriber.trackEvent('test.event', {
      userId: 'user-123',
      message: 'Contact john@example.com for help',
    } as any);

    const captured = mockCapture.mock.calls[0][0];
    expect(captured.properties.message).toBe('Contact [REDACTED] for help');
  });

  it('redacts string values nested inside arrays', async () => {
    const mockCapture = vi.fn();
    const { PostHogSubscriber } = await import('./posthog');

    const subscriber = new PostHogSubscriber({
      client: {
        capture: mockCapture,
        shutdown: vi.fn(() => Promise.resolve()),
        on: vi.fn(),
      } as any,
      stringRedactor: (value: string) => value.replaceAll(/secret/gi, '[REDACTED]'),
    });

    await subscriber.trackEvent('test.event', {
      userId: 'user-123',
      tags: ['public', 'secret'],
      nested: [{ note: 'secret' }],
    } as any);

    const captured = mockCapture.mock.calls[0][0];
    expect(captured.properties.tags).toEqual(['public', '[REDACTED]']);
    expect(captured.properties.nested).toEqual([{ note: '[REDACTED]' }]);
  });
});
