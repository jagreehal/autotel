// src/widget/utils/pointerDrag.ts
//
// The drag mechanic shared by every pointer-drag controller in the widget
// (side-panel resize, docked-panel resize, drag-to-dock): on pointerdown, lock
// the body cursor + disable text selection so the gesture reads cleanly
// anywhere on the page, forward each pointermove, and restore + clean up on
// pointerup. Controllers differ only in what a move means, which they supply.

export interface PointerDragOptions {
  /** Body cursor shown for the duration of the drag, e.g. 'col-resize'. */
  cursor: string;
  /** Run once when the drag begins (after the body styles are applied). */
  onStart?: () => void;
  /** Run on every pointermove with the live event. */
  onMove: (event: PointerEvent) => void;
  /** Run once when the drag ends (pointerup), after the body styles restore. */
  onEnd?: () => void;
}

/**
 * Begin a pointer drag from a `pointerdown`. Calls `preventDefault` on the
 * initiating event, then drives `onMove` until `pointerup`. The caller captures
 * whatever start state it needs (start coordinate, current size) before calling.
 */
export function startPointerDrag(
  event: PointerEvent,
  options: PointerDragOptions,
): void {
  event.preventDefault();
  const prevCursor = document.body.style.cursor;
  const prevSelect = document.body.style.userSelect;
  document.body.style.cursor = options.cursor;
  document.body.style.userSelect = 'none';
  options.onStart?.();

  const onMove = (move: PointerEvent) => options.onMove(move);
  const onUp = () => {
    document.body.style.cursor = prevCursor;
    document.body.style.userSelect = prevSelect;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    options.onEnd?.();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}
