// @vitest-environment jsdom
/**
 * Findings 5.1 and 5.2: the API span had no `session.id` because the browser
 * never sent it, and axios (XHR) got no baggage in full mode at all; and
 * tagging the signed-in user took an app-specific enricher.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace';
import { resetBaggageForTesting, setBaggage } from './baggage';
import { initFull, resetFullForTesting, span } from './full';
import { clearIdentity, identify } from './identity';
import { getSessionAttributes, resetSessionForTesting } from './session';

afterEach(() => {
  resetFullForTesting();
  resetBaggageForTesting();
  resetSessionForTesting();
  clearIdentity();
  vi.unstubAllGlobals();
});

/** An XHR that records headers and never touches the network. */
function stubXhr(): Array<Record<string, string>> {
  const sent: Array<Record<string, string>> = [];
  class FakeXhr {
    headers: Record<string, string> = {};
    open() {}
    setRequestHeader(name: string, value: string) {
      this.headers[name] = this.headers[name]
        ? `${this.headers[name]}, ${value}`
        : value;
    }
    send() {
      sent.push(this.headers);
    }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  return sent;
}

function stubFetch(): string[] {
  const seen: string[] = [];
  vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Headers(init?.headers).get('baggage') ?? '-');
    return Promise.resolve(new Response('ok'));
  });
  return seen;
}

const quiet = {
  service: 'web',
  captureNavigation: false,
  captureFetch: false,
  captureXHR: false,
} as const;

function xhr(url: string, own?: string): void {
  const request = new XMLHttpRequest();
  request.open('GET', url);
  if (own) request.setRequestHeader('baggage', own);
  request.send();
}

describe('session.propagate', () => {
  it('sends session.id on fetch and XHR to allowlisted origins only', async () => {
    const fetched = stubFetch();
    const sent = stubXhr();
    initFull({
      ...quiet,
      session: { propagate: true },
      baggage: { allowedOrigins: ['api.example.com'] },
    });
    const id = getSessionAttributes()?.['session.id'];

    await fetch('https://api.example.com/users//get_possible_clients');
    xhr('https://api.example.com/users//get_possible_clients');
    xhr('https://third-party.example/collect');

    expect(fetched).toEqual([`session.id=${id}`]);
    expect(sent.map((h) => h.baggage)).toEqual([`session.id=${id}`, undefined]);
  });

  it('sends nothing by default', async () => {
    const fetched = stubFetch();
    const sent = stubXhr();
    initFull(quiet);

    await fetch('/x');
    xhr('/x');

    expect(fetched).toEqual(['-']);
    expect(sent[0]?.baggage).toBeUndefined();
  });

  it('puts setBaggage entries on XHR, and leaves an app-set header alone', () => {
    const sent = stubXhr();
    initFull(quiet);
    setBaggage({ 'tenant.id': 'acme' });

    xhr('/x');
    xhr('/y', 'mine=1');

    expect(sent.map((h) => h.baggage)).toEqual(['tenant.id=acme', 'mine=1']);
  });
});

describe('identify', () => {
  function recorder(): SpanProcessor & { seen: ReadableSpan[] } {
    const seen: ReadableSpan[] = [];
    return {
      seen,
      onStart() {},
      onEnd: (s) => void seen.push(s),
      forceFlush: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
    };
  }

  it('tags spans after identify, and none after clearIdentity', () => {
    const rec = recorder();
    initFull({ ...quiet, spanProcessor: rec });

    span('before-login', () => undefined);
    identify('u1', { 'client.id': 'c1' });
    span('signed-in', () => undefined);
    clearIdentity();
    span('after-logout', () => undefined);

    const byName = Object.fromEntries(
      rec.seen.map((s) => [s.name, s.attributes]),
    );
    expect(byName['before-login']?.['user.id']).toBeUndefined();
    expect(byName['signed-in']).toMatchObject({
      'user.id': 'u1',
      'client.id': 'c1',
    });
    expect(byName['signed-in']?.['session.id']).toBe(
      byName['before-login']?.['session.id'],
    );
    expect(byName['after-logout']?.['user.id']).toBeUndefined();
  });
});
