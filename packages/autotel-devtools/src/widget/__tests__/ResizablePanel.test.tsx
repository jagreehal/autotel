import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { h } from 'preact'
import { useRef } from 'preact/hooks'
import { cleanup, render, fireEvent, screen } from '@testing-library/preact'
import { ResizeHandle, useResizable } from '../components/ResizablePanel'

const STORAGE_KEY = 'autotel-devtools:test-width'

// Minimal harness mirroring how TracesView wires the hook to the handle.
function Harness() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { size, dragging, separatorProps } = useResizable({
    initial: 320,
    min: 260,
    minOther: 360,
    containerRef,
    storageKey: STORAGE_KEY,
    invert: true,
    step: 24,
  })
  return (
    <div ref={containerRef}>
      <ResizeHandle dragging={dragging} {...separatorProps} />
      <div data-testid="panel" style={{ width: `${size}px` }} />
    </div>
  )
}

function panelWidth(): number {
  return parseInt((screen.getByTestId('panel') as HTMLElement).style.width, 10)
}

describe('useResizable / ResizeHandle', () => {
  beforeEach(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  })
  afterEach(cleanup)

  it('renders a separator exposing the current size for accessibility', () => {
    render(<Harness />)
    const separator = screen.getByRole('separator')
    expect(separator.getAttribute('aria-orientation')).toBe('vertical')
    expect(separator.getAttribute('aria-valuenow')).toBe('320')
    expect(separator.getAttribute('aria-valuemin')).toBe('260')
    expect(panelWidth()).toBe(320)
  })

  it('grows the panel on ArrowLeft and shrinks on ArrowRight (right-docked / inverted)', () => {
    render(<Harness />)
    const separator = screen.getByRole('separator')

    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(panelWidth()).toBe(344) // 320 + step

    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(panelWidth()).toBe(296) // 344 - 24 - 24
  })

  it('clamps to the minimum size', () => {
    render(<Harness />)
    const separator = screen.getByRole('separator')
    // Shrink hard past the floor; should stop at min (260).
    for (let i = 0; i < 10; i++) fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(panelWidth()).toBe(260)
  })

  it('resets to the initial size on double-click', () => {
    render(<Harness />)
    const separator = screen.getByRole('separator')
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(panelWidth()).toBe(344)
    fireEvent.dblClick(separator)
    expect(panelWidth()).toBe(320)
  })

  it('persists the chosen size to localStorage', () => {
    render(<Harness />)
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft' })
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('344')
  })

  it('restores a persisted size on mount', () => {
    window.localStorage.setItem(STORAGE_KEY, '500')
    render(<Harness />)
    expect(panelWidth()).toBe(500)
    expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('500')
  })
})
