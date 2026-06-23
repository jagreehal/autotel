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
// Edge the expanded panel docks to. The panel is non-blocking (no backdrop) and
// the host page stays interactive — same model as the TanStack Query devtools.
export const widgetDockedSignal = signal<DockPosition>('bottom');
// True while the panel is popped out into a Document Picture-in-Picture window.
export const pipActiveSignal = signal(false);

export const selectedTabSignal = signal<TabType>('traces');
export const selectedTraceIdSignal = signal<string | null>(null);
// Persistent selected-span source of truth. `TraceDetailView` derives the
// selected span object from this signal (and writes it back on user clicks), so
// any view (Flow, GenAI, Errors) can say "open trace X focused on span Y" by
// setting it, and full-page mode can reflect it in the shareable URL.
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

/**
 * Size of the docked panel along its docking axis, in px:
 * - `vertical` is the height when docked to `top`/`bottom`
 * - `horizontal` is the width when docked to `left`/`right`
 *
 * The panel always spans the full cross-axis, so this is the only dimension the
 * user controls. It is persisted and never changes on its own — selecting a
 * trace no longer resizes the panel (that was the old "size jumps around" bug).
 */
/** Default panel size per axis, used as the initial value and on reset. */
export const DEFAULT_PANEL_SIZE: { vertical: number; horizontal: number } = {
  vertical: 440,
  horizontal: 560,
};

export const panelSizeSignal = signal({ ...DEFAULT_PANEL_SIZE });

/** Clamp limits for the docked panel, derived from the viewport at call time. */
export function panelSizeBounds(axis: 'vertical' | 'horizontal') {
  if (typeof window === 'undefined') {
    return axis === 'vertical'
      ? { min: 200, max: 900 }
      : { min: 360, max: 1200 };
  }
  return axis === 'vertical'
    ? { min: 200, max: Math.round(window.innerHeight * 0.92) }
    : { min: 360, max: Math.round(window.innerWidth * 0.92) };
}

export function setPanelSize(axis: 'vertical' | 'horizontal', px: number) {
  const { min, max } = panelSizeBounds(axis);
  const clamped = Math.min(max, Math.max(min, Math.round(px)));
  panelSizeSignal.value = { ...panelSizeSignal.value, [axis]: clamped };
}

/** Reset one axis to its default size (double-click the resize handle). */
export function resetPanelSize(axis: 'vertical' | 'horizontal') {
  setPanelSize(axis, DEFAULT_PANEL_SIZE[axis]);
}

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
export const pendingMetricsSignal = signal<MetricData[]>([]);

export const pendingTraceCountSignal = computed(
  () => pendingTracesSignal.value.length,
);
export const pendingLogCountSignal = computed(
  () => pendingLogsSignal.value.length,
);
export const pendingMetricCountSignal = computed(
  () => pendingMetricsSignal.value.length,
);

// Metrics arrive without a unique id; assign a monotonic one at ingestion so
// the (live-updating, capped) metrics list can key on it instead of the array
// index — index keys corrupt rendering as rows shift in/out.
let metricSeq = 0;
function withMetricId(m: MetricData): MetricData {
  return m.id ? m : { ...m, id: `m${++metricSeq}` };
}

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

// Traces-list filters. Global (not local component state) so the full-page UI
// can reflect them in the shareable URL — see `url-sync.ts` / `Widget.svelte`.
export type TraceStatusFilter = 'all' | 'error' | 'ok';
export const traceQuerySignal = signal('');
export const traceStatusFilterSignal = signal<TraceStatusFilter>('all');
export const traceMinDurationSignal = signal(0);

// GenAI-list filter — also global for the same shareable-URL reason.
export const genaiQuerySignal = signal('');

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
  rows.sort((a, b) => b.normalized.startMs - a.normalized.startMs);
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

// Recompute a trace's derived fields from its current span set. Spans arrive
// out of order and across services (browser, then API, then auth/worker), so
// the root span, timing, status, and service label are only correct once they
// are derived from the merged span list rather than from whichever batch the
// trace was first seen in.
function recomputeTrace(base: TraceData, spans: SpanData[]): TraceData {
  const sorted = [...spans].sort((a, b) => a.startTime - b.startTime);
  const rootSpan =
    sorted.find((s) => !s.parentSpanId) ?? base.rootSpan ?? sorted[0];
  const startTime = Math.min(...sorted.map((s) => s.startTime));
  const endTime = Math.max(...sorted.map((s) => s.endTime));
  const status: TraceData['status'] = sorted.some(
    (s) => s.status.code === 'ERROR',
  )
    ? 'ERROR'
    : 'OK';
  const rootService = rootSpan?.attributes?.['service.name'];
  return {
    ...base,
    rootSpan,
    spans: sorted,
    startTime,
    endTime,
    duration: endTime - startTime,
    status,
    service:
      typeof rootService === 'string' && rootService.length > 0
        ? rootService
        : base.service,
  };
}

// Merge two views of the same trace, de-duplicating spans by spanId.
function mergeTraceData(base: TraceData, incoming: TraceData): TraceData {
  const byId = new Map<string, SpanData>();
  for (const s of base.spans) byId.set(s.spanId, s);
  for (const s of incoming.spans) {
    if (!byId.has(s.spanId)) byId.set(s.spanId, s);
  }
  return recomputeTrace(base, [...byId.values()]);
}

function mergeTraces(existing: TraceData[], incoming: TraceData[]): TraceData[] {
  if (incoming.length === 0) return existing;

  // Collapse any duplicate trace ids within the incoming batch first. A single
  // occurrence is trusted as-is (its derived fields already come from the OTLP
  // parser); duplicates are merged so their spans combine.
  const incomingById = new Map<string, TraceData>();
  for (const t of incoming) {
    const prev = incomingById.get(t.traceId);
    incomingById.set(t.traceId, prev ? mergeTraceData(prev, t) : t);
  }

  const existingIds = new Set(existing.map((t) => t.traceId));

  // Merge updates into existing traces in place (keep list position stable so
  // the live view does not reshuffle as new spans stream in).
  const merged = existing.map((t) => {
    const update = incomingById.get(t.traceId);
    return update ? mergeTraceData(t, update) : t;
  });

  // Append genuinely new traces in arrival order.
  for (const [id, t] of incomingById) {
    if (!existingIds.has(id)) merged.push(t);
  }

  return merged;
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

// ===== Pause-buffer streams =====
//
// Traces, logs and metrics share one shape: a live signal, a pending buffer,
// and the same ingest / flush-on-unpause / drop behaviour. Describe each stream
// once so updateWidgetData, setPaused and dropPendingBuffer stop re-spelling the
// three by hand. Only traces merge differently into live vs pending (the pending
// buffer is capped as it accumulates), so each stream carries both merges.
interface WritableList<T> {
  value: T[];
}

function makeStream<T>(
  live: WritableList<T>,
  pending: WritableList<T>,
  mergeLive: (base: T[], incoming: T[]) => T[],
  mergePending: (base: T[], incoming: T[]) => T[] = mergeLive,
) {
  return {
    /** Buffer `incoming` while paused, otherwise merge it straight into live. */
    ingest(incoming: T[], paused: boolean) {
      if (incoming.length === 0) return;
      if (paused) pending.value = mergePending(pending.value, incoming);
      else live.value = mergeLive(live.value, incoming);
    },
    /** Move the pending buffer into the live list (on un-pause). */
    flushToLive() {
      if (pending.value.length === 0) return;
      live.value = mergeLive(live.value, pending.value);
      pending.value = [];
    },
    /** Drop whatever has been buffered while paused. */
    clearPending() {
      pending.value = [];
    },
  };
}

const tracesStream = makeStream(
  tracesSignal,
  pendingTracesSignal,
  mergeTraces,
  (base, incoming) => mergeTracesCapped(base, incoming, maxHistorySize),
);
const logsStream = makeStream(logsSignal, pendingLogsSignal, prependLogsCapped);
const metricsStream = makeStream(
  metricsSignal,
  pendingMetricsSignal,
  (base, incoming) => [...base, ...incoming].slice(-maxHistorySize),
);

// Iterated for the uniform flush / clear operations. Ingest stays per-stream
// because the incoming shape differs (metrics get ids assigned at ingestion).
const PAUSE_BUFFER_STREAMS = [tracesStream, logsStream, metricsStream];

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

  // Buffer while paused, otherwise merge straight into the live lists. Metrics
  // arrive without ids, so assign them before buffering; the stream caps the
  // live/pending lists so a long-running session can't grow them unbounded.
  const paused = pausedSignal.value;
  tracesStream.ingest(data.traces ?? [], paused);
  logsStream.ingest(data.logs ?? [], paused);
  if (data.metrics && data.metrics.length > 0) {
    metricsStream.ingest(data.metrics.map(withMetricId), paused);
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
    for (const stream of PAUSE_BUFFER_STREAMS) stream.flushToLive();
  }
}

export function togglePaused() {
  setPaused(!pausedSignal.value);
}

export function dropPendingBuffer() {
  for (const stream of PAUSE_BUFFER_STREAMS) stream.clearPending();
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
  metricsSignal.value = (snapshot.metrics ?? []).map(withMetricId);
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
  // The panel keeps its user-chosen size; the trace detail renders inside it
  // (master/detail split). It deliberately does NOT resize the panel here —
  // that caused the panel to jump dimensions every time you opened a trace.
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

/** Cycle the dock edge: bottom → right → left → bottom. */
export function cycleDock() {
  const order: Exclude<DockPosition, null>[] = ['bottom', 'right', 'left'];
  const current = widgetDockedSignal.value ?? 'bottom';
  const idx = order.indexOf(current as Exclude<DockPosition, null>);
  widgetDockedSignal.value = order[(idx + 1) % order.length];
}

const maxHistorySize = 100;

export function clearAllData() {
  tracesSignal.value = [];
  metricsSignal.value = [];
  errorGroupsSignal.value = [];
  logsSignal.value = [];
  pendingTracesSignal.value = [];
  pendingLogsSignal.value = [];
  pendingMetricsSignal.value = [];
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
      // A persisted `null` (legacy floating mode) is upgraded to bottom-dock.
      if (state.docked) widgetDockedSignal.value = state.docked;
      if (state.panelSize) {
        panelSizeSignal.value = {
          vertical: Number(state.panelSize.vertical) || 440,
          horizontal: Number(state.panelSize.horizontal) || 560,
        };
      }
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
      panelSize: panelSizeSignal.value,
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
  void panelSizeSignal.value;
  persistState();
});
