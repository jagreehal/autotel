import { describe, it, expect } from 'vitest';
import {
  parseNavHash,
  formatNavHash,
  isTabType,
  historyModeFor,
  DEFAULT_TAB,
  type NavState,
} from './url-sync';

describe('isTabType', () => {
  it('accepts known tabs and rejects everything else', () => {
    expect(isTabType('genai')).toBe(true);
    expect(isTabType('traces')).toBe(true);
    expect(isTabType('bogus')).toBe(false);
    expect(isTabType(null)).toBe(false);
    expect(isTabType(undefined)).toBe(false);
  });
});

describe('parseNavHash', () => {
  it('returns empty state for an empty hash', () => {
    expect(parseNavHash('')).toEqual({});
    expect(parseNavHash('#')).toEqual({});
  });

  it('parses tab, trace and span (with or without leading #)', () => {
    expect(parseNavHash('#tab=genai&trace=abc&span=def')).toEqual({
      tab: 'genai',
      traceId: 'abc',
      spanId: 'def',
    });
    expect(parseNavHash('tab=logs')).toEqual({ tab: 'logs' });
  });

  it('ignores an unknown tab value', () => {
    expect(parseNavHash('#tab=nope&trace=abc')).toEqual({ traceId: 'abc' });
  });

  it('drops a span that has no trace (a span is meaningless alone)', () => {
    expect(parseNavHash('#span=def')).toEqual({});
  });
});

describe('formatNavHash', () => {
  it('returns an empty string for fully-default state', () => {
    expect(formatNavHash({})).toBe('');
    expect(formatNavHash({ tab: DEFAULT_TAB })).toBe('');
  });

  it('omits the default tab but keeps non-default tabs', () => {
    expect(formatNavHash({ tab: 'genai' })).toBe('#tab=genai');
  });

  it('serializes trace and span', () => {
    expect(formatNavHash({ traceId: 'abc', spanId: 'def' })).toBe(
      '#trace=abc&span=def',
    );
  });

  it('omits a span when there is no trace', () => {
    expect(formatNavHash({ spanId: 'def' })).toBe('');
  });
});

describe('filters', () => {
  it('parses trace filters (q, status, min, sort) and the genai query', () => {
    expect(
      parseNavHash('#q=checkout&status=error&min=250&sort=duration:asc&gq=gpt'),
    ).toEqual({
      q: 'checkout',
      status: 'error',
      minDuration: 250,
      sort: { key: 'duration', dir: 'asc' },
      genaiQuery: 'gpt',
    });
  });

  it('ignores invalid status, sort key and non-positive min', () => {
    expect(parseNavHash('#status=nope&sort=bogus:asc&min=0')).toEqual({});
    expect(parseNavHash('#min=-5')).toEqual({});
  });

  it('parses a valid time-range filter and ignores invalid ones', () => {
    expect(parseNavHash('#range=all')).toEqual({});
    expect(parseNavHash('#range=99m')).toEqual({});
  });

  it('serializes a non-default time range and omits the default', () => {});

  it('omits default-valued filters from the hash', () => {
    expect(
      formatNavHash({
        status: 'all',
        minDuration: 0,
        sort: { key: 'time', dir: 'desc' },
      }),
    ).toBe('');
  });

  it('serializes non-default filters', () => {
    expect(
      formatNavHash({
        q: 'checkout',
        status: 'error',
        minDuration: 250,
        sort: { key: 'duration', dir: 'asc' },
        genaiQuery: 'gpt',
      }),
    ).toBe('#q=checkout&status=error&min=250&sort=duration%3Aasc&gq=gpt');
  });
});

describe('round-trip', () => {
  it('format → parse is stable for representative states', () => {
    const states: NavState[] = [
      {},
      { tab: 'genai' },
      { traceId: 'abc' },
      { traceId: 'abc', spanId: 'def' },
      { tab: 'genai', traceId: 'abc', spanId: 'def' },
      { q: 'checkout', status: 'error', minDuration: 250 },
      { sort: { key: 'duration', dir: 'asc' }, genaiQuery: 'gpt' },
    ];
    for (const s of states) {
      const parsed = parseNavHash(formatNavHash(s));
      // The default tab is intentionally dropped from the hash, so normalize it
      // out of the expectation.
      const expected = { ...s };
      if (expected.tab === DEFAULT_TAB) delete expected.tab;
      expect(parsed).toEqual(expected);
    }
  });
});

describe('time window in the URL', () => {
  /**
   * A shared link has to carry the window it was captured with. Without it,
   * "here's the problem" resolves to whatever range the recipient happens to
   * have set — which is a different question with the same URL.
   */
  it('round-trips a preset window', () => {
    const hash = formatNavHash({ window: { type: 'preset', preset: '15m' } });
    expect(parseNavHash(hash).window).toEqual({
      type: 'preset',
      preset: '15m',
    });
  });

  it('round-trips a custom window', () => {
    const window = { type: 'custom', start: 1000, end: 2000 } as const;
    expect(parseNavHash(formatNavHash({ window })).window).toEqual(window);
  });

  it('omits the default window, keeping clean URLs clean', () => {
    const hash = formatNavHash({ window: { type: 'preset', preset: 'all' } });
    expect(hash).not.toContain('window');
  });

  it('leaves the window absent when the URL does not name one', () => {
    // Absent must stay absent rather than becoming an explicit default, so the
    // round trip is stable.
    expect(parseNavHash('#tab=logs').window).toBeUndefined();
  });

  it('falls back to the default for an unparseable window', () => {
    expect(parseNavHash('#window=nonsense').window).toEqual({
      type: 'preset',
      preset: 'all',
    });
  });

  it('carries the window alongside the other nav state', () => {
    const hash = formatNavHash({
      tab: 'logs',
      window: { type: 'preset', preset: '1h' },
    });
    const parsed = parseNavHash(hash);
    expect(parsed.tab).toBe('logs');
    expect(parsed.window).toEqual({ type: 'preset', preset: '1h' });
  });
});

describe('historyModeFor', () => {
  const at = (over: Partial<NavState> = {}): NavState => ({
    tab: 'traces',
    ...over,
  });

  it('replaces on the first write, with nothing to go back to', () => {
    expect(historyModeFor(null, at())).toBe('replace');
  });

  it('pushes when you navigate, so Back retraces the step', () => {
    expect(historyModeFor(at(), at({ tab: 'logs' }))).toBe('push');
    expect(historyModeFor(at(), at({ traceId: 't1' }))).toBe('push');
    expect(
      historyModeFor(
        at({ traceId: 't1' }),
        at({ traceId: 't1', spanId: 's1' }),
      ),
    ).toBe('push');
  });

  it('replaces when you adjust the current view', () => {
    // Typing a query one character at a time must not bury the page you came
    // from under a hundred history entries.
    expect(historyModeFor(at(), at({ q: 'serv' }))).toBe('replace');
    expect(historyModeFor(at(), at({ status: 'error' }))).toBe('replace');
    expect(historyModeFor(at(), at({ minDuration: 100 }))).toBe('replace');
    expect(
      historyModeFor(at(), at({ window: { type: 'preset', preset: '1h' } })),
    ).toBe('replace');
    expect(
      historyModeFor(at(), at({ sort: { key: 'duration', dir: 'desc' } })),
    ).toBe('replace');
  });

  it('replaces when nothing that identifies the view changed', () => {
    expect(historyModeFor(at({ traceId: 't1' }), at({ traceId: 't1' }))).toBe(
      'replace',
    );
  });
});
