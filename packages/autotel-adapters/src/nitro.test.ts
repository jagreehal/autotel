import { describe, expect, it, vi } from 'vitest';
import { useLogger, withAutotelEventHandler } from './nitro';

describe('nitro adapter', () => {
  it('throws clear error when useLogger is called outside traced context', () => {
    expect(() =>
      useLogger({ method: 'GET', path: '/api/orders', context: {} }),
    ).toThrow('[autotel-adapters/nitro] No active trace context.');
  });

  it('provides request-scoped logger inside withAutotelEventHandler()', async () => {
    const handler = withAutotelEventHandler(
      async (event: { path: string; context: Record<string, unknown> }) => {
        const log = useLogger(event, 'api-service');
        log.set({ route: event.path });
        return { ok: true };
      },
    );

    await expect(
      handler({ path: '/orders', context: {} }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('auto-emits one wide event by default', async () => {
    const onEmit = vi.fn();
    const handler = withAutotelEventHandler(
      async (event: { path: string; context: Record<string, unknown> }) => {
        useLogger(event).set({ route: event.path });
        return { ok: true };
      },
      { requestLoggerOptions: { onEmit } },
    );

    await handler({ path: '/orders', context: {} });
    expect(onEmit).toHaveBeenCalledTimes(1);
  });

  it('does not emit when autoEmit is false', async () => {
    const onEmit = vi.fn();
    const handler = withAutotelEventHandler(async () => ({ ok: true }), {
      autoEmit: false,
      requestLoggerOptions: { onEmit },
    });

    await handler({ path: '/x', context: {} });
    expect(onEmit).not.toHaveBeenCalled();
  });
});
