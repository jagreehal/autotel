import { describe, expect, it, vi } from 'vitest';
import { useLogger, withAutotel } from './next';

describe('next adapter', () => {
  it('throws clear error when useLogger is called outside traced context', () => {
    expect(() => useLogger({ method: 'GET', url: '/api/orders' })).toThrow(
      '[autotel-adapters/next] No active trace context.',
    );
  });

  it('provides request-scoped logger inside withAutotel()', async () => {
    const handler = withAutotel(async (request: { url: string }) => {
      const log = useLogger(request);
      log.set({ feature: 'checkout' });
      return 'ok';
    });

    await expect(handler({ url: 'https://example.com/orders' })).resolves.toBe(
      'ok',
    );
  });

  it('auto-emits one wide event by default', async () => {
    const onEmit = vi.fn();
    const handler = withAutotel(
      async (request: { url: string }) => {
        useLogger(request).set({ feature: 'checkout' });
        return 'ok';
      },
      { requestLoggerOptions: { onEmit } },
    );

    await handler({ url: 'https://example.com/orders' });
    expect(onEmit).toHaveBeenCalledTimes(1);
  });

  it('does not emit when autoEmit is false', async () => {
    const onEmit = vi.fn();
    const handler = withAutotel(async () => 'ok', {
      autoEmit: false,
      requestLoggerOptions: { onEmit },
    });

    await handler();
    expect(onEmit).not.toHaveBeenCalled();
  });
});
