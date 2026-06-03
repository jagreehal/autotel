// src/widget/components/listNav.svelte.ts
//
// Keyboard navigation for the dense list views (Traces, Errors, GenAI), which
// all grew the same handler independently: a `cursor` into the filtered list,
// j/k + ArrowUp/Down to move it, scrollIntoView on move, Enter to activate the
// row, and an input-guard so typing in the search box keeps its arrow keys.
//
// `useListKeyboardNav(options)` owns the `cursor` $state (read it for row
// highlighting, set it from row clicks) and clamps it as the list changes;
// spread `onKeyDown` onto the focusable list container. Mirrors the
// `useResizable` rune so the views share one shape.

export interface ListKeyboardNavOptions {
  /** Reactive count of rows currently displayed (the filtered list length). */
  count: () => number;
  /** Activate (open/select) the row at `index` — fired on Enter. */
  onActivate: (index: number) => void;
  /** Bring the row at `index` into view after a cursor move. */
  scrollToIndex?: (index: number) => void;
  /**
   * Where Up lands when no row is focused yet (cursor = -1): `'first'` moves to
   * row 0 (Traces/Errors), `'last'` jumps to the end (GenAI). Down always goes
   * to row 0 from unset. Defaults to `'first'`.
   */
  fromUnsetUp?: 'first' | 'last';
}

export interface ListKeyboardNav {
  /** Index into the filtered list; -1 = no row focused. Settable from clicks. */
  cursor: number;
  onKeyDown: (event: KeyboardEvent) => void;
}

function targetIsTextEntry(event: KeyboardEvent): boolean {
  const t = event.target as HTMLElement;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;
}

/**
 * Clamp the cursor into range as the list changes. -1 (no row focused) and an
 * empty list (`count` 0, so the ceiling is -1) both collapse to -1. Pure so the
 * shared nav math is unit-tested without a runes runtime.
 */
export function clampCursor(cursor: number, count: number): number {
  return cursor > count - 1 ? count - 1 : cursor;
}

/**
 * The cursor's next index for a move of `delta` (±1), clamped to the list. Down
 * from unset goes to the first row; Up from unset goes to the first or last row
 * per `fromUnsetUp`. An empty list leaves the cursor unchanged.
 */
export function nextCursor(
  cursor: number,
  delta: number,
  count: number,
  fromUnsetUp: 'first' | 'last',
): number {
  if (count === 0) return cursor;
  if (cursor < 0) {
    return delta > 0 ? 0 : fromUnsetUp === 'last' ? count - 1 : 0;
  }
  return Math.min(Math.max(cursor + delta, 0), count - 1);
}

export function useListKeyboardNav(
  options: ListKeyboardNavOptions,
): ListKeyboardNav {
  const { count, onActivate, scrollToIndex, fromUnsetUp = 'first' } = options;

  // The user sets the cursor directly (keyboard moves, row clicks); we only ever
  // want it *clamped* to the current list. Keep the raw intent in $state and
  // expose the clamped value as a $derived — no state-mutating $effect. (As a
  // result, a cursor pushed off the end by a shrinking list pops back when the
  // list grows again, e.g. on clearing a filter, rather than staying clamped.)
  let rawCursor = $state(-1);
  const cursor = $derived(clampCursor(rawCursor, count()));

  const move = (delta: number) => {
    if (count() === 0) return;
    rawCursor = nextCursor(cursor, delta, count(), fromUnsetUp);
    scrollToIndex?.(rawCursor);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // Let the search input keep arrow keys for moving the text caret.
    if (targetIsTextEntry(event)) return;
    if (event.key === 'ArrowDown' || event.key === 'j') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp' || event.key === 'k') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      if (cursor >= 0 && cursor < count()) {
        event.preventDefault();
        onActivate(cursor);
      }
    }
  };

  return {
    get cursor() {
      return cursor;
    },
    set cursor(value: number) {
      rawCursor = value;
    },
    onKeyDown,
  };
}
