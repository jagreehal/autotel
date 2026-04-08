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

export function updateWidgetData(data: Partial<WidgetData>) {
  if (data.traces && data.traces.length > 0) {
    console.log(
      `[Autotel Devtools] updateWidgetData: received ${data.traces.length} trace(s)`,
    );
    // Merge new traces, keeping unique by traceId
    const existingIds = new Set(tracesSignal.value.map((t) => t.traceId));
    const newTraces = data.traces.filter((t) => !existingIds.has(t.traceId));
    console.log(
      `[Autotel Devtools] Adding ${newTraces.length} new trace(s), total will be ${tracesSignal.value.length + newTraces.length}`,
    );
    tracesSignal.value = [...tracesSignal.value, ...newTraces];
  }

  if (data.metrics) {
    metricsSignal.value = [...metricsSignal.value, ...data.metrics];
  }

  if (data.health) {
    healthSignal.value = data.health;
    connectionStatusSignal.value = data.health.connectionStatus;
  }

  if (data.errors) {
    // Replace error groups with updated list from server
    errorGroupsSignal.value = data.errors;
  }

  if (data.logs && data.logs.length > 0) {
    logsSignal.value = [...data.logs, ...logsSignal.value];
    if (logsSignal.value.length > maxHistorySize) {
      logsSignal.value = logsSignal.value.slice(0, maxHistorySize);
    }
  }
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
