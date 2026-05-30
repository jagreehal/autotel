/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import {
  cleanup,
  render,
  fireEvent,
  screen,
  waitFor,
} from '@testing-library/svelte'
import ResizablePanel from '../components/ResizablePanel.svelte'
import { useResizable } from '../components/resizable.svelte'

const STORAGE_KEY = 'autotel-devtools:test-width'

// Minimal harness mirroring how TracesView wires the hook to the handle.
//
// The Preact original used a JSX <Harness> component that rendered the
// <ResizeHandle> alongside a panel div. The Svelte ResizablePanel.svelte is the
// presentational handle only (formerly ResizeHandle), so we drive it with the
// `useResizable` runes state and spread `separatorProps` (+ `dragging`) onto it,
// re-rendering after each interaction so the handle re-reads the reactive
// getters. Panel width is read from the reactive `state.size`.
function mountHarness() {
  const containerRef = { current: document.createElement('div') }
  // jsdom doesn't lay out, so clientWidth is 0 (=> maxFor() is +Infinity);
  // this matches the Preact harness where the container was never sized.
  const state = useResizable({
    initial: 320,
    min: 260,
    minOther: 360,
    containerRef,
    storageKey: STORAGE_KEY,
    invert: true,
    step: 24,
  })

  const view = render(ResizablePanel, {
    props: { dragging: state.dragging, ...state.separatorProps },
  })

  const sync = () =>
    view.rerender({ dragging: state.dragging, ...state.separatorProps })

  return { state, sync }
}

describe('useResizable / ResizablePanel', () => {
  beforeEach(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  })
  afterEach(cleanup)

  it('renders a separator exposing the current size for accessibility', () => {
    const { state } = mountHarness()
    const separator = screen.getByRole('separator')
    expect(separator.getAttribute('aria-orientation')).toBe('vertical')
    expect(separator.getAttribute('aria-valuenow')).toBe('320')
    expect(separator.getAttribute('aria-valuemin')).toBe('260')
    expect(state.size).toBe(320)
  })

  it('grows the panel on ArrowLeft and shrinks on ArrowRight (right-docked / inverted)', () => {
    const { state } = mountHarness()
    const separator = screen.getByRole('separator')

    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(state.size).toBe(344) // 320 + step

    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(state.size).toBe(296) // 344 - 24 - 24
  })

  it('clamps to the minimum size', () => {
    const { state } = mountHarness()
    const separator = screen.getByRole('separator')
    // Shrink hard past the floor; should stop at min (260).
    for (let i = 0; i < 10; i++)
      fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(state.size).toBe(260)
  })

  it('resets to the initial size on double-click', () => {
    const { state } = mountHarness()
    const separator = screen.getByRole('separator')
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(state.size).toBe(344)
    fireEvent.dblClick(separator)
    expect(state.size).toBe(320)
  })

  it('persists the chosen size to localStorage', () => {
    mountHarness()
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft' })
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('344')
  })

  it('restores a persisted size on mount', async () => {
    window.localStorage.setItem(STORAGE_KEY, '500')
    const { state, sync } = mountHarness()
    expect(state.size).toBe(500)
    sync()
    await waitFor(() =>
      expect(
        screen.getByRole('separator').getAttribute('aria-valuenow'),
      ).toBe('500'),
    )
  })
})
