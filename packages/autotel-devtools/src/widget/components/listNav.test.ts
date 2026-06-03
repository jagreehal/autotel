import { describe, it, expect } from 'vitest';
import { clampCursor, nextCursor } from './listNav.svelte';

describe('clampCursor', () => {
  it('leaves an in-range cursor untouched', () => {
    expect(clampCursor(3, 10)).toBe(3);
    expect(clampCursor(0, 10)).toBe(0);
    expect(clampCursor(9, 10)).toBe(9);
  });

  it('pulls a cursor past the end back to the last row', () => {
    expect(clampCursor(9, 5)).toBe(4);
  });

  it('collapses to -1 when the list empties', () => {
    expect(clampCursor(3, 0)).toBe(-1);
    expect(clampCursor(-1, 0)).toBe(-1);
  });
});

describe('nextCursor', () => {
  it('does nothing on an empty list', () => {
    expect(nextCursor(-1, 1, 0, 'first')).toBe(-1);
    expect(nextCursor(2, -1, 0, 'last')).toBe(2);
  });

  it('moves down from unset to the first row regardless of fromUnsetUp', () => {
    expect(nextCursor(-1, 1, 5, 'first')).toBe(0);
    expect(nextCursor(-1, 1, 5, 'last')).toBe(0);
  });

  it("moves up from unset to the first row when fromUnsetUp is 'first' (Traces/Errors)", () => {
    expect(nextCursor(-1, -1, 5, 'first')).toBe(0);
  });

  it("moves up from unset to the last row when fromUnsetUp is 'last' (GenAI)", () => {
    expect(nextCursor(-1, -1, 5, 'last')).toBe(4);
  });

  it('steps within the list and clamps at both ends', () => {
    expect(nextCursor(2, 1, 5, 'first')).toBe(3);
    expect(nextCursor(2, -1, 5, 'first')).toBe(1);
    expect(nextCursor(4, 1, 5, 'first')).toBe(4); // already last
    expect(nextCursor(0, -1, 5, 'first')).toBe(0); // already first
  });
});
