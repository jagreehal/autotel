/**
 * @vitest-environment jsdom
 *
 * Live-tail freeze contract.
 *
 * The rule this encodes: **rows never move under a reader.** The list updates
 * live only while nobody is reading it in a way that a reorder would disturb.
 * The moment someone types a query, scrolls back, selects a row or bounds the
 * time window, the view freezes and new matches are counted instead of
 * inserted — surfaced as a pill they can click to catch up.
 *
 * Freezing is therefore not a mode the user manages; it is a consequence of
 * what they just did. These tests pin which actions have that consequence.
 */

import { describe, it, expect } from 'vitest';
import {
  initialTail,
  reduceTail,
  isLive,
  pendingCount,
  type TailState,
} from '../liveTail';

/** Apply a sequence of actions from the initial state. */
function run(...actions: Parameters<typeof reduceTail>[1][]): TailState {
  return actions.reduce(reduceTail, initialTail());
}

describe('initial state', () => {
  it('starts live with nothing pending', () => {
    const state = initialTail();
    expect(isLive(state)).toBe(true);
    expect(pendingCount(state)).toBe(0);
  });
});

describe('actions that freeze the view', () => {
  it.each([
    ['typing a query', { type: 'query-changed', query: 'service = api' }],
    ['scrolling away from the top', { type: 'scrolled', atTop: false }],
    ['selecting a row', { type: 'row-selected' }],
    ['bounding the time window', { type: 'window-changed', bounded: true }],
  ] as const)('freezes on %s', (_label, action) => {
    expect(isLive(run(action))).toBe(false);
  });

  it('stays live when the query is cleared back to empty', () => {
    const state = run(
      { type: 'query-changed', query: 'service = api' },
      { type: 'query-changed', query: '' },
    );
    expect(isLive(state)).toBe(true);
  });

  it('stays live when the window goes back to unbounded', () => {
    const state = run(
      { type: 'window-changed', bounded: true },
      { type: 'window-changed', bounded: false },
    );
    expect(isLive(state)).toBe(true);
  });

  it('stays frozen after scrolling back to the top if a query is still set', () => {
    // Returning to the top is not consent to reorder while a query is active —
    // the result set is still something the reader is working through.
    const state = run(
      { type: 'query-changed', query: 'service = api' },
      { type: 'scrolled', atTop: false },
      { type: 'scrolled', atTop: true },
    );
    expect(isLive(state)).toBe(false);
  });

  it('returns to live when scrolled back to the top with nothing else holding it', () => {
    const state = run(
      { type: 'scrolled', atTop: false },
      { type: 'scrolled', atTop: true },
    );
    expect(isLive(state)).toBe(true);
  });
});

describe('counting while frozen', () => {
  it('counts arrivals instead of inserting them', () => {
    const state = run(
      { type: 'row-selected' },
      { type: 'arrived', count: 3 },
      { type: 'arrived', count: 2 },
    );
    expect(pendingCount(state)).toBe(5);
  });

  it('does not count arrivals while live — they are already on screen', () => {
    const state = run({ type: 'arrived', count: 4 });
    expect(pendingCount(state)).toBe(0);
  });

  it('clears the pending count on resume', () => {
    const state = run(
      { type: 'row-selected' },
      { type: 'arrived', count: 7 },
      { type: 'resumed' },
    );
    expect(isLive(state)).toBe(true);
    expect(pendingCount(state)).toBe(0);
  });

  it('resume overrides every reason the view was frozen', () => {
    // The pill is an explicit "catch me up" — it must work regardless of how
    // many things were independently holding the view frozen.
    const state = run(
      { type: 'query-changed', query: 'x' },
      { type: 'scrolled', atTop: false },
      { type: 'row-selected' },
      { type: 'window-changed', bounded: true },
      { type: 'arrived', count: 2 },
      { type: 'resumed' },
    );
    expect(isLive(state)).toBe(true);
  });

  it('starts counting again if the view re-freezes after a resume', () => {
    const state = run(
      { type: 'row-selected' },
      { type: 'arrived', count: 3 },
      { type: 'resumed' },
      { type: 'row-selected' },
      { type: 'arrived', count: 1 },
    );
    expect(pendingCount(state)).toBe(1);
  });

  it('never reports a negative count', () => {
    const state = run({ type: 'row-selected' }, { type: 'arrived', count: -5 });
    expect(pendingCount(state)).toBe(0);
  });
});

describe('deselecting', () => {
  it('returns to live when the selection is cleared and nothing else holds it', () => {
    const state = run({ type: 'row-selected' }, { type: 'row-deselected' });
    expect(isLive(state)).toBe(true);
  });

  it('stays frozen when the selection is cleared but a query remains', () => {
    const state = run(
      { type: 'query-changed', query: 'service = api' },
      { type: 'row-selected' },
      { type: 'row-deselected' },
    );
    expect(isLive(state)).toBe(false);
  });
});
