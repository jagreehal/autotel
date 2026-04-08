/**
 * Utility functions for formatting and display
 */

/**
 * Format duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)}μs`
  if (ms < 1000) return `${ms.toFixed(2)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`
  return `${(ms / 60_000).toFixed(2)}m`
}

/**
 * Format timestamp to human-readable string
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  // Within last minute
  if (diff < 60_000) {
    const seconds = Math.floor(diff / 1000)
    return seconds <= 1 ? 'just now' : `${seconds}s ago`
  }

  // Within last hour
  if (diff < 3_600_000) {
    const minutes = Math.floor(diff / 60_000)
    return `${minutes}m ago`
  }

  // Within last day
  if (diff < 86_400_000) {
    const hours = Math.floor(diff / 3_600_000)
    return `${hours}h ago`
  }

  // Format as time
  return date.toLocaleTimeString()
}

/**
 * Format number with commas
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat().format(num)
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + '...'
}

/**
 * Get status color class
 */
export function getStatusColor(status: 'OK' | 'ERROR' | 'UNSET'): string {
  switch (status) {
    case 'OK': {
      return 'text-green-600'
    }
    case 'ERROR': {
      return 'text-red-600'
    }
    default: {
      return 'text-gray-500'
    }
  }
}

/**
 * Get circuit breaker state color
 */
export function getCircuitBreakerColor(
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'
): string {
  switch (state) {
    case 'CLOSED': {
      return 'text-green-600'
    }
    case 'OPEN': {
      return 'text-red-600'
    }
    case 'HALF_OPEN': {
      return 'text-yellow-600'
    }
  }
}

/**
 * Calculate snap position to nearest corner
 */
export function snapToCorner(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number
): { corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; x: number; y: number } {
  const centerX = viewportWidth / 2
  const centerY = viewportHeight / 2

  if (x < centerX && y < centerY) {
    return { corner: 'top-left', x: 20, y: 20 }
  } else if (x >= centerX && y < centerY) {
    return { corner: 'top-right', x: viewportWidth - 100, y: 20 }
  } else if (x < centerX && y >= centerY) {
    return { corner: 'bottom-left', x: 20, y: viewportHeight - 100 }
  } else {
    return { corner: 'bottom-right', x: viewportWidth - 100, y: viewportHeight - 100 }
  }
}

/**
 * Clamp value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Check if click is outside element
 */
export function isOutsideClick(
  event: MouseEvent,
  element: HTMLElement | null
): boolean {
  if (!element) return true
  return !element.contains(event.target as Node)
}
