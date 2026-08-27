/**
 * The global time window, shared by every tab.
 *
 * One control, one meaning, everywhere — previously only the Traces tab had a
 * range filter, so "last 15m" meant something on one screen and nothing on the
 * next. Pure functions only: the signal that holds the current selection lives
 * in `store.svelte.ts`, and views read the resolved window from there.
 *
 * The distinction that matters: **"All" is the absence of a choice.** A view may
 * fit itself to its own data when the window is unbounded. Any other selection
 * is a request, and must never be widened or cropped to make a chart look
 * better — an empty 15-minute window is the answer, not a rendering problem.
 */

export type PresetId =
  'all' | '5m' | '15m' | '30m' | '1h' | '3h' | '6h' | '24h' | '7d';

export interface Preset {
  id: PresetId;
  label: string;
  /** Window length in ms. `null` for "All", which has no length. */
  durationMs: number | null;
}

export const PRESETS: readonly Preset[] = [
  { id: 'all', label: 'All time', durationMs: null },
  { id: '5m', label: 'Last 5m', durationMs: 5 * 60_000 },
  { id: '15m', label: 'Last 15m', durationMs: 15 * 60_000 },
  { id: '30m', label: 'Last 30m', durationMs: 30 * 60_000 },
  { id: '1h', label: 'Last 1h', durationMs: 60 * 60_000 },
  { id: '3h', label: 'Last 3h', durationMs: 3 * 60 * 60_000 },
  { id: '6h', label: 'Last 6h', durationMs: 6 * 60 * 60_000 },
  { id: '24h', label: 'Last 24h', durationMs: 24 * 60 * 60_000 },
  { id: '7d', label: 'Last 7d', durationMs: 7 * 24 * 60 * 60_000 },
];

/**
 * Typed as the preset arm rather than the union: `serializeWindow` compares
 * against `DEFAULT_SELECTION.preset`, which the widened union does not expose.
 */
export const DEFAULT_SELECTION = {
  type: 'preset',
  preset: 'all',
} as const satisfies WindowSelection;

/**
 * What the user chose, as opposed to what it currently resolves to.
 *
 * A preset is stored as an intent ("the last 15 minutes") rather than as a pair
 * of timestamps, so it keeps tracking `now` instead of freezing at the moment
 * it was picked. A custom range is stored as the bounds themselves, because
 * those *are* the intent.
 */
export type WindowSelection =
  | { type: 'preset'; preset: PresetId }
  | { type: 'custom'; start: number; end: number };

/** A resolved window. `null` bounds mean unbounded — see `isUnbounded`. */
export interface TimeWindow {
  start: number | null;
  end: number | null;
}

const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

export function presetWindow(id: PresetId, now: number): TimeWindow {
  const preset = PRESET_BY_ID.get(id);
  if (!preset || preset.durationMs === null) return { start: null, end: null };
  return { start: now - preset.durationMs, end: now };
}

export function resolveWindow(
  selection: WindowSelection,
  now: number,
): TimeWindow {
  if (selection.type === 'preset') return presetWindow(selection.preset, now);
  // Tolerate reversed bounds: dragging a range selection right-to-left is a
  // normal gesture, and returning an empty window for it would read as a bug.
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);
  return { start, end };
}

/**
 * Whether this window represents "no choice made".
 *
 * Deliberately *not* "is the window very wide": a custom range covering all of
 * history is still a request, and a view must not refit itself against it.
 */
export function isUnbounded(window: TimeWindow): boolean {
  return window.start === null || window.end === null;
}

export function windowLabel(selection: WindowSelection): string {
  if (selection.type === 'preset') {
    return PRESET_BY_ID.get(selection.preset)?.label ?? 'All time';
  }
  return `${formatStamp(selection.start)} → ${formatStamp(selection.end)}`;
}

function formatStamp(ms: number): string {
  const date = new Date(ms);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  if (sameDay) return time;
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}

/**
 * Serialize for the URL hash, or `null` when the selection is the default.
 *
 * Omitting the default keeps shared links free of parameters that say nothing.
 */
export function serializeWindow(selection: WindowSelection): string | null {
  if (selection.type === 'preset') {
    return selection.preset === DEFAULT_SELECTION.preset
      ? null
      : selection.preset;
  }
  return `custom:${selection.start}:${selection.end}`;
}

/**
 * Parse a URL value back into a selection.
 *
 * Anything unrecognised falls back to the default rather than throwing: a hand-
 * edited or truncated link should open the app, not break it.
 */
export function parseWindowParam(
  raw: string | null | undefined,
): WindowSelection {
  if (!raw) return DEFAULT_SELECTION;

  if (raw.startsWith('custom:')) {
    const [, rawStart, rawEnd] = raw.split(':');
    const start = Number(rawStart);
    const end = Number(rawEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return DEFAULT_SELECTION;
    }
    return { type: 'custom', start, end };
  }

  return PRESET_BY_ID.has(raw as PresetId)
    ? { type: 'preset', preset: raw as PresetId }
    : DEFAULT_SELECTION;
}

/**
 * The window as the query API wants it, or `undefined` when unbounded.
 *
 * `undefined` and `{start: 0, end: now}` are different requests: the first lets
 * the server skip the time predicate entirely, the second forces it to filter
 * on a column it could have ignored.
 */
export function toQueryWindow(
  window: TimeWindow,
): { start: number; end: number } | undefined {
  if (isUnbounded(window)) return undefined;
  return { start: window.start as number, end: window.end as number };
}
