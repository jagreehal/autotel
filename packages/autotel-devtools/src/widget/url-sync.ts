/**
 * URL ↔ navigation-state sync (pure helpers).
 *
 * The standalone full-page UI reflects its current view in the location hash so
 * it can be bookmarked and shared (`#tab=genai&trace=<id>&span=<id>`). These
 * helpers are pure — no DOM, no signals — so they're trivially testable; the
 * side-effecting read/write lives in `Widget.svelte` and only runs in
 * `mode: 'fullpage'` (never in the embedded widget, which must not touch the
 * host page's URL).
 */

import type { TabType } from './types';
import type {
  TraceSortKey,
  SortDir,
  TraceStatusFilter,
  TraceTimeRangeFilter,
} from './store.svelte';

export const TAB_VALUES: readonly TabType[] = [
  'traces',
  'resources',
  'service-map',
  'metrics',
  'logs',
  'errors',
  'genai',
  'flow',
  'security',
];

/** The tab shown by default — omitted from the hash to keep clean URLs. */
export const DEFAULT_TAB: TabType = 'traces';

export function isTabType(v: string | null | undefined): v is TabType {
  return v != null && (TAB_VALUES as readonly string[]).includes(v);
}

const SORT_KEYS: readonly TraceSortKey[] = [
  'time',
  'duration',
  'spans',
  'service',
  'name',
  'status',
];
const STATUS_VALUES: readonly TraceStatusFilter[] = ['error', 'ok'];
const TIME_RANGE_VALUES: readonly TraceTimeRangeFilter[] = ['5m', '15m', '1h'];
/** Default trace sort — omitted from the hash to keep clean URLs. */
export const DEFAULT_SORT: { key: TraceSortKey; dir: SortDir } = {
  key: 'time',
  dir: 'desc',
};

export interface NavState {
  tab?: TabType;
  traceId?: string;
  spanId?: string;
  // Traces-list filters (omitted when at their defaults).
  q?: string;
  status?: TraceStatusFilter;
  minDuration?: number;
  timeRange?: TraceTimeRangeFilter;
  sort?: { key: TraceSortKey; dir: SortDir };
  // GenAI-list filter.
  genaiQuery?: string;
}

function parseSort(
  raw: string | null,
): { key: TraceSortKey; dir: SortDir } | undefined {
  if (!raw) return undefined;
  const [key, dir] = raw.split(':');
  if (!(SORT_KEYS as readonly string[]).includes(key)) return undefined;
  const d: SortDir = dir === 'asc' ? 'asc' : 'desc';
  return { key: key as TraceSortKey, dir: d };
}

/** Parse a location hash (`#tab=genai&trace=abc&span=def`) into nav state. */
export function parseNavHash(hash: string): NavState {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return {};
  const params = new URLSearchParams(raw);
  const tab = params.get('tab');
  const traceId = params.get('trace') || undefined;
  const spanId = params.get('span') || undefined;
  const q = params.get('q') || undefined;
  const status = params.get('status');
  const minRaw = params.get('min');
  const min = minRaw != null ? Number(minRaw) : NaN;
  const range = params.get('range');
  const sort = parseSort(params.get('sort'));
  const genaiQuery = params.get('gq') || undefined;
  return {
    ...(isTabType(tab) ? { tab } : {}),
    ...(traceId ? { traceId } : {}),
    // A span is only meaningful alongside its trace.
    ...(traceId && spanId ? { spanId } : {}),
    ...(q ? { q } : {}),
    ...((STATUS_VALUES as readonly string[]).includes(status ?? '')
      ? { status: status as TraceStatusFilter }
      : {}),
    ...(Number.isFinite(min) && min > 0 ? { minDuration: min } : {}),
    ...((TIME_RANGE_VALUES as readonly string[]).includes(range ?? '')
      ? { timeRange: range as TraceTimeRangeFilter }
      : {}),
    ...(sort ? { sort } : {}),
    ...(genaiQuery ? { genaiQuery } : {}),
  };
}

/**
 * Serialize nav state into a location hash. The default tab and empty values are
 * omitted; fully-default state returns `''` (a clean, hash-less URL).
 */
export function formatNavHash(state: NavState): string {
  const params = new URLSearchParams();
  if (state.tab && state.tab !== DEFAULT_TAB) params.set('tab', state.tab);
  if (state.traceId) params.set('trace', state.traceId);
  if (state.traceId && state.spanId) params.set('span', state.spanId);
  if (state.q) params.set('q', state.q);
  if (state.status && state.status !== 'all') params.set('status', state.status);
  if (state.minDuration && state.minDuration > 0)
    params.set('min', String(state.minDuration));
  if (state.timeRange && state.timeRange !== 'all')
    params.set('range', state.timeRange);
  if (
    state.sort &&
    !(state.sort.key === DEFAULT_SORT.key && state.sort.dir === DEFAULT_SORT.dir)
  )
    params.set('sort', `${state.sort.key}:${state.sort.dir}`);
  if (state.genaiQuery) params.set('gq', state.genaiQuery);
  const s = params.toString();
  return s ? `#${s}` : '';
}
