import { describe, expect, it } from 'vitest';
import { fitJson } from './messages';
import type { Json } from './types';

describe('fitJson', () => {
  it('leaves a value that fits untouched', () => {
    expect(fitJson({ a: 1 }, 100)).toBe('{"a":1}');
  });

  it('cuts long strings before touching the structure', () => {
    const text = fitJson({ role: 'user', content: 'x'.repeat(1000) }, 120);
    expect(text?.length).toBeLessThanOrEqual(120);
    expect(JSON.parse(String(text))).toMatchObject({ role: 'user' });
  });

  it('drops trailing entries behind a marker when strings are not enough', () => {
    const text = fitJson(
      Array.from({ length: 200 }, (_, n) => n),
      60,
    );
    expect(text?.length).toBeLessThanOrEqual(60);
    const parsed = JSON.parse(String(text));
    expect(parsed[0]).toBe(0);
    expect(String(parsed.at(-1))).toMatch(/^\.\.\.\[\d+ more\]$/);
  });

  it('always returns valid JSON within the limit', () => {
    const nested = {
      messages: Array.from({ length: 30 }, (_, n) => ({
        role: 'user',
        parts: Array.from({ length: 10 }, () => ({
          type: 'text',
          content: `${n}`.repeat(50),
        })),
      })),
    };
    for (const max of [8, 40, 300, 2000]) {
      const text = String(fitJson(nested, max));
      expect(() => JSON.parse(text)).not.toThrow();
      if (max >= 40) expect(text.length).toBeLessThanOrEqual(max);
    }
  });

  it('returns undefined for a value JSON cannot hold', () => {
    // A value that holds itself: JSON cannot represent it.
    const cycle: Record<string, Json> = {};
    cycle.self = cycle;
    expect(fitJson(cycle, 100)).toBeUndefined();
  });
});

describe('fitJson on large payloads', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: i,
      name: `row ${i}`,
      tags: ['a', 'b'],
    }));

  // It runs on the page's main thread, so it has to stay fast.
  it('trims 20,000 rows to the default limit in well under a second', () => {
    const started = performance.now();
    const text = String(fitJson({ rows: rows(20_000) }, 32_768));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(text.length).toBeLessThanOrEqual(32_768);
    const parsed = JSON.parse(text);
    expect(parsed.rows[0]).toEqual({ id: 0, name: 'row 0', tags: ['a', 'b'] });
    expect(String(parsed.rows.at(-1))).toMatch(/^\.\.\.\[\d+ more\]$/);
  });

  it('keeps as many entries as fit, not fewer', () => {
    const value = { rows: rows(2000) };
    const text = String(fitJson(value, 4000));
    const kept = JSON.parse(text).rows.length - 1;
    // One more entry would not have fitted.
    const oneMore = JSON.stringify({
      rows: [...value.rows.slice(0, kept + 1), `...[${2000 - kept - 1} more]`],
    });
    expect(oneMore.length).toBeGreaterThan(4000);
  });

  it('never edits the value it was given', () => {
    const value = { rows: rows(500) };
    const before = JSON.stringify(value);
    fitJson(value, 300);
    expect(JSON.stringify(value)).toBe(before);
  });
});
