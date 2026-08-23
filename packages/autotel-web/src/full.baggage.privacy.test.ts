// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setBaggage, resetBaggageForTesting } from './baggage';
import { initFull, resetFullForTesting } from './full';

/**
 * Baggage carries business context — `session.id`, `tenant.id` — off the page.
 * Lean mode gates it on the privacy configuration *and* the destination. Full
 * mode has to reach the same decision, or `privacy` means one thing in one
 * build and something weaker in the other.
 */

afterEach(() => {
  resetFullForTesting();
  resetBaggageForTesting();
  vi.unstubAllGlobals();
});

/** Records the `baggage` header each call actually ended up sending. */
function recordFetch(): string[] {
  const seen: string[] = [];
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const header = headers.get('baggage');
    if (header) seen.push(header);
    return Promise.resolve(new Response('ok'));
  });
  return seen;
}

describe('full-mode baggage respects privacy', () => {
  it('sends it when nothing objects', async () => {
    const seen = recordFetch();
    initFull({
      service: 'web',
      captureNavigation: false,
      captureFetch: false,
      captureXHR: false,
    });
    setBaggage({ 'session.id': 'sess_1' });

    await fetch('/checkout', { method: 'POST' });

    expect(seen).toEqual(['session.id=sess_1']);
  });

  it('withholds it from a blocked origin', async () => {
    const seen = recordFetch();
    initFull({
      service: 'web',
      captureNavigation: false,
      captureFetch: false,
      captureXHR: false,
      privacy: { blockedOrigins: [globalThis.location.host] },
    });
    setBaggage({ 'session.id': 'sess_1' });

    await fetch('/checkout', { method: 'POST' });

    expect(seen).toEqual([]);
  });

  it('withholds it when the visitor asked not to be tracked', async () => {
    const seen = recordFetch();
    vi.stubGlobal('navigator', { doNotTrack: '1' });
    initFull({
      service: 'web',
      captureNavigation: false,
      captureFetch: false,
      captureXHR: false,
      privacy: { respectDoNotTrack: true },
    });
    setBaggage({ 'session.id': 'sess_1' });

    await fetch('/checkout', { method: 'POST' });

    expect(seen).toEqual([]);
  });

  it('withholds it under Global Privacy Control', async () => {
    const seen = recordFetch();
    vi.stubGlobal('navigator', { globalPrivacyControl: true });
    initFull({
      service: 'web',
      captureNavigation: false,
      captureFetch: false,
      captureXHR: false,
      privacy: { respectGPC: true },
    });
    setBaggage({ 'session.id': 'sess_1' });

    await fetch('/checkout', { method: 'POST' });

    expect(seen).toEqual([]);
  });
});

describe('full-mode baggage survives the request it is given', () => {
  it('keeps the header when fetch(Request, init) also supplies headers', async () => {
    // Native fetch lets `init.headers` replace the Request's headers wholesale,
    // so injecting into a cloned Request and passing the caller's `init`
    // through unchanged throws the injection away.
    const seen = recordFetch();
    initFull({
      service: 'web',
      captureNavigation: false,
      captureFetch: false,
      captureXHR: false,
    });
    setBaggage({ 'session.id': 'sess_1' });

    // Absolute: undici's Request cannot resolve a relative URL.
    await fetch(
      new Request(`${globalThis.location.origin}/checkout`, { method: 'POST' }),
      {
        headers: { 'content-type': 'application/json' },
      },
    );

    expect(seen).toEqual(['session.id=sess_1']);
  });

  it("does not drop the caller's own headers to do it", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      return Promise.resolve(new Response('ok'));
    });
    initFull({
      service: 'web',
      captureNavigation: false,
      captureFetch: false,
      captureXHR: false,
    });
    setBaggage({ 'session.id': 'sess_1' });

    // Absolute: undici's Request cannot resolve a relative URL.
    await fetch(
      new Request(`${globalThis.location.origin}/checkout`, { method: 'POST' }),
      {
        headers: { 'content-type': 'application/json' },
      },
    );

    const [, init] = calls.at(-1)!;
    const headers = new Headers(init?.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('baggage')).toBe('session.id=sess_1');
  });
});
