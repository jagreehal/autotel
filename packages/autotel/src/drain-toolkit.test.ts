import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineDrain, defineHttpDrain } from './drain-toolkit';

describe('defineDrain', () => {
  it('calls send with transformed payloads', async () => {
    const send = vi.fn(async () => {});
    const drain = defineDrain<
      { event: { id: string } },
      { key: string },
      string
    >({
      name: 'test',
      resolve: async () => ({ key: 'k' }),
      transform: (contexts) => contexts.map((c) => c.event.id),
      send,
    });

    await drain({ event: { id: 'a' } });
    expect(send).toHaveBeenCalledWith(['a'], { key: 'k' });
  });

  it('skips send when resolve returns null', async () => {
    const send = vi.fn(async () => {});
    const drain = defineDrain({
      name: 'test',
      resolve: async () => null,
      send,
    });

    await drain({ event: { id: 'a' } });
    expect(send).not.toHaveBeenCalled();
  });

  it('isolates send errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const drain = defineDrain({
      name: 'test',
      resolve: async () => ({ ok: true }),
      send: async () => {
        throw new Error('fail');
      },
    });

    await expect(drain({ event: { id: 'a' } })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('defineHttpDrain', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('encodes payload and posts via fetch', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const drain = defineHttpDrain<
      { event: { id: string } },
      { token: string },
      { id: string }
    >({
      name: 'http-drain',
      resolve: async () => ({ token: 't' }),
      transform: (contexts) => contexts.map((c) => c.event),
      encode: (payloads, config) => ({
        url: 'https://example.com/ingest',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify(payloads),
      }),
      retries: 1,
      timeoutMs: 2000,
    });

    await drain({ event: { id: 'evt_1' } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.com/ingest');
  });

  it('retries failed requests', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const drain = defineHttpDrain({
      name: 'http-drain',
      resolve: async () => ({ ok: true }),
      encode: () => ({
        url: 'https://example.com/ingest',
        headers: { 'content-type': 'application/json' },
        body: '[]',
      }),
      retries: 2,
      timeoutMs: 2000,
    });

    await drain({ event: { id: 'evt_1' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
