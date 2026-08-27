/**
 * @vitest-environment jsdom
 *
 * Time-window contract.
 *
 * One window is shared by every tab, so the rules about what a window *means*
 * live here rather than in each view. The subtle one, and the reason this is a
 * module rather than a number: "All" is the absence of a choice, so a view may
 * fit itself to its own data. Every other selection is a request, and cropping
 * it would hide the emptiness that is part of the answer — an empty 15-minute
 * window is a finding, not a rendering problem to be worked around.
 */

import { describe, it, expect } from 'vitest';
import {
  PRESETS,
  presetWindow,
  isUnbounded,
  resolveWindow,
  windowLabel,
  parseWindowParam,
  serializeWindow,
  type TimeWindow,
} from '../timeWindow';

const NOW = 1_700_000_000_000;

describe('presets', () => {
  it('offers All plus a range of durations, All first', () => {
    expect(PRESETS[0].id).toBe('all');
    expect(PRESETS.map((p) => p.id)).toEqual([
      'all',
      '5m',
      '15m',
      '30m',
      '1h',
      '3h',
      '6h',
      '24h',
      '7d',
    ]);
  });

  it('anchors a preset window to end at now', () => {
    const window = presetWindow('15m', NOW);
    expect(window.end).toBe(NOW);
    expect(window.start).toBe(NOW - 15 * 60_000);
  });

  it('re-anchors on every resolve, so a preset keeps tracking now', () => {
    const selection = { type: 'preset', preset: '5m' } as const;
    const first = resolveWindow(selection, NOW);
    const later = resolveWindow(selection, NOW + 60_000);
    expect(later.end).toBe(NOW + 60_000);
    // Both are bounded windows, so the bounds are non-null here.
    expect(later.start).toBe((first.start as number) + 60_000);
  });

  it('resolves All to an unbounded window', () => {
    const window = resolveWindow({ type: 'preset', preset: 'all' }, NOW);
    expect(isUnbounded(window)).toBe(true);
  });
});

describe('custom windows', () => {
  it('uses custom bounds verbatim rather than re-anchoring them', () => {
    const selection = {
      type: 'custom',
      start: NOW - 100_000,
      end: NOW - 50_000,
    } as const;
    const first = resolveWindow(selection, NOW);
    const later = resolveWindow(selection, NOW + 999_999);
    expect(later).toEqual(first);
  });

  it('orders reversed custom bounds instead of returning an empty window', () => {
    const window = resolveWindow(
      { type: 'custom', start: NOW, end: NOW - 1000 },
      NOW,
    );
    // A custom window always has both bounds; `toBeLessThan` needs the number.
    expect(window.start as number).toBeLessThan(window.end as number);
  });

  it('is not unbounded even when the range is very wide', () => {
    const window = resolveWindow({ type: 'custom', start: 0, end: NOW }, NOW);
    expect(isUnbounded(window)).toBe(false);
  });
});

describe('isUnbounded', () => {
  it('treats only the absent-choice window as unbounded', () => {
    expect(isUnbounded({ start: null, end: null })).toBe(true);
    expect(isUnbounded({ start: NOW - 1000, end: NOW })).toBe(false);
  });
});

describe('labels', () => {
  it('names a preset by its short label', () => {
    expect(windowLabel({ type: 'preset', preset: '15m' })).toBe('Last 15m');
    expect(windowLabel({ type: 'preset', preset: 'all' })).toBe('All time');
  });

  it('names a custom window by its bounds', () => {
    const label = windowLabel({
      type: 'custom',
      start: NOW - 60_000,
      end: NOW,
    });
    expect(label).toMatch(/→/);
  });
});

describe('URL round trip', () => {
  it('round-trips a preset', () => {
    const selection = { type: 'preset', preset: '1h' } as const;
    expect(parseWindowParam(serializeWindow(selection))).toEqual(selection);
  });

  it('round-trips a custom window', () => {
    const selection = {
      type: 'custom',
      start: NOW - 5000,
      end: NOW,
    } as const;
    expect(parseWindowParam(serializeWindow(selection))).toEqual(selection);
  });

  it('omits the default so clean URLs stay clean', () => {
    expect(serializeWindow({ type: 'preset', preset: 'all' })).toBeNull();
  });

  it('falls back to the default on anything unparseable', () => {
    for (const raw of ['', 'nonsense', 'custom:abc', 'custom:1', null]) {
      expect(parseWindowParam(raw)).toEqual({ type: 'preset', preset: 'all' });
    }
  });
});

describe('query payload', () => {
  it('omits the window entirely when unbounded, rather than sending epoch 0', () => {
    // A window of [0, now] is not the same request as "no window": it would
    // force the server to filter on a column it could otherwise ignore.
    const window: TimeWindow = { start: null, end: null };
    expect(toQueryWindow(window)).toBeUndefined();
  });

  it('sends both bounds when the window is a real request', () => {
    expect(toQueryWindow({ start: 5, end: 10 })).toEqual({ start: 5, end: 10 });
  });
});

/** Local helper mirroring what the query client does with a resolved window. */
function toQueryWindow(window: TimeWindow) {
  return isUnbounded(window)
    ? undefined
    : { start: window.start as number, end: window.end as number };
}
