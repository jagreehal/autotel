import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the span exporter so we can (a) keep it inert for header tests and
// (b) capture the attributes recorded for local browser spans.
vi.mock('./span-exporter', () => ({
  configureExporter: vi.fn(),
  setRawFetch: vi.fn(),
  recordSpan: vi.fn(),
  flushSpans: vi.fn(),
  isConfigured: vi.fn(() => true),
  resetForTesting: vi.fn(),
}));

import { init, setBaggage, clearBaggage, resetForTesting } from './init';
import { recordSpan } from './span-exporter';

const ORIGIN = 'https://app.example.com';

/** Install a minimal mutable window and return the underlying fetch mock. */
function installWindow() {
  const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
  vi.stubGlobal('window', {
    fetch: mockFetch,
    location: { origin: ORIGIN, href: `${ORIGIN}/` },
    addEventListener: vi.fn(),
  });
  return mockFetch;
}

/** Read the baggage header from the most recent patched-fetch call. */
function lastBaggage(mockFetch: ReturnType<typeof vi.fn>): string | null {
  const call = mockFetch.mock.calls.at(-1);
  const headers = call?.[1]?.headers as Headers | undefined;
  return headers instanceof Headers ? headers.get('baggage') : null;
}

describe('init() baggage propagation', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetForTesting();
    vi.mocked(recordSpan).mockClear();
    mockFetch = installWindow();
  });

  afterEach(() => {
    resetForTesting();
    vi.unstubAllGlobals();
  });

  it('injects baggage on same-origin requests', async () => {
    init({ service: 'spa', instrumentXHR: false });
    setBaggage({ 'tenant.id': 'acme' });

    await (window as unknown as { fetch: typeof fetch }).fetch('/api/users');

    expect(lastBaggage(mockFetch)).toBe('tenant.id=acme');
  });

  it('does NOT inject baggage when none is set', async () => {
    init({ service: 'spa', instrumentXHR: false });

    await (window as unknown as { fetch: typeof fetch }).fetch('/api/users');

    expect(lastBaggage(mockFetch)).toBeNull();
  });

  it('does NOT inject baggage cross-origin by default (fail-closed)', async () => {
    init({ service: 'spa', instrumentXHR: false });
    setBaggage({ 'tenant.id': 'acme' });

    await (window as unknown as { fetch: typeof fetch }).fetch('https://analytics.google.com/c');

    expect(lastBaggage(mockFetch)).toBeNull();
  });

  it('injects baggage cross-origin only when allowlisted', async () => {
    init({ service: 'spa', instrumentXHR: false, baggage: { allowedOrigins: ['api.partner.com'] } });
    setBaggage({ 'tenant.id': 'acme' });

    await (window as unknown as { fetch: typeof fetch }).fetch('https://api.partner.com/x');
    expect(lastBaggage(mockFetch)).toBe('tenant.id=acme');

    await (window as unknown as { fetch: typeof fetch }).fetch('https://other.com/y');
    expect(lastBaggage(mockFetch)).toBeNull();
  });

  it('seeds initial baggage from init() config', async () => {
    init({ service: 'spa', instrumentXHR: false, baggage: { initial: { 'tenant.id': 'globex' } } });

    await (window as unknown as { fetch: typeof fetch }).fetch('/api/users');

    expect(lastBaggage(mockFetch)).toBe('tenant.id=globex');
  });

  it('stops injecting after clearBaggage()', async () => {
    init({ service: 'spa', instrumentXHR: false });
    setBaggage({ 'tenant.id': 'acme' });
    clearBaggage();

    await (window as unknown as { fetch: typeof fetch }).fetch('/api/users');

    expect(lastBaggage(mockFetch)).toBeNull();
  });

  it('respects Do Not Track (baggage is a subset of traceparent)', async () => {
    Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
    init({ service: 'spa', instrumentXHR: false, privacy: { respectDoNotTrack: true } });
    setBaggage({ 'tenant.id': 'acme' });

    await (window as unknown as { fetch: typeof fetch }).fetch('/api/users');

    expect(lastBaggage(mockFetch)).toBeNull();
    Object.defineProperty(navigator, 'doNotTrack', { value: null, configurable: true });
  });

  it('tags local browser spans with current baggage even cross-origin', async () => {
    init({ service: 'spa', instrumentXHR: false, endpoint: ORIGIN });
    setBaggage({ 'tenant.id': 'acme' });

    // Cross-origin: baggage header is NOT sent, but the local span is still tagged.
    await (window as unknown as { fetch: typeof fetch }).fetch('https://analytics.google.com/c');
    await new Promise((r) => setTimeout(r, 0)); // let the fetch .then run

    expect(lastBaggage(mockFetch)).toBeNull();
    expect(recordSpan).toHaveBeenCalled();
    const attrs = vi.mocked(recordSpan).mock.calls.at(-1)?.[5] as Record<string, unknown>;
    expect(attrs['tenant.id']).toBe('acme');
    expect(attrs['http.url']).toBe('https://analytics.google.com/c');
  });
});
