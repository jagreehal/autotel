// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setBaggage, resetBaggageForTesting } from './baggage';
import { initFull, resetFullForTesting } from './full';

afterEach(() => {
  resetFullForTesting();
  resetBaggageForTesting();
  vi.unstubAllGlobals();
});

function baggageOf(
  input: RequestInfo | URL,
  init?: RequestInit,
): string | null {
  if (init?.headers instanceof Headers) return init.headers.get('baggage');
  if (input instanceof Request) return input.headers.get('baggage');
  const headers = new Headers(init?.headers);
  return headers.get('baggage');
}

describe('initFull baggage injection', () => {
  it('puts session.id on a same-origin fetch after setBaggage', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const header = baggageOf(input, init);
      if (header) seen.push(header);
      return Promise.resolve(new Response('ok'));
    });

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

  it('skips cross-origin destinations unless allowlisted', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const header = baggageOf(input, init);
      if (header) seen.push(header);
      return Promise.resolve(new Response('ok'));
    });

    initFull({
      service: 'web',
      captureNavigation: false,
      captureFetch: false,
      captureXHR: false,
    });
    setBaggage({ 'session.id': 'sess_1' });

    await fetch('https://evil.example/collect', { method: 'POST' });

    expect(seen).toEqual([]);
  });

  it('never sends baggage to an ignored URL or our own collector', async () => {
    // ignoreUrls promises no propagation, and a same-origin RUM proxy or the
    // OTLP endpoint would otherwise pass the destination allowlist.
    const seen: Record<string, string | null> = {};
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      seen[
        new URL(
          String(input instanceof Request ? input.url : input),
          location.href,
        ).pathname
      ] = baggageOf(input, init);
      return Promise.resolve(new Response('ok'));
    });

    initFull({
      service: 'web',
      endpoint: '/otel',
      ignoreUrls: ['/rum-proxy'],
      captureNavigation: false,
      captureFetch: false,
      captureXHR: false,
    });
    setBaggage({ 'session.id': 'sess_1' });

    await fetch('/rum-proxy?ddforward=x', { method: 'POST' });
    await fetch('/otel/v1/traces', { method: 'POST' });
    await fetch('/checkout', { method: 'POST' });

    expect(seen['/rum-proxy']).toBeNull();
    expect(seen['/otel/v1/traces']).toBeNull();
    expect(seen['/checkout']).toBe('session.id=sess_1');
  });
});

describe('initFull baggage with a stateful ignoreUrls RegExp', () => {
  it('excludes the URL on every request, not every other one', async () => {
    const seen: Array<string | null> = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(baggageOf(input, init));
      return Promise.resolve(new Response('ok'));
    });

    initFull({
      service: 'web',
      ignoreUrls: [/rum-proxy/g],
      captureNavigation: false,
      captureFetch: false,
      captureXHR: false,
    });
    setBaggage({ 'session.id': 'sess_1' });

    for (let index = 0; index < 4; index += 1) {
      await fetch('/rum-proxy?ddforward=x', { method: 'POST' });
    }

    expect(seen).toEqual([null, null, null, null]);
  });
});
