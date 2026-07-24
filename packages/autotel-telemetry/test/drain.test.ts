import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpDrain } from '../src/drain';
import type { RunEvent } from '../src/types';

const event: RunEvent = {
  tool: 'demo',
  version: '1.0.0',
  command: 'build',
  outcome: 'success',
  durationMs: 12,
};

function mockFetch(status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status })),
  );
}

describe('createHttpDrain', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves (batch delivered) on a 2xx response', async () => {
    mockFetch(204);
    await expect(createHttpDrain('http://x.test')([event])).resolves.toBeUndefined();
  });

  it('drops a permanently-rejected 4xx batch instead of throwing', async () => {
    // Resolving lets the caller purge the outbox. Throwing here would keep the
    // poison batch buffered and block all future telemetry for the tool.
    for (const status of [400, 401, 403, 404, 413, 422]) {
      mockFetch(status);
      await expect(
        createHttpDrain('http://x.test')([event]),
      ).resolves.toBeUndefined();
    }
  });

  it('throws on 429 so the batch stays buffered for retry', async () => {
    mockFetch(429);
    await expect(createHttpDrain('http://x.test')([event])).rejects.toThrow(
      'HTTP 429',
    );
  });

  it('throws on a 5xx server error', async () => {
    mockFetch(500);
    await expect(createHttpDrain('http://x.test')([event])).rejects.toThrow(
      'HTTP 500',
    );
  });

  it('propagates a network error (stays buffered for retry)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(createHttpDrain('http://x.test')([event])).rejects.toThrow(
      'network down',
    );
  });

  it('short-circuits an empty batch without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(createHttpDrain('http://x.test')([])).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
