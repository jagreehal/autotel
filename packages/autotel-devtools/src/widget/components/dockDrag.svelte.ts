// src/widget/components/dockDrag.svelte.ts
//
// Drag-to-dock for the Panel header: grab the header and drop near a viewport
// edge to re-dock the panel there. Lifted out of Panel.svelte so the component
// is mostly markup. `useDockDrag` owns the drag state + the body-cursor lock and
// previews the drop target while dragging; `nearestEdge` is the pure geometry.

import type { DockPosition } from '../types';
import { startPointerDrag } from '../utils/pointerDrag';

export type Dock = Exclude<DockPosition, null>;

/** The viewport edge whose inner border the point (x, y) is closest to. */
export function nearestEdge(
  x: number,
  y: number,
  width: number,
  height: number,
): Dock {
  const dist: Record<Dock, number> = {
    left: x,
    right: width - x,
    top: y,
    bottom: height - y,
  };
  return (Object.keys(dist) as Dock[]).reduce((best, edge) =>
    dist[edge] < dist[best] ? edge : best,
  );
}

export interface UseDockDragOptions {
  /** The panel's current dock edge. */
  dock: () => Dock;
  /** Docking is disabled while popped out to picture-in-picture. */
  pipActive: () => boolean;
  /** Commit a re-dock once the drag ends on a different edge. */
  onDock: (dock: Dock) => void;
}

export interface DockDragState {
  readonly dragging: boolean;
  /** Previewed drop edge while dragging (null when idle). */
  readonly dropTarget: Dock | null;
  onHeaderPointerDown: (event: PointerEvent) => void;
}

export function useDockDrag(options: UseDockDragOptions): DockDragState {
  const { dock, pipActive, onDock } = options;

  let dragging = $state(false);
  let dropTarget = $state<Dock | null>(null);

  const onHeaderPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button')) return; // let controls click
    if (pipActive()) return; // no docking while popped out
    startPointerDrag(event, {
      cursor: 'grabbing',
      onStart: () => {
        dragging = true;
        dropTarget = dock();
      },
      onMove: (move) => {
        dropTarget = nearestEdge(
          move.clientX,
          move.clientY,
          window.innerWidth,
          window.innerHeight,
        );
      },
      onEnd: () => {
        dragging = false;
        if (dropTarget && dropTarget !== dock()) onDock(dropTarget);
        dropTarget = null;
      },
    });
  };

  return {
    get dragging() {
      return dragging;
    },
    get dropTarget() {
      return dropTarget;
    },
    onHeaderPointerDown,
  };
}
