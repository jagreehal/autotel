import { describe, expect, it } from 'vitest';
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
});
