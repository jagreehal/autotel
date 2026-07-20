import { describe, expect, it, vi } from 'vitest';
import { useLogger, withAutotelHandler } from './elysia';

describe('elysia adapter', () => {
  it('throws clear error when useLogger is called outside traced context', () => {
    expect(() => useLogger()).toThrow(
      'Wrap handlers with withAutotelHandler() first.',
    );
  });

  it('provides request-scoped logger inside withAutotelHandler()', async () => {
    const handler = withAutotelHandler(async () => {
      const log = useLogger();
      log.set({ feature: 'checkout' });
      return 'ok';
    });

    const ctx = {
      request: new Request('https://example.com/orders', { method: 'GET' }),
      path: '/orders',
      // Real Elysia contexts expose `set` as a response metadata object, not a
      // key/value setter function.
      set: { headers: {}, status: 200 },
    };

    await expect(handler(ctx)).resolves.toBe('ok');
  });

  it('auto-emits one wide event by default', async () => {
    const onEmit = vi.fn();
    const handler = withAutotelHandler(async () => 'ok', {
      requestLoggerOptions: { onEmit },
    });

    const ctx = {
      request: new Request('https://example.com/orders', { method: 'GET' }),
      path: '/orders',
      set: { headers: {}, status: 200 },
    };
    await handler(ctx);

    expect(onEmit).toHaveBeenCalledTimes(1);
  });

  it('binds a no-op logger without tracing excluded routes', async () => {
    const handler = withAutotelHandler(
      async () => {
        expect(useLogger().getContext()).toEqual({});
        return 'skipped';
      },
      { exclude: ['/health'] },
    );

    await expect(
      handler({
        request: new Request('https://example.com/health'),
        path: '/health',
      }),
    ).resolves.toBe('skipped');
  });

  it('keeps deprecated autotel alias', async () => {
    const { autotel } = await import('./elysia');
    expect(autotel).toBe(withAutotelHandler);
  });
});
