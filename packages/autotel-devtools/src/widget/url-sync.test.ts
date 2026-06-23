import { describe, it, expect } from 'vitest';
import {
  parseNavHash,
  formatNavHash,
  isTabType,
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
