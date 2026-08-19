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

/**
 * The member of a small union a raw URL value names, or undefined when it
 * names none of them. Reading it this way keeps the union's type on the way
 * out, so nothing downstream has to assert the string back into it.
 */
function oneOf<TValue extends string>(
  values: readonly TValue[],
  raw: string | null | undefined,
): TValue | undefined {
  return values.find((value) => value === raw);
}

export function isTabType(v: string | null | undefined): v is TabType {
  return oneOf(TAB_VALUES, v) !== undefined;
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
/** How the traces list is ordered. */
export interface TraceSort {
  key: TraceSortKey;
  dir: SortDir;
}

/** Default trace sort — omitted from the hash to keep clean URLs. */
export const DEFAULT_SORT: TraceSort = {
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
  sort?: TraceSort;
  // GenAI-list filter.
  genaiQuery?: string;
}

function parseSort(raw: string | null): TraceSort | undefined {
  if (!raw) return undefined;
  const [rawKey, rawDir] = raw.split(':');
  const key = oneOf(SORT_KEYS, rawKey);
  return key && { key, dir: rawDir === 'asc' ? 'asc' : 'desc' };
}

/** Parse a location hash (`#tab=genai&trace=abc&span=def`) into nav state. */
export function parseNavHash(hash: string): NavState {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return {};
  const params = new URLSearchParams(raw);
  const state: NavState = {};

  const tab = params.get('tab');
  if (isTabType(tab)) state.tab = tab;

  const traceId = params.get('trace') || undefined;
  if (traceId) state.traceId = traceId;
  // A span is only meaningful alongside its trace.
  const spanId = params.get('span') || undefined;
  if (traceId && spanId) state.spanId = spanId;

  const q = params.get('q') || undefined;
  if (q) state.q = q;

  const status = oneOf(STATUS_VALUES, params.get('status'));
  if (status) state.status = status;

  const minRaw = params.get('min');
  const min = minRaw == null ? Number.NaN : Number(minRaw);
  if (Number.isFinite(min) && min > 0) state.minDuration = min;

  const timeRange = oneOf(TIME_RANGE_VALUES, params.get('range'));
  if (timeRange) state.timeRange = timeRange;

  const sort = parseSort(params.get('sort'));
  if (sort) state.sort = sort;

  const genaiQuery = params.get('gq') || undefined;
  if (genaiQuery) state.genaiQuery = genaiQuery;

  return state;
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
  if (state.status && state.status !== 'all')
    params.set('status', state.status);
  if (state.minDuration && state.minDuration > 0)
    params.set('min', String(state.minDuration));
  if (state.timeRange && state.timeRange !== 'all')
    params.set('range', state.timeRange);
  if (
    state.sort &&
    !(
      state.sort.key === DEFAULT_SORT.key && state.sort.dir === DEFAULT_SORT.dir
    )
  )
    params.set('sort', `${state.sort.key}:${state.sort.dir}`);
  if (state.genaiQuery) params.set('gq', state.genaiQuery);
  const s = params.toString();
  return s ? `#${s}` : '';
}
