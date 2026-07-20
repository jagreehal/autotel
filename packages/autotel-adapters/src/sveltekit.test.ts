import { describe, expect, it, vi } from 'vitest';
import { autotelHandle, useLogger } from './sveltekit';

describe('sveltekit adapter', () => {
  it('throws clear error when useLogger is called outside traced context', () => {
    expect(() => useLogger()).toThrow(
      'Register autotelHandle() in hooks.server.ts first.',
    );
  });

  it('provides request-scoped logger inside autotelHandle()', async () => {
    const handle = autotelHandle();
    const event = {
      request: new Request('https://example.com/orders', { method: 'GET' }),
      url: new URL('https://example.com/orders'),
      route: { id: '/orders' },
      locals: {},
    };

    await handle({
      event,
      resolve: async () => {
        const log = useLogger();
        log.set({ feature: 'checkout' });
        return new Response('ok');
      },
    });
  });

  it('auto-emits one wide event by default', async () => {
    const onEmit = vi.fn();
    const handle = autotelHandle({ requestLoggerOptions: { onEmit } });
    const event = {
      request: new Request('https://example.com/orders', { method: 'GET' }),
      url: new URL('https://example.com/orders'),
      locals: {},
    };

    await handle({
      event,
      resolve: async () => new Response('ok'),
    });

    expect(onEmit).toHaveBeenCalledTimes(1);
  });
});
