/**
 * Who owns `traceparent` when another SDK also patches fetch.
 *
 * autotel-web injects only when the header is absent (init.ts), and every other
 * tracing SDK worth using does the same, so nobody clobbers a header already on
 * the request. The consequence is an ordering rule that is easy to get backwards
 * in a doc: patching fetch wraps whatever is there, so the SDK initialized
 * **last** is outermost, runs **first**, and its traceparent is the one the
 * server sees.
 *
 * The README's Sentry section rests on this, which is why it is pinned here.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./span-exporter', () => ({
  configureExporter: vi.fn(),
  setRawFetch: vi.fn(),
  recordSpan: vi.fn(),
  recordEvent: vi.fn(),
  flushSpans: vi.fn(),
  isConfigured: vi.fn(() => true),
  resetForTesting: vi.fn(),
}));

import { init, resetForTesting } from './init';

const ORIGIN = 'https://app.example.com';
const OTHER_TRACEPARENT =
  '00-11111111111111111111111111111111-1111111111111111-01';

afterEach(() => {
  resetForTesting();
  vi.unstubAllGlobals();
});

/** A minimal mutable window, returning the fetch that stands in for the network. */
function installWindow() {
  const server = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('window', {
    fetch: server,
    location: { origin: ORIGIN, href: `${ORIGIN}/` },
    addEventListener: vi.fn(),
  });
  return server;
}

/** Another tracing SDK's fetch wrapper: sets its header only when absent. */
function wrapFetchLikeAnotherSdk(inner: typeof fetch): typeof fetch {
  return (async (input: unknown, opts: { headers?: HeadersInit } = {}) => {
    const headers = new Headers(opts.headers);
    if (!headers.get('traceparent')) {
      headers.set('traceparent', OTHER_TRACEPARENT);
    }
    return inner(input as string, { ...opts, headers });
  }) as unknown as typeof fetch;
}

/** The traceparent the stand-in server received. */
function traceparentAtServer(server: ReturnType<typeof vi.fn>): string | null {
  const headers = server.mock.calls.at(-1)?.[1]?.headers as Headers | undefined;
  return headers instanceof Headers ? headers.get('traceparent') : null;
}

describe('traceparent precedence against another fetch-patching SDK', () => {
  it('keeps a traceparent the caller already set', async () => {
    const server = installWindow();
    init({ service: 'demo', instrumentFetch: true, instrumentXHR: false });

    const w = globalThis.window as unknown as { fetch: typeof fetch };
    await w.fetch(`${ORIGIN}/api/x`, {
      headers: { traceparent: OTHER_TRACEPARENT },
    });

    expect(traceparentAtServer(server)).toBe(OTHER_TRACEPARENT);
  });

  it('keeps headers carried on a Request object, traceparent included', async () => {
    const server = installWindow();
    init({ service: 'demo', instrumentFetch: true, instrumentXHR: false });

    const w = globalThis.window as unknown as { fetch: typeof fetch };
    await w.fetch(
      new Request(`${ORIGIN}/api/x`, {
        headers: {
          traceparent: OTHER_TRACEPARENT,
          authorization: 'Bearer secret',
        },
      }),
    );

    const headers = server.mock.calls.at(-1)?.[1]?.headers as Headers;
    expect(headers.get('traceparent')).toBe(OTHER_TRACEPARENT);
    // Regression: every Request header used to be dropped, not just this one.
    expect(headers.get('authorization')).toBe('Bearer secret');
  });

  it('wins when initialized last, because its wrapper is outermost', async () => {
    const server = installWindow();
    const w = globalThis.window as unknown as { fetch: typeof fetch };
    w.fetch = wrapFetchLikeAnotherSdk(w.fetch);
    init({ service: 'demo', instrumentFetch: true, instrumentXHR: false });

    await w.fetch(`${ORIGIN}/api/x`);

    expect(traceparentAtServer(server)).not.toBe(OTHER_TRACEPARENT);
  });

  it('loses when initialized first, and the other SDK wraps it', async () => {
    const server = installWindow();
    init({ service: 'demo', instrumentFetch: true, instrumentXHR: false });
    const w = globalThis.window as unknown as { fetch: typeof fetch };
    w.fetch = wrapFetchLikeAnotherSdk(w.fetch);

    await w.fetch(`${ORIGIN}/api/x`);

    expect(traceparentAtServer(server)).toBe(OTHER_TRACEPARENT);
  });
});
