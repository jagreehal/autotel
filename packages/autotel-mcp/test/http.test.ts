import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonGet, jsonPost } from '../src/lib/http';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => body,
});

const rateLimited = (retryAfter = '0') => ({
  ok: false,
  status: 429,
  statusText: 'Too Many Requests',
  headers: new Headers({ 'Retry-After': retryAfter }),
  json: async () => ({}),
});

describe('jsonGet', () => {
  it('returns the parsed body', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(ok({ data: ['a'] })) as unknown as typeof fetch;
    await expect(jsonGet<{ data: string[] }>('http://x/y')).resolves.toEqual({
      data: ['a'],
    });
  });

  it('throws with the status and url on failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers(),
    }) as unknown as typeof fetch;
    await expect(jsonGet('http://x/y')).rejects.toThrow(/503.*http:\/\/x\/y/);
  });

  // Hosted vendor read APIs rate-limit aggressively; a burst of investigate
  // queries hits 429 routinely and must not surface as a failed investigation.
  it('rides out a 429 and returns the eventual body', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(ok({ data: ['recovered'] }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(jsonGet<{ data: string[] }>('http://x/y')).resolves.toEqual({
      data: ['recovered'],
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('gives up on a persistently rate-limited endpoint', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(rateLimited()) as unknown as typeof fetch;
    await expect(jsonGet('http://x/y')).rejects.toThrow(/429/);
  });

  it('does not retry a non-429 failure', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      headers: new Headers(),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await expect(jsonGet('http://x/y')).rejects.toThrow(/500/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('jsonPost', () => {
  it('sends a JSON body with the caller headers and returns the parsed reply', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(ok({ rows: [] }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await jsonPost(
      'http://x/query',
      { sql: 'SELECT 1' },
      {
        Authorization: 'Bearer t',
      },
    );

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://x/query');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ sql: 'SELECT 1' });
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer t',
      'content-type': 'application/json',
      accept: 'application/json',
    });
  });
});
