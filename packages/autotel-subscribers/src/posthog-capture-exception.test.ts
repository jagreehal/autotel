import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockCapture = vi.fn();
const mockShutdown = vi.fn(() => Promise.resolve());

vi.mock('posthog-node', () => ({
  PostHog: vi.fn(function (this: any) {
    this.capture = mockCapture;
    this.shutdown = mockShutdown;
    this.debug = vi.fn();
    this.on = vi.fn();
  }),
}));

import 'posthog-node';
import { PostHogSubscriber } from './posthog';

describe('PostHogSubscriber.captureException', () => {
  let subscriber: PostHogSubscriber;

  beforeEach(async () => {
    vi.clearAllMocks();
    subscriber = new PostHogSubscriber({ apiKey: 'phc_test' });
    await new Promise((r) => setTimeout(r, 50));
  });

  it('sends $exception event via capture API', async () => {
    await subscriber.captureException(new TypeError('test error'), {
      distinctId: 'user-123',
    });

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: 'user-123',
        event: '$exception',
        properties: expect.objectContaining({
          $exception_list: expect.any(Array),
        }),
      }),
    );
  });

  it('uses anonymous distinctId when not provided', async () => {
    await subscriber.captureException(new Error('test'));

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: 'anonymous',
      }),
    );
  });

  it('includes additional properties', async () => {
    await subscriber.captureException(new Error('test'), {
      distinctId: 'user-1',
      additionalProperties: { page: '/checkout' },
    });

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          page: '/checkout',
        }),
      }),
    );
  });

  it('applies the configured string redactor to captured exception payloads', async () => {
    const redactingSubscriber = new PostHogSubscriber({
      apiKey: 'phc_test',
      stringRedactor: (value: string) => value.replaceAll(/secret-\w+/g, '[REDACTED]'),
    });
    await new Promise((r) => setTimeout(r, 50));

    await redactingSubscriber.captureException(new Error('failed with secret-token'));

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          $exception_list: [
            expect.objectContaining({
              value: 'failed with [REDACTED]',
            }),
          ],
        }),
      }),
    );
  });

  it('redacts additionalProperties passed to captureException', async () => {
    const redactingSubscriber = new PostHogSubscriber({
      apiKey: 'phc_test',
      stringRedactor: (value: string) => value.replaceAll(/secret-\w+/g, '[REDACTED]'),
    });
    await new Promise((r) => setTimeout(r, 50));

    await redactingSubscriber.captureException(new Error('boom'), {
      additionalProperties: {
        note: 'token secret-abc123',
        nested: { detail: 'secret-def456' },
      },
    });

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          note: 'token [REDACTED]',
          nested: { detail: '[REDACTED]' },
        }),
      }),
    );
  });

  it('redacts browser-client additionalProperties before delegating to window.posthog', async () => {
    const browserCaptureException = vi.fn();
    (globalThis as any).posthog = {
      captureException: browserCaptureException,
    };

    const subscriber = new PostHogSubscriber({
      useGlobalClient: true,
      stringRedactor: (value: string) => value.replaceAll(/secret-\w+/g, '[REDACTED]'),
    });
    await new Promise((r) => setTimeout(r, 50));

    await subscriber.captureException(new Error('boom'), {
      additionalProperties: {
        note: 'token secret-browser',
      },
    });

    expect(browserCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        note: 'token [REDACTED]',
      }),
    );

    delete (globalThis as any).posthog;
  });

  it('does not throw when disabled', async () => {
    const disabled = new PostHogSubscriber({ apiKey: 'phc_test', enabled: false });
    await expect(disabled.captureException(new Error('test'))).resolves.not.toThrow();
  });
});
