/**
 * Global store using Preact Signals for reactive state management
 */

import { signal, computed, effect } from '@preact/signals';
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

// ===== Widget UI State =====
export const widgetExpandedSignal = signal(false);
export const widgetPositionSignal = signal({ x: 20, y: 20 });
export const widgetCornerSignal = signal<CornerPosition>('bottom-right');
export const widgetDockedSignal = signal<DockPosition>(null);

export const selectedTabSignal = signal<TabType>('traces');
export const selectedTraceIdSignal = signal<string | null>(null);

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
 * Traces sorted by most recent first
 */
export const sortedTracesSignal = computed(() =>
  [...tracesSignal.value].sort((a, b) => b.startTime - a.startTime),
);

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

export function setSelectedTrace(traceId: string | null) {
  selectedTraceIdSignal.value = traceId;
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
