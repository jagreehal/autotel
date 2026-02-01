/**
 * Format utilities - duration, relative time, truncation.
 * Pure functions for testability.
 */

/**
 * Format duration: ms or seconds with 2 decimals.
 */
export function formatDurationMs(n: number): string {
  if (n < 1000) return `${n.toFixed(0)}ms`;
  return `${(n / 1000).toFixed(2)}s`;
}

/**
 * Format relative time: "just now" | "Ns ago" | "Nm ago" | "Nh ago".
 */
export function formatRelative(epochMs: number): string {
  const now = Date.now();
  const diffMs = now - epochMs;
  if (diffMs < 0) return 'just now';
  if (diffMs < 1000) return 'just now';
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s ago`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  return `${Math.floor(diffMs / 3_600_000)}h ago`;
}

/**
 * Truncate string with ellipsis.
 */
export function truncate(s: string, width: number): string {
  if (s.length <= width) return s;
  return s.slice(0, Math.max(0, width - 1)) + '…';
}
