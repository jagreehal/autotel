/**
 * Reading the telemetry must not become telemetry.
 *
 * A collector serves its UI and query API beside `/v1/traces`, so the widget
 * that displays traces is itself a fetch from the instrumented page. Tracing it
 * makes the tool a source of the data it displays: every poll of the trace list
 * writes another trace to the list, and the real spans are pushed out by noise.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init, resetForTesting } from './init';
import { flushSpans } from './span-exporter';

const PAGE_ORIGIN = 'http://localhost:3000';
const COLLECTOR = 'http://localhost:4848';

let mockFetch: ReturnType<typeof vi.fn>;

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
  resetForTesting();
  vi.unstubAllGlobals();
});

function patchedFetch(): typeof fetch {
  // SAFETY: beforeEach stubs a window carrying a fetch, and init() replaces it
  // with the instrumented one before any test calls this.
  return (globalThis.window as { fetch: typeof fetch }).fetch;
}

/** Names of the spans the exporter actually posted to the collector. */
function exportedSpanNames(): string[] {
  flushSpans();
  return (
    mockFetch.mock.calls
      // The exporter's own POST, not the widget polls these tests simulate —
      // those go to the same origin and carry no OTLP body.
      .filter((call) => String(call[0]) === `${COLLECTOR}/v1/traces`)
      .flatMap((call) => {
        // SAFETY: every export posts a JSON string body in `recordSpan`'s shape;
        // an absent field reads as an empty list.
        const payload = JSON.parse(String(call[1]?.body)) as {
          resourceSpans?: Array<{
            scopeSpans?: Array<{ spans?: Array<{ name: string }> }>;
          }>;
        };
        return (payload.resourceSpans ?? []).flatMap((resource) =>
          (resource.scopeSpans ?? []).flatMap((scope) =>
            (scope.spans ?? []).map((span) => span.name),
          ),
        );
      })
  );
}

describe('the collector is never instrumented', () => {
  it('records no span for the collector UI polling its own API', async () => {
    init({ service: 'spa', endpoint: COLLECTOR, collectorOwnsOrigin: true });

    await patchedFetch()(`${COLLECTOR}/api/query/traces`);
    await patchedFetch()(`${COLLECTOR}/api/query/errors`);

    expect(exportedSpanNames()).toEqual([]);
  });

  it('sends no traceparent to the collector', async () => {
    init({ service: 'spa', endpoint: COLLECTOR, collectorOwnsOrigin: true });

    await patchedFetch()(`${COLLECTOR}/api/query/traces`);

    const call = mockFetch.mock.calls.find((c) =>
      String(c[0]).includes('/api/query/traces'),
    );
    const headers = call?.[1]?.headers;
    expect(
      headers instanceof Headers ? headers.get('traceparent') : null,
    ).toBeNull();
  });

  it('still records the page making its own API calls', async () => {
    init({ service: 'spa', endpoint: COLLECTOR, collectorOwnsOrigin: true });

    await patchedFetch()(`${PAGE_ORIGIN}/api/rates`);

    expect(exportedSpanNames()).toEqual(['browser /api/rates']);
  });

  it('still instruments an API that shares the collector origin', async () => {
    // Production shape: the page is on app.example.com and both the OTLP
    // endpoint and the application's API are on api.example.com. Excluding
    // that origin wholesale would drop the spans the page exists to record.
    const remote = 'https://api.example.com/otlp';
    resetForTesting();
    vi.stubGlobal('window', {
      fetch: mockFetch,
      location: {
        origin: 'https://app.example.com',
        href: 'https://app.example.com/',
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    init({
      service: 'spa',
      endpoint: remote,
      // Cross-origin propagation is opt-in; the point here is that the
      // collector's origin no longer vetoes it.
      propagateTo: ['https://api.example.com'],
    });

    await patchedFetch()('https://api.example.com/orders');
    flushSpans();

    const exportCall = mockFetch.mock.calls.find(
      (c) => String(c[0]) === `${remote}/v1/traces`,
    );
    expect(String(exportCall?.[1]?.body)).toContain('browser /orders');

    const apiCall = mockFetch.mock.calls.find(
      (c) => String(c[0]) === 'https://api.example.com/orders',
    );
    const headers = apiCall?.[1]?.headers;
    expect(
      headers instanceof Headers ? headers.get('traceparent') : null,
    ).toMatch(/^00-[\da-f]{32}-[\da-f]{16}-\d{2}$/);
  });

  it('traces a local API server that also carries the endpoint', async () => {
    // Vite on 5173, the app's own server on 3000 with OTLP proxied through it.
    // Nothing in the URL says that server is a collector, and treating it as
    // one silences the app.
    const otlp = 'http://localhost:3000/otlp';
    resetForTesting();
    vi.stubGlobal('window', {
      fetch: mockFetch,
      location: {
        origin: 'http://localhost:5173',
        href: 'http://localhost:5173/',
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    init({ service: 'spa', endpoint: otlp });

    await patchedFetch()('http://localhost:3000/api/orders');
    flushSpans();

    const exportCall = mockFetch.mock.calls.find(
      (c) => String(c[0]) === `${otlp}/v1/traces`,
    );
    expect(String(exportCall?.[1]?.body)).toContain('browser /api/orders');
  });

  it('still ignores the OTLP path on that shared origin', async () => {
    const remote = 'https://api.example.com/otlp';
    resetForTesting();
    vi.stubGlobal('window', {
      fetch: mockFetch,
      location: {
        origin: 'https://app.example.com',
        href: 'https://app.example.com/',
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    init({ service: 'spa', endpoint: remote });

    await patchedFetch()(`${remote}/v1/traces`);
    flushSpans();

    const exported = mockFetch.mock.calls
      .filter((c) => String(c[0]) === `${remote}/v1/traces`)
      .map((c) => String(c[1]?.body));
    // Only the export itself, never a span describing it.
    expect(
      exported.some((body) => body.includes('browser /otlp/v1/traces')),
    ).toBe(false);
  });

  it('matches the collector across the loopback aliases', async () => {
    // .env names the collector `localhost`; the widget it serves polls
    // `127.0.0.1`. One collector, two names, and the loop reappears if only
    // the configured spelling is excluded.
    init({ service: 'spa', endpoint: COLLECTOR, collectorOwnsOrigin: true });

    await patchedFetch()('http://127.0.0.1:4848/api/query/traces');

    expect(exportedSpanNames()).toEqual([]);
  });
});
