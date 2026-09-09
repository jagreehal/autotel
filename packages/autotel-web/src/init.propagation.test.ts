/**
 * Where `traceparent` is allowed to go, and what is still traced when it is not.
 *
 * The rule is a compatibility one before it is a privacy one: an unexpected
 * request header makes the browser preflight, and a server that does not list
 * `traceparent` in `Access-Control-Allow-Headers` rejects the request. So
 * cross-origin propagation is opt-in — while the browser span is recorded
 * either way, or turning propagation off would blind the page to its own calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init, resetForTesting, setBaggage } from './init';
import { flushSpans } from './span-exporter';

const PAGE_ORIGIN = 'https://app.example.com';
const TRACEPARENT = /^00-[\da-f]{32}-[\da-f]{16}-0[01]$/;

let mockFetch: ReturnType<typeof vi.fn>;

const COLLECTOR = 'https://collector.example.com';

beforeEach(() => {
  resetForTesting();
  mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('window', {
    fetch: mockFetch,
    location: { origin: PAGE_ORIGIN, href: `${PAGE_ORIGIN}/` },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

afterEach(() => {
  // Reset while the stubbed window is still installed: teardown detaches
  // listeners from it.
  resetForTesting();
  vi.unstubAllGlobals();
});

/** The instrumented fetch init() installed on the stubbed window. */
function patchedFetch(): typeof fetch {
  // SAFETY: beforeEach stubs a window carrying a fetch, and init() replaces it
  // with the instrumented one before any test calls this.
  return (globalThis.window as { fetch: typeof fetch }).fetch;
}

/** The most recent request the app made, skipping the exporter's own posts. */
function lastAppInit(): RequestInit | undefined {
  return mockFetch.mock.calls
    .filter((call) => !String(call[0]).startsWith(COLLECTOR))
    .at(-1)?.[1];
}

/** One header off that request, or null when it carried none. */
function sentHeader(name: string): string | null {
  const headers = lastAppInit()?.headers;
  // SAFETY: the instrumented fetch always builds a Headers; anything else came
  // from a call it left untouched, which by definition sent no header of ours.
  return headers instanceof Headers ? headers.get(name) : null;
}

const sentTraceparent = () => sentHeader('traceparent');
const sentBaggage = () => sentHeader('baggage');

/** One OTLP key/value pair, as `recordSpan` writes it. */
interface OtlpAttribute {
  key: string;
  value: { stringValue?: string; intValue?: string };
}

/** The fields of an exported span these tests read back. */
interface OtlpSpan {
  name: string;
  traceId: string;
  spanId: string;
  attributes?: OtlpAttribute[];
}

interface OtlpTracePayload {
  resourceSpans?: Array<{ scopeSpans?: Array<{ spans?: OtlpSpan[] }> }>;
}

/** A span's attributes as a plain object, for assertion. */
function attributesOf(span: OtlpSpan): Record<string, string | number> {
  return Object.fromEntries(
    (span.attributes ?? []).map((attribute) => [
      attribute.key,
      attribute.value.stringValue ?? Number(attribute.value.intValue),
    ]),
  );
}

/**
 * The spans the exporter actually sent, read back off the OTLP payload it
 * posted. The exporter holds the unpatched fetch captured during init(), which
 * is the same mock, so this is the real transport rather than a stand-in.
 */
function exportedSpans(): OtlpSpan[] {
  flushSpans();
  return mockFetch.mock.calls
    .filter((call) => String(call[0]).startsWith(COLLECTOR))
    .flatMap((call) => {
      // SAFETY: every export posts a JSON string body; the shape below is
      // `recordSpan`'s own, and an absent field reads as an empty list.
      const payload = JSON.parse(String(call[1]?.body)) as OtlpTracePayload;
      return (payload.resourceSpans ?? []).flatMap((resource) =>
        (resource.scopeSpans ?? []).flatMap((scope) => scope.spans ?? []),
      );
    });
}

describe('traceparent propagation', () => {
  it('propagates to the page origin', async () => {
    init({ service: 'spa' });

    await patchedFetch()(`${PAGE_ORIGIN}/api/users`);

    expect(sentTraceparent()).toMatch(TRACEPARENT);
  });

  it('propagates on a relative URL, which is same-origin by definition', async () => {
    init({ service: 'spa' });

    await patchedFetch()('/api/users');

    expect(sentTraceparent()).toMatch(TRACEPARENT);
  });

  it('does not propagate cross-origin by default', async () => {
    init({ service: 'spa' });

    // Exactly the devtools case: a widget served from another port polling its
    // own API. The header would force a preflight the server has no reason to
    // expect, and the request would fail before it left the browser.
    await patchedFetch()('http://localhost:4848/api/query/traces');

    expect(sentTraceparent()).toBeNull();
  });

  it('propagates cross-origin to an origin named in propagateTo', async () => {
    init({ service: 'spa', propagateTo: ['api.myapp.com'] });

    await patchedFetch()('https://api.myapp.com/users');

    expect(sentTraceparent()).toMatch(TRACEPARENT);
  });

  it('leaves other cross-origin destinations bare when propagateTo is set', async () => {
    init({ service: 'spa', propagateTo: ['api.myapp.com'] });

    await patchedFetch()('https://analytics.google.com/collect');

    expect(sentTraceparent()).toBeNull();
  });

  it('fails closed on a URL it cannot parse', async () => {
    init({ service: 'spa', propagateTo: ['api.myapp.com'] });

    await patchedFetch()('http://[not a url]/x');

    expect(sentTraceparent()).toBeNull();
  });
});

describe('traceparent propagation and the browser span', () => {
  it('records a span for a destination it may not propagate to', async () => {
    init({ service: 'spa', endpoint: COLLECTOR });

    await patchedFetch()('https://api.myapp.com/users');

    // The point of the decoupling: no header went out, but the page still sees
    // its own call. Tying the span to the injection turned "do not propagate"
    // into "do not trace", which is a blind spot, not a privacy win.
    expect(sentTraceparent()).toBeNull();
    const spans = exportedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe('browser /users');
    expect(attributesOf(spans[0]!)).toMatchObject({
      'url.full': 'https://api.myapp.com/users',
      'http.response.status_code': 200,
    });
  });

  it('records a span with the ids it propagated when it may propagate', async () => {
    init({ service: 'spa', endpoint: COLLECTOR });

    await patchedFetch()(`${PAGE_ORIGIN}/api/users`);

    const sent = sentTraceparent();
    const span = exportedSpans()[0]!;
    // The server will report the same ids, so the two halves join.
    expect(sent).toBe(`00-${span.traceId}-${span.spanId}-01`);
  });
});

describe('privacy still only ever subtracts', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'doNotTrack', {
      value: null,
      configurable: true,
      writable: true,
    });
  });

  it('blockedOrigins overrides propagateTo', async () => {
    init({
      service: 'spa',
      propagateTo: ['api.myapp.com'],
      privacy: { blockedOrigins: ['api.myapp.com'] },
    });

    await patchedFetch()('https://api.myapp.com/users');

    expect(sentTraceparent()).toBeNull();
  });

  it('Do Not Track overrides propagateTo', async () => {
    Object.defineProperty(navigator, 'doNotTrack', {
      value: '1',
      configurable: true,
    });

    init({
      service: 'spa',
      propagateTo: ['api.myapp.com'],
      privacy: { respectDoNotTrack: true },
    });

    await patchedFetch()('https://api.myapp.com/users');

    expect(sentTraceparent()).toBeNull();
  });

  it('keeps the deprecated privacy.allowedOrigins deciding on its own', async () => {
    // Pinned rather than endorsed: this list is exclusive, so it allows the
    // cross-origin host it names and denies the page's own origin. Anyone
    // relying on that keeps it until the field goes.
    init({ service: 'spa', privacy: { allowedOrigins: ['api.myapp.com'] } });

    await patchedFetch()('https://api.myapp.com/users');
    expect(sentTraceparent()).toMatch(TRACEPARENT);

    await patchedFetch()(`${PAGE_ORIGIN}/api/users`);
    expect(sentTraceparent()).toBeNull();
  });
});

describe('baggage never travels further than traceparent', () => {
  it('sends both to a cross-origin host named only as a baggage destination', async () => {
    init({ service: 'spa', baggage: { allowedOrigins: ['api.myapp.com'] } });
    setBaggage({ 'tenant.id': 'acme' });

    await patchedFetch()('https://api.myapp.com/users');

    // Naming it as a baggage destination declares it one of ours; the narrower
    // list must not silently disable itself by outliving the wider one.
    expect(sentBaggage()).toBe('tenant.id=acme');
    expect(sentTraceparent()).toMatch(TRACEPARENT);
  });

  it('sends neither where propagation is not allowed', async () => {
    init({ service: 'spa', baggage: { allowedOrigins: ['api.myapp.com'] } });
    setBaggage({ 'tenant.id': 'acme' });

    await patchedFetch()('https://analytics.google.com/collect');

    expect(sentBaggage()).toBeNull();
    expect(sentTraceparent()).toBeNull();
  });
});

describe('environments', () => {
  it('initializes in a window that has no XMLHttpRequest', async () => {
    // Some embedded and SSR-ish runtimes have a window and no XHR. Reading the
    // prototype off `undefined` threw out of init(), taking the fetch
    // instrumentation down with it.
    expect(() => init({ service: 'spa' })).not.toThrow();

    await patchedFetch()('/api/users');

    expect(sentTraceparent()).toMatch(TRACEPARENT);
  });
});
