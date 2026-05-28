import { describe, expect, it, vi } from 'vitest';
import { useLogger, withAutotelFetch } from './cloudflare';

describe('cloudflare adapter', () => {
  it('throws clear error when useLogger is called outside traced context', () => {
    expect(() =>
      useLogger({
        method: 'GET',
        url: 'https://example.com/health',
        headers: { 'x-request-id': 'req-1' },
      }),
    ).toThrow('[autotel-adapters/cloudflare] No active trace context.');
  });

  it('provides request-scoped logger inside withAutotelFetch()', async () => {
    const handler = withAutotelFetch(async (request) => {
      const log = useLogger(request);
      log.set({ worker: 'example' });
      return { ok: true };
    });

    await expect(
      handler(
        { method: 'GET', url: 'https://example.com/orders' },
        {},
        {},
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  it('auto-emits one wide event by default', async () => {
    const onEmit = vi.fn();
    const handler = withAutotelFetch(
      async (request) => {
        useLogger(request).set({ worker: 'example' });
        return { ok: true };
      },
      { requestLoggerOptions: { onEmit } },
    );

    await handler({ method: 'GET', url: 'https://example.com/orders' }, {}, {});
    expect(onEmit).toHaveBeenCalledTimes(1);
  });

  it('does not emit when autoEmit is false', async () => {
    const onEmit = vi.fn();
    const handler = withAutotelFetch(async () => ({ ok: true }), {
      autoEmit: false,
      requestLoggerOptions: { onEmit },
    });

    await handler({ method: 'GET', url: 'https://example.com/x' }, {}, {});
    expect(onEmit).not.toHaveBeenCalled();
  });
});

