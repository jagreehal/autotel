/**
 * A streamed response is still arriving when its headers do. An AI chat that
 * streams for a minute is a minute-long request; ending the browser span at the
 * headers recorded it as a few milliseconds.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init, resetForTesting } from './init';
import { flushSpans } from './span-exporter';

const PAGE_ORIGIN = 'https://app.example.com';
const COLLECTOR = 'https://collector.example.com';

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
  init({ service: 'spa', endpoint: COLLECTOR });
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

interface OtlpSpan {
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes?: Array<{
    key: string;
    value: { stringValue?: string; intValue?: string };
  }>;
}

/** The spans the exporter posted, read back off its OTLP payloads. */
function exportedSpans(): OtlpSpan[] {
  flushSpans();
  return mockFetch.mock.calls
    .filter((call) => String(call[0]).startsWith(COLLECTOR))
    .flatMap((call) => {
      // SAFETY: every export posts `recordSpan`'s JSON string body; an absent
      // field reads as an empty list.
      const payload = JSON.parse(String(call[1]?.body)) as {
        resourceSpans?: Array<{ scopeSpans?: Array<{ spans?: OtlpSpan[] }> }>;
      };
      return (payload.resourceSpans ?? []).flatMap((resource) =>
        (resource.scopeSpans ?? []).flatMap((scope) => scope.spans ?? []),
      );
    });
}

function attributesOf(span: OtlpSpan): Record<string, string | number> {
  return Object.fromEntries(
    (span.attributes ?? []).map((a) => [
      a.key,
      a.value.stringValue ?? Number(a.value.intValue),
    ]),
  );
}

/** An SSE response whose single event is sent when `release()` is called. */
function heldStream(contentType = 'text/event-stream') {
  let release!: () => void;
  let fail!: (error: Error) => void;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      release = () => {
        controller.enqueue(new TextEncoder().encode('data: done\n\n'));
        controller.close();
      };
      fail = (error) => controller.error(error);
    },
  });
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  });
  return { response, release: () => release(), fail: (e: Error) => fail(e) };
}

describe('streamed responses', () => {
  it('ends the span when the stream finishes, not at the headers', async () => {
    const held = heldStream();
    mockFetch.mockResolvedValueOnce(held.response);

    const res = await patchedFetch()(`${PAGE_ORIGIN}/api/chat`, {
      method: 'POST',
    });
    expect(exportedSpans()).toHaveLength(0);

    held.release();
    expect(await res.text()).toBe('data: done\n\n');

    const spans = exportedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe('browser /api/chat');
    expect(attributesOf(spans[0]!)).toMatchObject({
      'http.request.method': 'POST',
      'http.response.status_code': 200,
    });
  });

  it('streams NDJSON the same way', async () => {
    const held = heldStream('application/x-ndjson');
    mockFetch.mockResolvedValueOnce(held.response);

    const res = await patchedFetch()(`${PAGE_ORIGIN}/api/feed`);
    expect(exportedSpans()).toHaveLength(0);
    held.release();
    await res.text();
    expect(exportedSpans()).toHaveLength(1);
  });

  it('ends the span when the reader cancels', async () => {
    const held = heldStream();
    mockFetch.mockResolvedValueOnce(held.response);

    const res = await patchedFetch()(`${PAGE_ORIGIN}/api/chat`);
    await res.body!.cancel();

    expect(exportedSpans()).toHaveLength(1);
  });

  it('records the error when the stream fails part-way', async () => {
    const held = heldStream();
    mockFetch.mockResolvedValueOnce(held.response);

    const res = await patchedFetch()(`${PAGE_ORIGIN}/api/chat`);
    held.fail(new TypeError('network error'));
    await expect(res.text()).rejects.toThrow('network error');

    const spans = exportedSpans();
    expect(spans).toHaveLength(1);
    expect(attributesOf(spans[0]!)).toMatchObject({
      'error.type': 'TypeError',
      'http.response.status_code': 200,
    });
  });

  it('keeps the network response url, redirect flag and type', async () => {
    const held = heldStream();
    Object.defineProperty(held.response, 'url', {
      value: `${PAGE_ORIGIN}/api/chat`,
    });
    Object.defineProperty(held.response, 'redirected', { value: true });
    mockFetch.mockResolvedValueOnce(held.response);

    const res = await patchedFetch()(`${PAGE_ORIGIN}/api/chat`);

    expect(res.url).toBe(`${PAGE_ORIGIN}/api/chat`);
    expect(res.redirected).toBe(true);
    expect(res.type).toBe(held.response.type);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
  });

  it('keeps them on clones, and clones of clones', async () => {
    const held = heldStream();
    Object.defineProperty(held.response, 'url', {
      value: `${PAGE_ORIGIN}/api/chat`,
    });
    Object.defineProperty(held.response, 'redirected', { value: true });
    mockFetch.mockResolvedValueOnce(held.response);

    const res = await patchedFetch()(`${PAGE_ORIGIN}/api/chat`);

    for (const copy of [res.clone(), res.clone().clone()]) {
      expect(copy.url).toBe(`${PAGE_ORIGIN}/api/chat`);
      expect(copy.redirected).toBe(true);
      expect(copy.type).toBe(held.response.type);
    }
    held.release();
    expect(await res.clone().text()).toBe('data: done\n\n');
  });

  it('still ends an ordinary response at the headers, read or not', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('{"ok":true}', {
        headers: { 'content-type': 'application/json' },
      }),
    );

    // Never reads the body: plenty of code only checks `res.ok`.
    const res = await patchedFetch()(`${PAGE_ORIGIN}/api/save`);

    expect(res.ok).toBe(true);
    expect(exportedSpans()).toHaveLength(1);
  });
});
