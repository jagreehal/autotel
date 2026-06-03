// src/widget/components/zoomPan.svelte.ts
//
// Zoom & pan for an SVG canvas, applied as a single transform on a wrapper <g>.
// Ported out of ServiceMapView (which hand-rolled it) into a reusable rune that
// mirrors useResizable: `useZoomPan(options)` returns runes-backed reactive
// state ({ scale, translate, isPanning }) plus the wheel/pointer handlers and
// zoom-in/out/fit/reset actions to wire onto the SVG and toolbar buttons.
//
// The view dimensions, the SVG element and the content bounding box are passed
// as getters so the rune stays framework-agnostic and reacts to live layout.

export interface Vec {
  x: number;
  y: number;
}

export interface Transform {
  scale: number;
  translate: Vec;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function clampScale(scale: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, scale));
}

/**
 * Transform that zooms to `nextScaleRaw` (clamped) about `anchor` in view
 * coordinates, keeping the anchored world point fixed under the cursor. Returns
 * the current transform unchanged when the clamped scale doesn't move.
 */
export function zoomAbout(
  current: Transform,
  nextScaleRaw: number,
  anchor: Vec,
  min: number,
  max: number,
): Transform {
  const nextScale = clampScale(nextScaleRaw, min, max);
  if (nextScale === current.scale) return current;
  const worldX = (anchor.x - current.translate.x) / current.scale;
  const worldY = (anchor.y - current.translate.y) / current.scale;
  return {
    scale: nextScale,
    translate: {
      x: anchor.x - worldX * nextScale,
      y: anchor.y - worldY * nextScale,
    },
  };
}

/**
 * Transform that fits `bounds` within the view with `padding` on each side,
 * centred. Mirrors ServiceMapView's original fit math exactly.
 */
export function fitToBounds(
  bounds: Bounds,
  viewWidth: number,
  viewHeight: number,
  padding: number,
  min: number,
  max: number,
): Transform {
  const contentW = bounds.maxX - bounds.minX;
  const contentH = bounds.maxY - bounds.minY;
  const availW = viewWidth - padding * 2;
  const availH = viewHeight - padding * 2;
  const fitScale = clampScale(
    Math.min(
      contentW > 0 ? availW / contentW : max,
      contentH > 0 ? availH / contentH : max,
    ),
    min,
    max,
  );
  return {
    scale: fitScale,
    translate: {
      x: (viewWidth - contentW * fitScale) / 2 - bounds.minX * fitScale,
      y: (viewHeight - contentH * fitScale) / 2 - bounds.minY * fitScale,
    },
  };
}

export interface UseZoomPanOptions {
  /** Current viewBox width / height (reactive getters). */
  viewWidth: () => number;
  viewHeight: () => number;
  /** The SVG element the gestures act on (reactive getter). */
  svg: () => SVGSVGElement | null;
  /** Bounding box of the content for fit-to-view; null when there's nothing. */
  contentBounds: () => Bounds | null;
  /** Min / max zoom (default 0.2 / 3). */
  minScale?: number;
  maxScale?: number;
  /** Per-step zoom factor for buttons and the wheel (default 1.2). */
  zoomStep?: number;
  /** Padding around the content on fit, in view units (default 24). */
  fitPadding?: number;
}

export interface ZoomPanState {
  readonly scale: number;
  readonly translate: Vec;
  readonly isPanning: boolean;
  onWheel: (event: WheelEvent) => void;
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerEnd: (event: PointerEvent) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  reset: () => void;
}

export function useZoomPan(options: UseZoomPanOptions): ZoomPanState {
  const {
    viewWidth,
    viewHeight,
    svg,
    contentBounds,
    minScale = 0.2,
    maxScale = 3,
    zoomStep = 1.2,
    fitPadding = 24,
  } = options;

  let scale = $state(1);
  let translate = $state<Vec>({ x: 0, y: 0 });
  let isPanning = $state(false);
  // Non-reactive drag origin (client point + transform at pointerdown).
  let panStart = { x: 0, y: 0, tx: 0, ty: 0 };

  /** Map a client (pixel) point into the SVG's viewBox coordinate space. */
  const clientToView = (clientX: number, clientY: number): Vec => {
    const el = svg();
    if (!el) return { x: clientX, y: clientY };
    const rect = el.getBoundingClientRect();
    const sx = rect.width > 0 ? viewWidth() / rect.width : 1;
    const sy = rect.height > 0 ? viewHeight() / rect.height : 1;
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  };

  const apply = (t: Transform) => {
    scale = t.scale;
    translate = t.translate;
  };

  const zoomAt = (nextScaleRaw: number, anchor: Vec) =>
    apply(zoomAbout({ scale, translate }, nextScaleRaw, anchor, minScale, maxScale));

  const reset = () => {
    scale = 1;
    translate = { x: 0, y: 0 };
  };

  const onWheel = (event: WheelEvent) => {
    // Only intercept zoom gestures; let plain scroll fall through to the
    // overflow-auto container so the canvas still scrolls normally.
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const anchor = clientToView(event.clientX, event.clientY);
    const factor = event.deltaY < 0 ? zoomStep : 1 / zoomStep;
    zoomAt(scale * factor, anchor);
  };

  const onPointerDown = (event: PointerEvent) => {
    // Pan only when the gesture starts on empty canvas — a pointerdown on a
    // node (data-node) bails out so node click/keyboard still work.
    if (event.button !== 0) return;
    const target = event.target as Element | null;
    if (target?.closest('[data-node]')) return;
    isPanning = true;
    panStart = {
      x: event.clientX,
      y: event.clientY,
      tx: translate.x,
      ty: translate.y,
    };
    svg()?.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    const el = svg();
    if (!isPanning || !el) return;
    const rect = el.getBoundingClientRect();
    const sx = rect.width > 0 ? viewWidth() / rect.width : 1;
    const sy = rect.height > 0 ? viewHeight() / rect.height : 1;
    translate = {
      x: panStart.tx + (event.clientX - panStart.x) * sx,
      y: panStart.ty + (event.clientY - panStart.y) * sy,
    };
  };

  const onPointerEnd = (event: PointerEvent) => {
    if (!isPanning) return;
    isPanning = false;
    svg()?.releasePointerCapture?.(event.pointerId);
  };

  // Buttons zoom about the viewport centre.
  const center = (): Vec => ({ x: viewWidth() / 2, y: viewHeight() / 2 });

  const fit = () => {
    const bounds = contentBounds();
    if (!bounds) {
      reset();
      return;
    }
    apply(
      fitToBounds(bounds, viewWidth(), viewHeight(), fitPadding, minScale, maxScale),
    );
  };

  return {
    get scale() {
      return scale;
    },
    get translate() {
      return translate;
    },
    get isPanning() {
      return isPanning;
    },
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerEnd,
    zoomIn: () => zoomAt(scale * zoomStep, center()),
    zoomOut: () => zoomAt(scale / zoomStep, center()),
    fit,
    reset,
  };
}
