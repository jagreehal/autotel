// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureExporter,
  flushSpans,
  pendingSpanCount,
  recordSpan,
  resetForTesting,
  setRawFetch,
} from './span-exporter';
import { resetSessionForTesting } from './session';

let fetchMock: ReturnType<typeof vi.fn>;

function span(name = 'test'): void {
  recordSpan('a'.repeat(32), 'b'.repeat(16), name, 1, 2);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetForTesting();
  resetSessionForTesting();
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  setRawFetch(fetchMock as unknown as typeof globalThis.fetch);
  // sendBeacon is fire-and-forget and reports nothing, so it cannot be retried
  // against; the exporter must prefer fetch while the page is alive.
  Object.defineProperty(navigator, 'sendBeacon', {
    value: vi.fn(() => true),
    configurable: true,
  });
  configureExporter('web', 'https://collector.example.com', false);
});

afterEach(() => {
  resetForTesting();
  vi.useRealTimers();
});

describe('delivery', () => {
  it("exports to the same-origin path when endpoint is ''", async () => {
    // '' is the documented same-origin configuration, not "no endpoint".
    configureExporter('web', '', false);
    span();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/traces');
  });

  it('sends through fetch so the outcome is known', async () => {
    span();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(navigator.sendBeacon).not.toHaveBeenCalled();
  });

  it('drops nothing on success', async () => {
    span();
    await vi.advanceTimersByTimeAsync(0);
    expect(pendingSpanCount()).toBe(0);
  });

  it('keeps spans and retries after a server error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    span();
    await vi.advanceTimersByTimeAsync(0);
    expect(pendingSpanCount()).toBe(1);

    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pendingSpanCount()).toBe(0);
  });

  it('backs off rather than hammering', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    span();
    await vi.advanceTimersByTimeAsync(0);
    const afterFirst = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock.mock.calls.length).toBe(afterFirst);
  });

  it('gives up on a batch rather than retrying forever', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    span();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(pendingSpanCount()).toBe(0);
    expect(fetchMock.mock.calls.length).toBeLessThan(20);
  });

  it('stops sending after repeated failures with no response at all', async () => {
    // A request that dies before any HTTP status while the browser reports
    // itself online is an ad blocker or CORS, not a blip. Retrying that only
    // burns battery.
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    for (let i = 0; i < 3; i++) {
      span();
      await vi.advanceTimersByTimeAsync(60_000);
    }
    const callsWhenTripped = fetchMock.mock.calls.length;
    span();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock.mock.calls.length).toBe(callsWhenTripped);
  });

  it('reopens when the browser says it is back online', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    for (let i = 0; i < 3; i++) {
      span();
      await vi.advanceTimersByTimeAsync(60_000);
    }
    const tripped = fetchMock.mock.calls.length;

    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    window.dispatchEvent(new Event('online'));
    span();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(tripped);
  });

  it('queues instead of sending while offline', async () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    });
    span();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pendingSpanCount()).toBe(1);

    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
    });
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(pendingSpanCount()).toBe(0);
  });

  it('bounds the queue so an unreachable collector cannot grow it forever', async () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    });
    for (let i = 0; i < 3000; i++) span();
    expect(pendingSpanCount()).toBeLessThanOrEqual(1000);
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
    });
  });

  it('uses sendBeacon on the way out, where fetch cannot finish', () => {
    // Queue without sending, so there is something left for the unload path.
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    });
    span();
    flushSpans({ beacon: true });
    expect(navigator.sendBeacon).toHaveBeenCalled();
    expect(pendingSpanCount()).toBe(0);
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
    });
  });
});

describe('unload and exhaustion keep what they should', () => {
  function queueOffline(count = 1): void {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    });
    for (let i = 0; i < count; i++) span();
  }
  function goOnline(): void {
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
    });
  }

  it('keeps the queue when sendBeacon refuses the payload', () => {
    // sendBeacon returns false when the payload exceeds the browser's limit or
    // its queue is full. Clearing first turns a refusal into silent data loss
    // at the exact moment — page unload — when there is no second chance.
    vi.mocked(navigator.sendBeacon).mockReturnValue(false);
    queueOffline(2);
    flushSpans({ beacon: true });
    expect(pendingSpanCount()).toBe(2);
    goOnline();
  });

  it('clears the queue when sendBeacon accepts it', () => {
    vi.mocked(navigator.sendBeacon).mockReturnValue(true);
    queueOffline(2);
    flushSpans({ beacon: true });
    expect(pendingSpanCount()).toBe(0);
    goOnline();
  });

  it('keeps the queue when sendBeacon is unavailable', () => {
    Object.defineProperty(navigator, 'sendBeacon', {
      value: undefined,
      configurable: true,
    });
    queueOffline(1);
    flushSpans({ beacon: true });
    expect(pendingSpanCount()).toBe(1);
    goOnline();
  });

  it('drops only the exhausted batch, not records queued behind it', async () => {
    // One payload the collector will not take, and healthy records behind it.
    // Merging the retried batch with the queue makes the healthy ones part of a
    // batch that gets given up on — so one bad payload takes the visit with it.
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve(
        String(init.body).includes('poison')
          ? { ok: false, status: 503 }
          : { ok: true, status: 200 },
      ),
    );

    recordSpan('a'.repeat(32), 'b'.repeat(16), 'poison', 1, 2);
    await vi.advanceTimersByTimeAsync(0);

    recordSpan('c'.repeat(32), 'd'.repeat(16), 'healthy-1', 1, 2);
    recordSpan('e'.repeat(32), 'f'.repeat(16), 'healthy-2', 1, 2);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    const bodies = fetchMock.mock.calls.map(([, init]) =>
      String((init as RequestInit).body),
    );
    // The healthy records reached the collector on their own, rather than
    // riding — and dying — with the batch in front of them.
    expect(
      bodies.some((b) => b.includes('healthy-1') && !b.includes('poison')),
    ).toBe(true);
    expect(pendingSpanCount()).toBe(0);
  });
});

describe('unload during backoff', () => {
  it('beacons the batch awaiting retry, not just the queue behind it', async () => {
    // The retry timer will never fire again once the page is gone, so a batch
    // mid-backoff is lost unless unload carries it.
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    recordSpan('a'.repeat(32), 'b'.repeat(16), 'in-backoff', 1, 2);
    await vi.advanceTimersByTimeAsync(0);
    expect(pendingSpanCount()).toBe(1);

    vi.mocked(navigator.sendBeacon).mockReturnValue(true);
    flushSpans({ beacon: true });

    const body = String(vi.mocked(navigator.sendBeacon).mock.calls[0]?.[1]);
    expect(pendingSpanCount()).toBe(0);
    expect(vi.mocked(navigator.sendBeacon)).toHaveBeenCalled();
    expect(body).toBeDefined();
  });

  it('keeps the retry batch when the beacon refuses it', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    recordSpan('a'.repeat(32), 'b'.repeat(16), 'in-backoff', 1, 2);
    await vi.advanceTimersByTimeAsync(0);

    vi.mocked(navigator.sendBeacon).mockReturnValue(false);
    flushSpans({ beacon: true });
    expect(pendingSpanCount()).toBe(1);
  });
});
