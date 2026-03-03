import { describe, expect, it } from 'vitest';
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
});
