import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonGet } from './http';

describe('jsonGet', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([408, 429])(
    'retries a %i and returns the next answer',
    async (status) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response('', { status, headers: { 'Retry-After': '0' } }),
        )
        .mockResolvedValueOnce(Response.json({ ok: true }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(jsonGet('http://backend/q')).resolves.toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('does not retry a 500', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(jsonGet('http://backend/q')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
