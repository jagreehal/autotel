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

/**
 * Build a fixed-width waterfall bar string.
 * The bar is positioned proportionally within the total width
 * based on the span's start offset and duration relative to the trace.
 */
export function buildWaterfallBar(
  spanStart: number,
  spanDuration: number,
  traceStart: number,
  traceDuration: number,
  width: number,
): string {
  if (width <= 0) return '';
  if (traceDuration <= 0) return ' '.repeat(width);
  const offsetRatio = (spanStart - traceStart) / traceDuration;
  const widthRatio = spanDuration / traceDuration;
  const barStart = Math.max(0, Math.floor(offsetRatio * width));
  const barLen = Math.max(1, Math.round(widthRatio * width));
  const clampedStart = Math.min(barStart, width - 1);
  const clampedLen = Math.min(barLen, width - clampedStart);
  const trailing = Math.max(0, width - clampedStart - clampedLen);
  return (
    ' '.repeat(clampedStart) + '█'.repeat(clampedLen) + ' '.repeat(trailing)
  );
}

/**
 * Build a fixed-width time ruler string.
 * Format: "0ms          500ms          1000ms"
 */
export function buildTimeRuler(totalMs: number, width: number): string {
  if (width <= 0) return '';
  if (width < 10) return ' '.repeat(width);
  const left = '0ms';
  const right = formatDurationMs(totalMs);
  const mid = formatDurationMs(totalMs / 2);
  const midPos = Math.floor(width / 2) - Math.floor(mid.length / 2);
  const rightPos = width - right.length;

  const chars = Array.from<string>({ length: width }).fill(' ');
  // place left
  for (let i = 0; i < left.length && i < width; i++) chars[i] = left[i];
  // place mid (if room)
  if (midPos > left.length + 1 && midPos + mid.length < rightPos - 1) {
    for (let i = 0; i < mid.length; i++) chars[midPos + i] = mid[i];
  }
  // place right
  for (let i = 0; i < right.length; i++) chars[rightPos + i] = right[i];
  return chars.join('');
}

/**
 * Compute marker column positions for event times on a waterfall bar.
 */
export function computeMarkerPositions(
  markerTimesMs: number[],
  spanStart: number,
  spanEnd: number,
  traceStart: number,
  traceDuration: number,
  width: number,
): number[] {
  if (width <= 0 || traceDuration <= 0 || markerTimesMs.length === 0) return [];
  return markerTimesMs.map((t) => {
    const ratio = (t - traceStart) / traceDuration;
    const col = Math.floor(ratio * width);
    return Math.max(0, Math.min(col, width - 1));
  });
}

/**
 * Build a waterfall bar string with event markers overlaid as ◆.
 */
export function buildWaterfallBarWithMarkers(
  markerTimesMs: number[],
  spanStart: number,
  spanDuration: number,
  traceStart: number,
  traceDuration: number,
  width: number,
): string {
  const bar = buildWaterfallBar(
    spanStart,
    spanDuration,
    traceStart,
    traceDuration,
    width,
  );
  if (markerTimesMs.length === 0 || width <= 0) return bar;
  const positions = computeMarkerPositions(
    markerTimesMs,
    spanStart,
    spanStart + spanDuration,
    traceStart,
    traceDuration,
    width,
  );
  const chars = [...bar];
  for (const pos of positions) {
    chars[pos] = '◆';
  }
  return chars.join('');
}

/**
 * Adjust a panel split percentage by a delta, clamped to [20, 80].
 */
export function adjustPanelSplit(
  current: number,
  delta: number,
  min = 20,
  max = 80,
): number {
  return Math.max(min, Math.min(max, current + delta));
}
