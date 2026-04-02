/**
 * Floating draggable bubble button
 */

import { h } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { Logo } from './Logo'
import {
  widgetExpandedSignal,
  widgetPositionSignal,
  widgetCornerSignal,
  widgetDockedSignal,
  unseenFailuresSignal,
  toggleWidget,
  setWidgetPosition,
  setWidgetCorner,
  setWidgetDocked,
} from '../store'
import { snapToCorner, clamp } from '../utils'
import { cn } from '../utils/cn'

export function Bubble() {
  const bubbleRef = useRef<HTMLButtonElement>(null)
  const isDragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })

  const position = widgetPositionSignal.value
  const unseenFailures = unseenFailuresSignal.value
  const expanded = widgetExpandedSignal.value

  // Don't show bubble when expanded
  if (expanded) {
    return null
  }

  const handlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return // Only left click

    isDragging.current = true
    dragStart.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    }

    bubbleRef.current?.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  const handlePointerMove = (e: PointerEvent) => {
    if (!isDragging.current) return

    const newX = clamp(
      e.clientX - dragStart.current.x,
      0,
      window.innerWidth - 48
    )
    const newY = clamp(
      e.clientY - dragStart.current.y,
      0,
      window.innerHeight - 48
    )

    setWidgetPosition(newX, newY)
  }

  const handlePointerUp = (e: PointerEvent) => {
    if (!isDragging.current) return

    isDragging.current = false
    bubbleRef.current?.releasePointerCapture(e.pointerId)

    // Snap to nearest corner
    const snapped = snapToCorner(
      position.x,
      position.y,
      window.innerWidth,
      window.innerHeight
    )

    setWidgetPosition(snapped.x, snapped.y)
    setWidgetCorner(snapped.corner)
  }

  const handleClick = () => {
    if (!isDragging.current) {
      toggleWidget()
    }
  }

  useEffect(() => {
    const bubble = bubbleRef.current
    if (!bubble) return

    bubble.addEventListener('pointerdown', handlePointerDown as any)
    bubble.addEventListener('pointermove', handlePointerMove as any)
    bubble.addEventListener('pointerup', handlePointerUp as any)

    return () => {
      bubble.removeEventListener('pointerdown', handlePointerDown as any)
      bubble.removeEventListener('pointermove', handlePointerMove as any)
      bubble.removeEventListener('pointerup', handlePointerUp as any)
    }
  }, [position])

  const hasErrors = unseenFailures > 0
  const ringColor = hasErrors ? '#DA2F47' : '#22c55e' // red for errors, green for success

  return (
    <button
      ref={bubbleRef}
      onClick={handleClick}
      className={cn(
        "fixed z-[1000] rounded-full border-2 shadow-md",
        "flex items-center justify-center cursor-pointer touch-none",
        "transition-all duration-150 select-none",
        "hover:shadow-lg",
        "bg-white hover:bg-gray-50"
      )}
      style={{
        width: '48px',
        height: '48px',
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: `translate3d(0, 0, 0)`,
        borderColor: ringColor,
      }}
      title="Autolemetry Observability"
    >
      <Logo fill={hasErrors ? '#fff' : undefined} width={28} height={28} />
    </button>
  )
}
