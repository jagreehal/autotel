// src/widget/components/ResizablePanel.tsx
//
// A lightweight draggable splitter for resizing a docked side panel. Returns the
// current size plus props to spread onto a <ResizeHandle>. Width is clamped to the
// container, persisted to localStorage, and adjustable via keyboard (arrow keys) for
// accessibility. Double-clicking the handle resets to the initial size.
import { h } from 'preact'
import { useCallback, useRef, useState } from 'preact/hooks'
import { cn } from '../utils/cn'

interface UseResizableOptions {
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

export function useResizable(options: UseResizableOptions): {
  size: number
  dragging: boolean
  separatorProps: SeparatorProps
} {
  const { initial, min, minOther, containerRef, storageKey, invert = false, step = 24 } = options
  const [size, setSize] = useState(() => Math.max(min, readStored(storageKey, initial)))
  const [dragging, setDragging] = useState(false)
  const sizeRef = useRef(size)
  sizeRef.current = size

  const maxFor = useCallback(() => {
    const containerWidth = containerRef.current?.clientWidth
    if (!containerWidth) return Number.POSITIVE_INFINITY
    return Math.max(min, containerWidth - minOther)
  }, [containerRef, min, minOther])

  const clamp = useCallback(
    (value: number) => Math.min(maxFor(), Math.max(min, value)),
    [maxFor, min],
  )

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      event.preventDefault()
      const startX = event.clientX
      const startSize = sizeRef.current
      setDragging(true)
      // Keep a stable cursor / no text selection while dragging anywhere on the page.
      const prevCursor = document.body.style.cursor
      const prevSelect = document.body.style.userSelect
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const onMove = (moveEvent: PointerEvent) => {
        const rawDelta = moveEvent.clientX - startX
        const delta = invert ? -rawDelta : rawDelta
        setSize(clamp(startSize + delta))
      }
      const onUp = () => {
        setDragging(false)
        document.body.style.cursor = prevCursor
        document.body.style.userSelect = prevSelect
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        persist(storageKey, sizeRef.current)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [clamp, invert, storageKey],
  )

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const direction = event.key === 'ArrowLeft' ? -step : step
      const next = clamp(sizeRef.current + (invert ? -direction : direction))
      setSize(next)
      persist(storageKey, next)
    },
    [clamp, invert, step, storageKey],
  )

  const onDblClick = useCallback(() => {
    const next = clamp(initial)
    setSize(next)
    persist(storageKey, next)
  }, [clamp, initial, storageKey])

  return {
    size,
    dragging,
    separatorProps: {
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-valuenow': Math.round(size),
      'aria-valuemin': min,
      tabIndex: 0,
      onPointerDown,
      onKeyDown,
      onDblClick,
    },
  }
}

interface ResizeHandleProps extends SeparatorProps {
  dragging: boolean
  title?: string
}

export function ResizeHandle({ dragging, title, ...separatorProps }: ResizeHandleProps) {
  return (
    <div
      {...separatorProps}
      title={title ?? 'Drag to resize · double-click to reset'}
      className={cn(
        'group relative z-10 shrink-0 cursor-col-resize self-stretch outline-none',
        'w-px bg-zinc-200',
      )}
    >
      {/* Wide invisible hit area so the 1px line is easy to grab. */}
      <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
      {/* Visible grip on hover / drag / keyboard focus. */}
      <div
        className={cn(
          'absolute inset-y-0 -left-px w-0.5 transition-colors',
          'group-hover:bg-blue-400 group-focus-visible:bg-blue-400',
          dragging && 'bg-blue-500',
        )}
      />
    </div>
  )
}
