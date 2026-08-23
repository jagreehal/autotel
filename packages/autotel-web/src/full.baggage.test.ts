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
});
