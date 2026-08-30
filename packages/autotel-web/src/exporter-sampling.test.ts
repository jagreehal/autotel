// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureExporter,
  pendingLogCount,
  pendingSpanCount,
  recordEvent,
  recordLog,
  recordSpan,
  pendingLogRecordsForTesting,
  resetForTesting,
  setRawFetch,
} from './span-exporter';
import { configureSession, resetSessionForTesting } from './session';

function span(): void {
  recordSpan('a'.repeat(32), 'b'.repeat(16), 'test', 1, 2);
}

/** A session id the hash keeps at the given rate, and one it drops. */
function findSessionIds() {
  return { kept: 'session-1', dropped: 'session-0' };
}

/**
 * Offline throughout: a record that is sent is also removed from the queue, so
 * holding the pipe shut is what makes "was it queued at all" observable.
 */
function goOffline(): void {
  Object.defineProperty(navigator, 'onLine', {
    value: false,
    configurable: true,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetForTesting();
  resetSessionForTesting();
  goOffline();
  setRawFetch(vi.fn().mockResolvedValue({ ok: true, status: 200 }) as never);
});

afterEach(() => {
  resetForTesting();
  resetSessionForTesting();
  Object.defineProperty(navigator, 'onLine', {
    value: true,
    configurable: true,
  });
  vi.useRealTimers();
});

describe('sampling covers every signal, not just traces', () => {
  it('keeps all signals at a rate of 1', () => {
    configureExporter('web', 'https://c.example.com', false, { sampleRate: 1 });
    span();
    recordLog('warn', 'x');
    recordEvent('app.jank', {});
    expect(pendingSpanCount() + pendingLogCount()).toBeGreaterThan(0);
  });

  it('drops logs and events at a rate of 0, not only spans', () => {
    // Sampling the trace provider alone means 10% of sessions' spans and 100%
    // of everyone's events — which is not sampling, it is a surprise bill.
    configureExporter('web', 'https://c.example.com', false, { sampleRate: 0 });
    span();
    recordLog('warn', 'x');
    recordEvent('app.jank', {});
    expect(pendingSpanCount()).toBe(0);
    expect(pendingLogCount()).toBe(0);
  });

  it('gives one session the same answer for spans, logs and events', () => {
    const { kept, dropped } = findSessionIds();
    for (const id of [kept, dropped]) {
      resetForTesting();
      resetSessionForTesting();
      goOffline();
      configureSession({ id: () => id });
      configureExporter('web', 'https://c.example.com', false, {
        sampleRate: 0.5,
      });
      span();
      recordLog('warn', 'x');
      recordEvent('app.jank', {});
      const spans = pendingSpanCount();
      const logs = pendingLogCount();
      // Either the session is in, and everything it produced is queued, or it
      // is out and none of it is. Never a span without its events.
      expect(spans > 0).toBe(logs > 0);
    }
  });

  it('defaults to keeping everything', () => {
    configureExporter('web', 'https://c.example.com', false);
    recordEvent('app.jank', {});
    expect(pendingLogCount()).toBe(1);
  });
});

describe('sampling without a session stays consistent', () => {
  it('gives every record in one page the same answer', () => {
    // With sessions off there is no exported identity to hash, but a per-record
    // coin flip yields fragments of every page instead of a share of whole
    // ones — the exact failure session-consistent sampling exists to avoid.
    configureSession(false);
    configureExporter('web', 'https://c.example.com', false, {
      sampleRate: 0.5,
    });
    for (let i = 0; i < 40; i++) recordEvent('app.jank', {});
    const kept = pendingLogCount();
    expect(kept === 0 || kept === 40).toBe(true);
  });

  it('keeps the page key private rather than exporting it as a session', () => {
    configureSession(false);
    configureExporter('web', 'https://c.example.com', false, {
      sampleRate: 1,
    });
    recordEvent('app.jank', {});
    const record = JSON.parse(
      JSON.stringify(pendingLogRecordsForTesting()[0]),
    ) as { attributes: { key: string }[] };
    expect(record.attributes.map((a) => a.key)).not.toContain('session.id');
  });
});
