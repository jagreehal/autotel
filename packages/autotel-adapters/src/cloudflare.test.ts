import { describe, expect, it } from 'vitest';
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
});

