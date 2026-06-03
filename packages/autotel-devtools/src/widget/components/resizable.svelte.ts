// src/widget/components/resizable.svelte.ts
//
// Resize behavior for the docked side panel, ported from the Preact
// `useResizable` hook. `useResizable(options)` returns runes-backed reactive
// state ({ size, dragging, separatorProps }) — the direct analogue of the old
// hook's return value — for spreading onto the `<ResizeHandle>` component.
//
// The `resizable` Svelte action is also exported for cases where the separator
// props are attached imperatively onto a handle node via `use:resizable`.
//
// Width is clamped to the container, persisted to localStorage, and adjustable
// via arrow keys. Double-clicking resets to the initial size. Pointer / resize
// behavior is byte-for-byte identical to the original hook.

import { startPointerDrag } from '../utils/pointerDrag'

export interface UseResizableOptions {
  /** Default size in px, used until the user drags (or restored from storage). */
  initial: number
  /** Minimum size of the resized panel, in px. */
  min: number
  /** Minimum space to leave for the other pane, in px (caps how far the panel grows). */
  minOther: number
  /** Container whose width bounds the panel. */
  containerRef: { current: HTMLElement | null }
  /** Persist the chosen size under this localStorage key. */
  storageKey?: string
  /** True when the handle sits on the panel's leading edge (right-docked panel): dragging left grows it. */
  invert?: boolean
  /** Keyboard step in px. */
  step?: number
}

function readStored(key: string | undefined, fallback: number): number {
  if (!key) return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (raw != null) {
      const n = Number(raw)
      if (Number.isFinite(n)) return n
    }
  } catch {
    /* localStorage unavailable (private mode / SSR) — fall back */
  }
  return fallback
}

function persist(key: string | undefined, value: number): void {
  if (!key) return
  try {
    window.localStorage.setItem(key, String(Math.round(value)))
  } catch {
    /* ignore */
  }
}

export interface SeparatorProps {
  role: 'separator'
  'aria-orientation': 'vertical'
  'aria-valuenow': number
  'aria-valuemin': number
  tabIndex: number
  onPointerDown: (event: PointerEvent) => void
  onKeyDown: (event: KeyboardEvent) => void
  onDblClick: () => void
}

export interface ResizableState {
  readonly size: number
  readonly dragging: boolean
  readonly separatorProps: SeparatorProps
}

export function useResizable(options: UseResizableOptions): ResizableState {
  const {
    initial,
    min,
    minOther,
    containerRef,
    storageKey,
    invert = false,
    step = 24,
  } = options

  const initialSize = Math.max(min, readStored(storageKey, initial))
  let size = $state(initialSize)
  let dragging = $state(false)
  // Mutable, non-reactive mirror of the current size (the old `sizeRef`).
  // Seeded from the plain `initialSize`, not the `$state` `size`, so it reads
  // as a deliberate initial-value capture (not an accidental reactive read).
  const sizeRef = { current: initialSize }

  const maxFor = () => {
    const containerWidth = containerRef.current?.clientWidth
    if (!containerWidth) return Number.POSITIVE_INFINITY
    return Math.max(min, containerWidth - minOther)
  }

  const clamp = (value: number) => Math.min(maxFor(), Math.max(min, value))

  const setSize = (value: number) => {
    size = value
    sizeRef.current = value
  }

  const onPointerDown = (event: PointerEvent) => {
    const startX = event.clientX
    const startSize = sizeRef.current
    startPointerDrag(event, {
      cursor: 'col-resize',
      onStart: () => (dragging = true),
      onMove: (move) => {
        const rawDelta = move.clientX - startX
        const delta = invert ? -rawDelta : rawDelta
        setSize(clamp(startSize + delta))
      },
      onEnd: () => {
        dragging = false
        persist(storageKey, sizeRef.current)
      },
    })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const direction = event.key === 'ArrowLeft' ? -step : step
    const next = clamp(sizeRef.current + (invert ? -direction : direction))
    setSize(next)
    persist(storageKey, next)
  }

  const onDblClick = () => {
    const next = clamp(initial)
    setSize(next)
    persist(storageKey, next)
  }

  return {
    get size() {
      return size
    },
    get dragging() {
      return dragging
    },
    get separatorProps(): SeparatorProps {
      return {
        role: 'separator',
        'aria-orientation': 'vertical',
        'aria-valuenow': Math.round(size),
        'aria-valuemin': min,
        tabIndex: 0,
        onPointerDown,
        onKeyDown,
        onDblClick,
      }
    },
  }
}

/**
 * Svelte action: attaches the separator props produced by `useResizable` onto a
 * handle node. Apply with `use:resizable={state.separatorProps}`.
 */
export function resizable(node: HTMLElement, props: SeparatorProps) {
  let current = props

  const handlePointerDown = (event: PointerEvent) => current.onPointerDown(event)
  const handleKeyDown = (event: KeyboardEvent) => current.onKeyDown(event)
  const handleDblClick = () => current.onDblClick()

  function applyAttrs(p: SeparatorProps) {
    node.setAttribute('role', p.role)
    node.setAttribute('aria-orientation', p['aria-orientation'])
    node.setAttribute('aria-valuenow', String(p['aria-valuenow']))
    node.setAttribute('aria-valuemin', String(p['aria-valuemin']))
    node.tabIndex = p.tabIndex
  }

  applyAttrs(current)
  node.addEventListener('pointerdown', handlePointerDown)
  node.addEventListener('keydown', handleKeyDown)
  node.addEventListener('dblclick', handleDblClick)

  return {
    update(next: SeparatorProps) {
      current = next
      applyAttrs(next)
    },
    destroy() {
      node.removeEventListener('pointerdown', handlePointerDown)
      node.removeEventListener('keydown', handleKeyDown)
      node.removeEventListener('dblclick', handleDblClick)
    },
  }
}
