import { describe, expect, it, vi } from 'vitest';
import { init } from 'autotel';
import { withAutotelFetch } from './cloudflare';

describe('cloudflare adapter', () => {
  it('registers emit drain with waitUntil via middleware finish path', async () => {
    init({ service: 'test' });

    const waitUntil = vi.fn();
    const onEmit = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    const handler = withAutotelFetch(
      async () => Response.json({ ok: true }),
      {
        requestLoggerOptions: { onEmit },
      },
    );

    await handler(
      { method: 'GET', url: 'https://example.com/api/health' },
      {},
      { waitUntil },
    );

    expect(onEmit).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalled();
  });
});
