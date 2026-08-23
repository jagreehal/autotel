/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-known-value-widening -- Test helpers that build a Response from any JSON body the test wants to serve. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonGet, jsonPost } from '../src/lib/http';
import { installFetch, recordedCall, requestBody } from './helpers/fetch';

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
    installFetch(vi.fn().mockResolvedValue(ok({ data: ['a'] })));
    await expect(jsonGet<{ data: string[] }>('http://x/y')).resolves.toEqual({
      data: ['a'],
    });
  });

  it('throws with the status and url on failure', async () => {
    installFetch(
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers(),
      }),
    );
    await expect(jsonGet('http://x/y')).rejects.toThrow(/503.*http:\/\/x\/y/);
  });

  // Hosted vendor read APIs rate-limit aggressively; a burst of investigate
  // queries hits 429 routinely and must not surface as a failed investigation.
  it('rides out a 429 and returns the eventual body', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(ok({ data: ['recovered'] }));
    installFetch(fetchSpy);

    await expect(jsonGet<{ data: string[] }>('http://x/y')).resolves.toEqual({
      data: ['recovered'],
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('gives up on a persistently rate-limited endpoint', async () => {
    installFetch(vi.fn().mockResolvedValue(rateLimited()));
    await expect(jsonGet('http://x/y')).rejects.toThrow(/429/);
  });

  it('does not retry a non-429 failure', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      headers: new Headers(),
    });
    installFetch(fetchSpy);
    await expect(jsonGet('http://x/y')).rejects.toThrow(/500/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('jsonPost', () => {
  it('sends a JSON body with the caller headers and returns the parsed reply', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(ok({ rows: [] }));
    installFetch(fetchSpy);

    await jsonPost(
      'http://x/query',
      { sql: 'SELECT 1' },
      {
        Authorization: 'Bearer t',
      },
    );

    const { url, init } = recordedCall(fetchSpy);
    expect(url).toBe('http://x/query');
    expect(init.method).toBe('POST');
    expect(requestBody(fetchSpy)).toEqual({ sql: 'SELECT 1' });
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer t',
      'content-type': 'application/json',
      accept: 'application/json',
    });
  });
});
