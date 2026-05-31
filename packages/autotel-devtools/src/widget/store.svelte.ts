/**
 * Global store using a runes-backed signal shim for reactive state management.
 * See `signals.svelte.ts` for the `.value`-preserving API over Svelte 5 runes.
 */

import { signal, computed, effect } from './signals.svelte';
import type {
  WidgetData,
  TraceData,
  MetricData,
  HealthStatus,
  ErrorGroup,
  LogData,
  TabType,
  CornerPosition,
  DockPosition,
} from './types';
import { buildResourceSummaries } from './utils/resources';
import { isGenAiSpan } from './genai/detect';
import { toGenAiSpan } from './genai/normalize';
import { buildToolResultIndex, hydrateToolResults } from './genai/stitch';
import type { GenAiSpan } from './genai/types';
import type { SpanData } from './types';
import type { Shortcut } from './shortcuts';

// ===== Widget UI State =====
export const widgetExpandedSignal = signal(false);
export const widgetPositionSignal = signal({ x: 20, y: 20 });
export const widgetCornerSignal = signal<CornerPosition>('bottom-right');
export const widgetDockedSignal = signal<DockPosition>(null);

export const selectedTabSignal = signal<TabType>('traces');
export const selectedTraceIdSignal = signal<string | null>(null);
// One-shot deep-link target: when set, the trace detail view selects this span
// on open, then clears it. Lets any view (Flow, GenAI, Errors) say "open trace
// X focused on span Y" without each managing its own selection plumbing.
export const selectedSpanIdSignal = signal<string | null>(null);

// External deep-link request (e.g. the VS Code extension opens the widget at a
// specific span via a URL hash). Applied once the target trace has arrived over
// the wire — see Widget.svelte — so it survives the async data load.
export const pendingDeepLinkSignal = signal<{
  traceId: string;
  spanId?: string;
} | null>(null);

export function requestDeepLink(traceId: string, spanId?: string): void {
  pendingDeepLinkSignal.value = { traceId, spanId };
}

export type ThemeValue = 'system' | 'light' | 'dark';
export const themeSignal = signal<ThemeValue>('system');

export function getInitialTheme(): ThemeValue {
  try {
    const stored = localStorage.getItem('autotel-devtools-theme');
    if (stored === 'light' || stored === 'dark' || stored === 'system')
      return stored;
  } catch {
    /* localStorage unavailable (SSR / sandboxed iframe) */
  }
  return 'system';
}

const THEME_CYCLE: ThemeValue[] = ['system', 'light', 'dark'];
export function cycleTheme() {
  const idx = THEME_CYCLE.indexOf(themeSignal.value);
  const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
  themeSignal.value = next;
  try {
    localStorage.setItem('autotel-devtools-theme', next);
  } catch {
    /* localStorage unavailable */
  }
}

// ===== Editor scheme (code-location deep links) =====
// Which editor's URL scheme to use when turning `code.*` span attributes into
// clickable source links. Persisted independently of widget layout state.
export type EditorSchemeValue = 'vscode' | 'cursor' | 'webstorm';
const EDITOR_SCHEME_KEY = 'autotel-devtools-editor';

function readEditorScheme(): EditorSchemeValue {
  try {
    const stored = localStorage.getItem(EDITOR_SCHEME_KEY);
    if (stored === 'vscode' || stored === 'cursor' || stored === 'webstorm')
      return stored;
  } catch {
    /* localStorage unavailable */
  }
  return 'vscode';
}

export const editorSchemeSignal = signal<EditorSchemeValue>(readEditorScheme());

export function setEditorScheme(scheme: EditorSchemeValue) {
  editorSchemeSignal.value = scheme;
  try {
    localStorage.setItem(EDITOR_SCHEME_KEY, scheme);
  } catch {
    /* localStorage unavailable */
  }
}

// ===== Keyboard-shortcut help modal =====
// Single source of truth so only one help modal ever renders, regardless of
// how many views register a `?` handler. `null` = closed.
export const helpShortcutsSignal = signal<Shortcut[] | null>(null);
export function openHelp(shortcuts: Shortcut[]) {
  helpShortcutsSignal.value = shortcuts;
}
export function closeHelp() {
  helpShortcutsSignal.value = null;
}
export function toggleHelp(shortcuts: Shortcut[]) {
  helpShortcutsSignal.value = helpShortcutsSignal.value ? null : shortcuts;
}

export const popoverDimensionsSignal = signal({
  width: 630,
  height: 400,
});

// ===== Data State =====
export const tracesSignal = signal<TraceData[]>([]);
export const metricsSignal = signal<MetricData[]>([]);
export const healthSignal = signal<HealthStatus>({
  connectionStatus: 'disconnected',
});
export const errorGroupsSignal = signal<ErrorGroup[]>([]);
export const logsSignal = signal<LogData[]>([]);

export const connectionStatusSignal = signal<string>('disconnected');

// ===== Live tail pause buffer =====
// Exported so stories and tests can drive these states without going through
// a paused live socket; mirrors how other data signals are exposed.
export const pausedSignal = signal(false);
export const pendingTracesSignal = signal<TraceData[]>([]);
export const pendingLogsSignal = signal<LogData[]>([]);

export const pendingTraceCountSignal = computed(
  () => pendingTracesSignal.value.length,
);
export const pendingLogCountSignal = computed(
  () => pendingLogsSignal.value.length,
);

// Marks the store as displaying a loaded snapshot rather than live data.
export const snapshotModeSignal = signal(false);

// ===== Computed Signals =====

/**
 * Failed traces (errors)
 */
export const failedTracesSignal = computed(() =>
  tracesSignal.value.filter((trace) => trace.status === 'ERROR'),
);

/**
 * Unseen failures count
 */
export const unseenFailuresSignal = computed(() => {
  const failures = failedTracesSignal.value;
  // In production, you'd track which failures have been "seen"
  // For now, just count all errors when widget is collapsed
  return widgetExpandedSignal.value ? 0 : failures.length;
});

/**
 * Trace list sort. `time` (newest first) is the default; other keys help
 * surface the slowest / largest / failing traces for debugging.
 */
export type TraceSortKey =
  | 'time'
  | 'duration'
  | 'spans'
  | 'service'
  | 'name'
  | 'status';
export type SortDir = 'asc' | 'desc';

export const traceSortSignal = signal<{ key: TraceSortKey; dir: SortDir }>({
  key: 'time',
  dir: 'desc',
});

// Default direction when first switching to a key: numeric/time keys descend
// (biggest/newest first), text/status keys ascend.
const DEFAULT_SORT_DIR: Record<TraceSortKey, SortDir> = {
  time: 'desc',
  duration: 'desc',
  spans: 'desc',
  service: 'asc',
  name: 'asc',
  status: 'desc',
};

export function setTraceSort(key: TraceSortKey) {
  const cur = traceSortSignal.value;
  traceSortSignal.value =
    cur.key === key
      ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: DEFAULT_SORT_DIR[key] };
}

function traceSortValue(t: TraceData, key: TraceSortKey): number | string {
  switch (key) {
    case 'duration':
      return t.duration;
    case 'spans':
      return t.spans.length;
    case 'service':
      return t.service ?? '';
    case 'name':
      return t.rootSpan?.name ?? '';
    case 'status':
      return t.status === 'ERROR' ? 1 : 0;
    default:
      return t.startTime;
  }
}

export const sortedTracesSignal = computed(() => {
  const { key, dir } = traceSortSignal.value;
  const factor = dir === 'asc' ? 1 : -1;
  return [...tracesSignal.value].sort((a, b) => {
    const av = traceSortValue(a, key);
    const bv = traceSortValue(b, key);
    const cmp =
      typeof av === 'string'
        ? av.localeCompare(bv as string)
        : (av as number) - (bv as number);
    // Stable tiebreak on start time so equal keys keep a deterministic order.
    return cmp !== 0 ? cmp * factor : (b.startTime - a.startTime);
  });
});

/**
 * Metrics grouped by type
 */
export const groupedMetricsSignal = computed(() => {
  const metrics = metricsSignal.value;
  return {
    events: metrics.filter((m) => m.type === 'event'),
    funnels: metrics.filter((m) => m.type === 'funnel'),
    outcomes: metrics.filter((m) => m.type === 'outcome'),
    values: metrics.filter((m) => m.type === 'value'),
  };
});

/**
 * Logs sorted by most recent first
 */
export const sortedLogsSignal = computed(() =>
  [...logsSignal.value].sort((a, b) => b.timestamp - a.timestamp),
);

export const resourceSummariesSignal = computed(() =>
  buildResourceSummaries({
    traces: tracesSignal.value,
    logs: logsSignal.value,
    errors: errorGroupsSignal.value,
  }),
);

/**
 * GenAI rows — normalized once whenever traces change, not per render.
 * Each row pairs the raw span with its normalized GenAiSpan, the service
 * it came from, and the traceId for cross-linking.
 */
export interface GenAiRow {
  raw: SpanData;
  normalized: GenAiSpan;
  service: string;
  traceId: string;
}

export const genAiRowsSignal = computed<GenAiRow[]>(() => {
  const rows: GenAiRow[] = [];
  for (const trace of tracesSignal.value) {
    const toolResultIndex = buildToolResultIndex(trace.spans);
    for (const span of trace.spans) {
      if (!isGenAiSpan(span)) continue;
      const normalized = toGenAiSpan(span);
      hydrateToolResults(normalized, toolResultIndex);
      rows.push({ raw: span, normalized, service: trace.service, traceId: trace.traceId });
    }
  }
  // Newest first.
  rows.sort((a, b) => b.normalized.startNs - a.normalized.startNs);
  return rows;
});

export const genAiCountSignal = computed(() => genAiRowsSignal.value.length);

/**
 * Number of traces that have more than one span — i.e. traces worth showing as
 * a Flow call graph. A single-span trace has no flow to draw, so the Flow tab
 * badge counts only multi-span traces.
 */
export const flowCountSignal = computed(
  () => tracesSignal.value.filter((t) => t.spans.length > 1).length,
);

/**
 * Error groups sorted by most recent
 */
export const sortedErrorGroupsSignal = computed(() =>
  [...errorGroupsSignal.value].sort((a, b) => b.lastSeen - a.lastSeen),
);

/**
 * Error groups sorted by frequency
 */
export const errorGroupsByFrequencySignal = computed(() =>
  [...errorGroupsSignal.value].sort((a, b) => b.count - a.count),
);

/**
 * Total error count across all groups
 */
export const totalErrorCountSignal = computed(() =>
  errorGroupsSignal.value.reduce((sum, group) => sum + group.count, 0),
);

/**
 * Recent error count (last hour)
 */
export const recentErrorCountSignal = computed(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  return errorGroupsSignal.value
    .filter((group) => group.lastSeen > oneHourAgo)
    .reduce((sum, group) => sum + group.count, 0);
});

/**
 * Selected trace data
 */
export const selectedTraceSignal = computed(() => {
  const traceId = selectedTraceIdSignal.value;
  if (!traceId) return null;
  return tracesSignal.value.find((t) => t.traceId === traceId) || null;
});

// ===== Multi-select =====
export const selectedTraceIdsSignal = signal<Set<string>>(new Set());

export function toggleTraceSelection(traceId: string) {
  const next = new Set(selectedTraceIdsSignal.value);
  if (next.has(traceId)) next.delete(traceId);
  else next.add(traceId);
  selectedTraceIdsSignal.value = next;
}

export function selectAllTraces() {
  const all = new Set(tracesSignal.value.map((t) => t.traceId));
  selectedTraceIdsSignal.value = all;
}

export function clearTraceSelection() {
  selectedTraceIdsSignal.value = new Set();
}

export function deleteSelectedTraces() {
  const ids = selectedTraceIdsSignal.value;
  tracesSignal.value = tracesSignal.value.filter((t) => !ids.has(t.traceId));
  clearTraceSelection();
  // Also deselect trace detail if the selected trace was deleted
  if (selectedTraceIdSignal.value && ids.has(selectedTraceIdSignal.value)) {
    selectedTraceIdSignal.value = null;
  }
}

export const selectedTraceCountSignal = computed(
  () => selectedTraceIdsSignal.value.size,
);

// ===== Actions =====

function mergeTraces(existing: TraceData[], incoming: TraceData[]): TraceData[] {
  if (incoming.length === 0) return existing;
  const existingIds = new Set(existing.map((t) => t.traceId));
  const fresh = incoming.filter((t) => !existingIds.has(t.traceId));
  if (fresh.length === 0) return existing;
  return [...existing, ...fresh];
}

function mergeTracesCapped(
  existing: TraceData[],
  incoming: TraceData[],
  limit: number,
): TraceData[] {
  const merged = mergeTraces(existing, incoming);
  return merged.length > limit ? merged.slice(-limit) : merged;
}

function prependLogsCapped(existing: LogData[], incoming: LogData[]): LogData[] {
  if (incoming.length === 0) return existing;
  const merged = [...incoming, ...existing];
  return merged.length > maxHistorySize ? merged.slice(0, maxHistorySize) : merged;
}

export function updateWidgetData(data: Partial<WidgetData>) {
  // Snapshot mode is a frozen view of imported data — drop live updates,
  // but keep health/connection status flowing so the user sees connectivity.
  if (snapshotModeSignal.value) {
    if (data.health) {
      healthSignal.value = data.health;
      connectionStatusSignal.value = data.health.connectionStatus;
    }
    return;
  }

  const incomingTraces = data.traces ?? [];
  const incomingLogs = data.logs ?? [];

  if (pausedSignal.value) {
    if (incomingTraces.length > 0) {
      pendingTracesSignal.value = mergeTracesCapped(
        pendingTracesSignal.value,
        incomingTraces,
        maxHistorySize,
      );
    }
    if (incomingLogs.length > 0) {
      pendingLogsSignal.value = prependLogsCapped(
        pendingLogsSignal.value,
        incomingLogs,
      );
    }
  } else {
    if (incomingTraces.length > 0) {
      tracesSignal.value = mergeTraces(tracesSignal.value, incomingTraces);
    }
    if (incomingLogs.length > 0) {
      logsSignal.value = prependLogsCapped(logsSignal.value, incomingLogs);
    }
  }

  if (data.metrics) {
    metricsSignal.value = [...metricsSignal.value, ...data.metrics];
  }

  if (data.health) {
    healthSignal.value = data.health;
    connectionStatusSignal.value = data.health.connectionStatus;
  }

  if (data.errors) {
    errorGroupsSignal.value = data.errors;
  }
}

export function setPaused(paused: boolean) {
  if (pausedSignal.value === paused) return;
  pausedSignal.value = paused;
  if (!paused) {
    const pendingTraces = pendingTracesSignal.value;
    const pendingLogs = pendingLogsSignal.value;
    if (pendingTraces.length > 0) {
      tracesSignal.value = mergeTraces(tracesSignal.value, pendingTraces);
      pendingTracesSignal.value = [];
    }
    if (pendingLogs.length > 0) {
      logsSignal.value = prependLogsCapped(logsSignal.value, pendingLogs);
      pendingLogsSignal.value = [];
    }
  }
}

export function togglePaused() {
  setPaused(!pausedSignal.value);
}

export function dropPendingBuffer() {
  pendingTracesSignal.value = [];
  pendingLogsSignal.value = [];
}

export function loadSnapshot(snapshot: {
  traces?: TraceData[];
  logs?: LogData[];
  errors?: ErrorGroup[];
  metrics?: MetricData[];
}) {
  tracesSignal.value = snapshot.traces ?? [];
  logsSignal.value = (snapshot.logs ?? []).slice(0, maxHistorySize);
  errorGroupsSignal.value = snapshot.errors ?? [];
  metricsSignal.value = snapshot.metrics ?? [];
  pendingTracesSignal.value = [];
  pendingLogsSignal.value = [];
  pausedSignal.value = false;
  snapshotModeSignal.value = true;
}

export function exitSnapshotMode() {
  snapshotModeSignal.value = false;
  tracesSignal.value = [];
  logsSignal.value = [];
  errorGroupsSignal.value = [];
  metricsSignal.value = [];
}

export function toggleWidget() {
  widgetExpandedSignal.value = !widgetExpandedSignal.value;
}

export function setSelectedTab(tab: TabType) {
  selectedTabSignal.value = tab;
}

export function setSelectedTrace(
  traceId: string | null,
  spanId: string | null = null,
) {
  selectedTraceIdSignal.value = traceId;
  selectedSpanIdSignal.value = traceId ? spanId : null;
  if (traceId) {
    // Expand popover when viewing trace details
    popoverDimensionsSignal.value = {
      width: Math.min(window.innerWidth * 0.6, 900),
      height: Math.min(window.innerHeight * 0.7, 700),
    };
  } else {
    // Collapse to default size
    popoverDimensionsSignal.value = { width: 630, height: 400 };
  }
}

/** Deep-link to a span: open its trace in the Traces waterfall, focused. */
export function openSpanInWaterfall(traceId: string, spanId?: string) {
  setSelectedTrace(traceId, spanId ?? null);
  setSelectedTab('traces');
}

export function setWidgetPosition(x: number, y: number) {
  widgetPositionSignal.value = { x, y };
}

export function setWidgetCorner(corner: CornerPosition) {
  widgetCornerSignal.value = corner;
}

export function setWidgetDocked(docked: DockPosition) {
  widgetDockedSignal.value = docked;
}

export function setPopoverDimensions(width: number, height: number) {
  popoverDimensionsSignal.value = { width, height };
}

const maxHistorySize = 100;

export function clearAllData() {
  tracesSignal.value = [];
  metricsSignal.value = [];
  errorGroupsSignal.value = [];
  logsSignal.value = [];
  pendingTracesSignal.value = [];
  pendingLogsSignal.value = [];
  snapshotModeSignal.value = false;
}

/**
 * Import traces (adds to existing traces, deduplicating by traceId)
 */
export function importTraces(traces: TraceData[]) {
  if (traces.length === 0) return;

  const existingIds = new Set(tracesSignal.value.map((t) => t.traceId));
  const newTraces = traces.filter((t) => !existingIds.has(t.traceId));

  if (newTraces.length > 0) {
    console.log(`[Autotel Devtools] Importing ${newTraces.length} trace(s)`);
    tracesSignal.value = [...tracesSignal.value, ...newTraces];
  } else {
    console.log('[Autotel Devtools] No new traces to import (all duplicates)');
  }
}

// ===== Persistence (localStorage) =====

const STORAGE_KEY = 'autotel-devtools-widget-state';

export function loadPersistedState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const state = JSON.parse(stored);
      if (state.position) widgetPositionSignal.value = state.position;
      if (state.corner) widgetCornerSignal.value = state.corner;
      if (state.docked !== undefined) widgetDockedSignal.value = state.docked;
    }
  } catch (error) {
    console.error('[Autotel Devtools] Failed to load persisted state:', error);
  }
}

export function persistState() {
  try {
    const state = {
      position: widgetPositionSignal.value,
      corner: widgetCornerSignal.value,
      docked: widgetDockedSignal.value,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('[Autotel Devtools] Failed to persist state:', error);
  }
}

// Auto-persist on state changes
effect(() => {
  // Access signals to subscribe to their changes
  void widgetPositionSignal.value;
  void widgetCornerSignal.value;
  void widgetDockedSignal.value;
  persistState();
});
