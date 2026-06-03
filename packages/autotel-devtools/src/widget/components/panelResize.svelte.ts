// src/widget/components/panelResize.svelte.ts
//
// Resize for the docked Panel: drag (or arrow-key) the inner edge along the
// dock axis. Distinct from useResizable (the container-bounded, localStorage-
// backed side-panel handle) because this resizes along whichever axis the panel
// is docked on and grows *away* from the docked edge — so it's its own rune
// rather than a forced merge. Lifted out of Panel.svelte to keep it markup.

import type { DockPosition } from '../types';
import { startPointerDrag } from '../utils/pointerDrag';

export type Dock = Exclude<DockPosition, null>;
export type Axis = 'vertical' | 'horizontal';

const KEY_STEP = 16;
const KEY_STEP_SHIFT = 48;

export interface UsePanelResizeOptions {
  /** True for top/bottom docks (resize height); false for left/right (width). */
  isVertical: () => boolean;
  dock: () => Dock;
  /** Current size along the dock axis, in px. */
  axisSize: () => number;
  /** Commit a new axis size (the store clamps + persists it). */
  setSize: (axis: Axis, size: number) => void;
  /** Reset the axis to its default size (double-click the handle). */
  resetSize: (axis: Axis) => void;
}

export interface PanelResizeState {
  readonly resizing: boolean;
  onPointerDown: (event: PointerEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onDblClick: () => void;
}

export function usePanelResize(
  options: UsePanelResizeOptions,
): PanelResizeState {
  const { isVertical, dock, axisSize, setSize, resetSize } = options;

  let resizing = $state(false);

  const onPointerDown = (event: PointerEvent) => {
    event.stopPropagation(); // don't also start a header drag-to-dock
    // The dock (and therefore the axis) can't change mid-drag, so capture once.
    const vertical = isVertical();
    const axis: Axis = vertical ? 'vertical' : 'horizontal';
    const start = vertical ? event.clientY : event.clientX;
    const startSize = axisSize();
    // Growing the panel means dragging *away* from the docked edge: up for a
    // bottom dock, left for a right dock, etc. Encode that as a sign flip.
    const grow = dock() === 'bottom' || dock() === 'right' ? -1 : 1;

    startPointerDrag(event, {
      cursor: vertical ? 'ns-resize' : 'ew-resize',
      onStart: () => (resizing = true),
      onMove: (move) => {
        const pos = vertical ? move.clientY : move.clientX;
        setSize(axis, startSize + (pos - start) * grow);
      },
      onEnd: () => (resizing = false),
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const axis: Axis = isVertical() ? 'vertical' : 'horizontal';
    const step = event.shiftKey ? KEY_STEP_SHIFT : KEY_STEP;
    // Arrow toward the open space grows the panel.
    const map: Record<string, number> = isVertical()
      ? {
          ArrowUp: dock() === 'bottom' ? step : -step,
          ArrowDown: dock() === 'bottom' ? -step : step,
        }
      : {
          ArrowLeft: dock() === 'right' ? step : -step,
          ArrowRight: dock() === 'right' ? -step : step,
        };
    if (event.key in map) {
      event.preventDefault();
      setSize(axis, axisSize() + map[event.key]);
    }
  };

  const onDblClick = () =>
    resetSize(isVertical() ? 'vertical' : 'horizontal');

  return {
    get resizing() {
      return resizing;
    },
    onPointerDown,
    onKeyDown,
    onDblClick,
  };
}
