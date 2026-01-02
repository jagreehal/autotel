/**
 * Autotel Traces Devtools
 *
 * A floating devtools panel for viewing OpenTelemetry traces.
 * Matches the TanStack Router devtools styling.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

// ============================================================================
// Types
// ============================================================================

export interface TraceSpan {
  id: string
  traceId: string
  parentId?: string
  name: string
  startTime: number
  endTime?: number
  duration?: number
  status: 'ok' | 'error' | 'pending'
  attributes: Record<string, unknown>
  children?: Array<TraceSpan>
}

// ============================================================================
// Span Store (in-memory collection)
// ============================================================================

type SpanListener = (spans: Array<TraceSpan>) => void

class SpanStore {
  private spans: Array<TraceSpan> = []
  private listeners: Set<SpanListener> = new Set()
  private maxSpans = 100

  add(span: TraceSpan) {
    this.spans = [span, ...this.spans].slice(0, this.maxSpans)
    this.notify()
  }

  getAll(): Array<TraceSpan> {
    return this.spans
  }

  clear() {
    this.spans = []
    this.notify()
  }

  subscribe(listener: SpanListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify() {
    this.listeners.forEach((l) => l(this.spans))
  }
}

export const spanStore = new SpanStore()

// Hook to use spans
export function useSpans(): Array<TraceSpan> {
  const [spans, setSpans] = useState<Array<TraceSpan>>([])

  useEffect(() => {
    setSpans(spanStore.getAll())
    return spanStore.subscribe(setSpans)
  }, [])

  return spans
}

// Helper to record a span (call from playground actions)
export function recordSpan(
  name: string,
  attributes: Record<string, unknown> = {},
  status: 'ok' | 'error' = 'ok',
  duration?: number,
) {
  const now = Date.now()
  spanStore.add({
    id: `span-${now}-${Math.random().toString(36).slice(2, 8)}`,
    traceId: `trace-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    startTime: now - (duration ?? 0),
    endTime: now,
    duration,
    status,
    attributes,
  })
}

// ============================================================================
// Styles (matching TanStack devtools tokens)
// ============================================================================

const colors = {
  darkGray: {
    400: '#313749',
    500: '#292e3d',
    600: '#212530',
    700: '#191c24',
    800: '#111318',
  },
  gray: {
    300: '#d0d5dd',
    400: '#98a2b3',
    500: '#667085',
    600: '#475467',
    700: '#344054',
  },
  green: {
    300: '#6CE9A6',
    500: '#12B76A',
    900: '#054F31',
  },
  red: {
    300: '#fca5a5',
    500: '#ef4444',
    900: '#7f1d1d',
  },
  yellow: {
    300: '#FEC84B',
    500: '#F79009',
    900: '#7A2E0E',
  },
  purple: {
    400: '#9B8AFB',
  },
  cyan: {
    400: '#22d3ee',
  },
}

const styles = {
  // Floating button
  floatingButton: {
    position: 'fixed' as const,
    bottom: '12px',
    left: '12px',
    zIndex: 99999,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px 6px 8px',
    background: colors.darkGray[700],
    border: `1px solid ${colors.gray[500]}`,
    borderRadius: '6px',
    cursor: 'pointer',
    fontFamily: 'ui-sans-serif, Inter, system-ui, sans-serif',
    fontSize: '12px',
    color: colors.gray[300],
    transition: 'all 0.2s ease',
  },
  floatingButtonHover: {
    background: colors.darkGray[500],
  },
  logoGradient: {
    background: 'linear-gradient(to right, #06b6d4, #8b5cf6)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    fontWeight: 600,
  },
  // Panel
  panel: {
    position: 'fixed' as const,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 99999,
    background: colors.darkGray[700],
    borderTop: `1px solid ${colors.gray[700]}`,
    fontFamily: 'ui-sans-serif, Inter, system-ui, sans-serif',
    fontSize: '12px',
    color: colors.gray[300],
    transition: 'transform 0.3s ease',
  },
  panelHidden: {
    transform: 'translateY(100%)',
    pointerEvents: 'none' as const,
  },
  panelVisible: {
    transform: 'translateY(0)',
    pointerEvents: 'auto' as const,
  },
  dragHandle: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    height: '4px',
    cursor: 'row-resize',
    background: 'transparent',
  },
  dragHandleHover: {
    background: `${colors.purple[400]}e5`,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    background: colors.darkGray[600],
    borderBottom: `1px solid ${colors.darkGray[400]}`,
  },
  headerTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontWeight: 500,
  },
  headerActions: {
    display: 'flex',
    gap: '8px',
  },
  iconButton: {
    background: 'transparent',
    border: 'none',
    color: colors.gray[400],
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    overflowY: 'auto' as const,
    maxHeight: 'calc(100% - 40px)',
  },
  spanRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    borderBottom: `1px solid ${colors.darkGray[400]}`,
    cursor: 'pointer',
    transition: 'background 0.1s ease',
  },
  spanRowHover: {
    background: colors.darkGray[500],
  },
  statusDot: (status: 'ok' | 'error' | 'pending') => {
    const colorMap = {
      ok: colors.green,
      error: colors.red,
      pending: colors.yellow,
    }
    const c = colorMap[status]
    return {
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: c[900],
      border: `1px solid ${c[500]}`,
      flexShrink: 0,
    }
  },
  spanName: {
    flex: 1,
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '11px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  spanDuration: {
    color: colors.gray[400],
    fontVariantNumeric: 'tabular-nums',
    fontSize: '11px',
  },
  spanTime: {
    color: colors.gray[500],
    fontSize: '10px',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 20px',
    color: colors.gray[500],
    textAlign: 'center' as const,
  },
  badge: {
    background: colors.darkGray[400],
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '10px',
    color: colors.gray[400],
  },
  // Detail panel
  detailPanel: {
    borderTop: `1px solid ${colors.darkGray[400]}`,
    padding: '12px',
    background: colors.darkGray[600],
    maxHeight: '200px',
    overflowY: 'auto' as const,
  },
  detailTitle: {
    fontWeight: 600,
    marginBottom: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  attributeRow: {
    display: 'flex',
    gap: '8px',
    padding: '2px 0',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '11px',
  },
  attributeKey: {
    color: colors.cyan[400],
  },
  attributeValue: {
    color: colors.purple[400],
  },
}

// ============================================================================
// Icons (inline SVGs matching TanStack style)
// ============================================================================

function TracesIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M3 12h4l3-9 4 18 3-9h4" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  )
}

// ============================================================================
// Components
// ============================================================================

function SpanRow({
  span,
  isSelected,
  onClick,
}: {
  span: TraceSpan
  isSelected: boolean
  onClick: () => void
}) {
  const [isHovered, setIsHovered] = useState(false)

  const formatDuration = (ms?: number) => {
    if (ms === undefined) return '...'
    if (ms < 1) return '<1ms'
    if (ms < 1000) return `${Math.round(ms)}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const formatTime = (ts: number) => {
    const date = new Date(ts)
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  return (
    <div
      style={{
        ...styles.spanRow,
        ...(isHovered || isSelected ? styles.spanRowHover : {}),
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
    >
      <div style={styles.statusDot(span.status)} />
      <div style={styles.spanName}>{span.name}</div>
      <div style={styles.spanDuration}>{formatDuration(span.duration)}</div>
      <div style={styles.spanTime}>{formatTime(span.startTime)}</div>
    </div>
  )
}

function SpanDetail({ span }: { span: TraceSpan }) {
  const entries = Object.entries(span.attributes)

  return (
    <div style={styles.detailPanel}>
      <div style={styles.detailTitle}>
        <div style={styles.statusDot(span.status)} />
        {span.name}
        <span style={styles.badge}>{span.status}</span>
      </div>
      {entries.length > 0 ? (
        entries.map(([key, value]) => (
          <div key={key} style={styles.attributeRow}>
            <span style={styles.attributeKey}>{key}:</span>
            <span style={styles.attributeValue}>
              {typeof value === 'object'
                ? JSON.stringify(value)
                : String(value)}
            </span>
          </div>
        ))
      ) : (
        <div style={{ color: colors.gray[500] }}>No attributes</div>
      )}
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export interface TracesDevtoolsProps {
  /**
   * Initial open state
   */
  initialIsOpen?: boolean
  /**
   * Position of the floating button
   */
  position?: 'bottom-left' | 'bottom-right'
}

export function TracesDevtools({
  initialIsOpen = false,
  position = 'bottom-left',
}: TracesDevtoolsProps) {
  const [isOpen, setIsOpen] = useState(initialIsOpen)
  const [panelHeight, setPanelHeight] = useState(300)
  const [selectedSpan, setSelectedSpan] = useState<TraceSpan | null>(null)
  const [isButtonHovered, setIsButtonHovered] = useState(false)
  const [isDragHandleHovered, setIsDragHandleHovered] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const spans = useSpans()

  // Drag to resize
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      setIsResizing(true)
      const startY = e.pageY
      const startHeight = panelHeight

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = startY - moveEvent.pageY
        const newHeight = Math.max(100, Math.min(600, startHeight + delta))
        setPanelHeight(newHeight)
      }

      const onMouseUp = () => {
        setIsResizing(false)
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [panelHeight],
  )

  const positionStyles =
    position === 'bottom-left' ? { left: '12px' } : { right: '12px' }

  return (
    <>
      {/* Floating Button */}
      <button
        style={{
          ...styles.floatingButton,
          ...positionStyles,
          ...(isButtonHovered ? styles.floatingButtonHover : {}),
          opacity: isOpen ? 0 : 1,
          visibility: isOpen ? 'hidden' : 'visible',
        }}
        onMouseEnter={() => setIsButtonHovered(true)}
        onMouseLeave={() => setIsButtonHovered(false)}
        onClick={() => setIsOpen(true)}
      >
        <TracesIcon />
        <span style={{ color: colors.gray[600] }}>|</span>
        <span style={styles.logoGradient}>Autotel Traces</span>
        {spans.length > 0 && <span style={styles.badge}>{spans.length}</span>}
      </button>

      {/* Panel */}
      <div
        ref={panelRef}
        style={{
          ...styles.panel,
          height: `${panelHeight}px`,
          ...(isOpen ? styles.panelVisible : styles.panelHidden),
          transition: isResizing ? 'none' : styles.panel.transition,
        }}
      >
        {/* Drag Handle */}
        <div
          style={{
            ...styles.dragHandle,
            ...(isDragHandleHovered ? styles.dragHandleHover : {}),
          }}
          onMouseEnter={() => setIsDragHandleHovered(true)}
          onMouseLeave={() => setIsDragHandleHovered(false)}
          onMouseDown={handleDragStart}
        />

        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerTitle}>
            <TracesIcon />
            <span style={styles.logoGradient}>Autotel Traces</span>
            <span style={styles.badge}>{spans.length} spans</span>
          </div>
          <div style={styles.headerActions}>
            <button
              style={styles.iconButton}
              onClick={() => {
                spanStore.clear()
                setSelectedSpan(null)
              }}
              title="Clear traces"
            >
              <TrashIcon />
            </button>
            <button
              style={styles.iconButton}
              onClick={() => setIsOpen(false)}
              title="Close"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ ...styles.content, height: `calc(100% - 40px)` }}>
          {spans.length === 0 ? (
            <div style={styles.emptyState}>
              <TracesIcon />
              <p style={{ marginTop: '12px' }}>No traces yet</p>
              <p style={{ fontSize: '11px', marginTop: '4px' }}>
                Click buttons in the playground to generate traces
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', height: '100%' }}>
              {/* Span list */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {spans.map((span) => (
                  <SpanRow
                    key={span.id}
                    span={span}
                    isSelected={selectedSpan?.id === span.id}
                    onClick={() =>
                      setSelectedSpan(
                        selectedSpan?.id === span.id ? null : span,
                      )
                    }
                  />
                ))}
              </div>
              {/* Detail panel */}
              {selectedSpan && (
                <div
                  style={{
                    width: '350px',
                    borderLeft: `1px solid ${colors.darkGray[400]}`,
                  }}
                >
                  <SpanDetail span={selectedSpan} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default TracesDevtools
