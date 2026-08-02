/**
 * Core data types for Autotel Devtools Widget
 */

import type { AgentSession } from 'autotel-agents';

export type { AgentSession } from 'autotel-agents';

export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: 'INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER';
  startTime: number;
  endTime: number;
  duration: number;
  attributes: Record<string, any>;
  status: {
    code: 'OK' | 'ERROR' | 'UNSET';
    message?: string;
  };
  events?: Array<{
    name: string;
    timestamp: number;
    attributes?: Record<string, any>;
  }>;
  links?: Array<{
    traceId: string;
    spanId: string;
    attributes?: Record<string, any>;
  }>;
  scope?: { name?: string; version?: string };
}

export interface TraceData {
  traceId: string;
  correlationId: string;
  rootSpan: SpanData;
  spans: SpanData[];
  startTime: number;
  endTime: number;
  duration: number;
  status: 'OK' | 'ERROR' | 'UNSET';
  service: string;
  /**
   * True when no span in this trace is a true root: every span received has a
   * parent that did not arrive. The trace is a fragment, normally because
   * sampling kept only part of it or because the rest is still in flight.
   * `rootSpan` is then the earliest span whose parent is absent rather than the
   * real root, and the duration covers only the part present. Recomputed as
   * spans merge, so it clears once the real root arrives.
   */
  partial?: boolean;
}

export interface MetricData {
  type: 'event' | 'funnel' | 'outcome' | 'value';
  name: string;
  value?: number;
  attributes: Record<string, any>;
  timestamp: number;
  traceId?: string;
  /** Stable id assigned at ingestion so live-updating lists can key on it
   *  instead of the array index (which corrupts rendering as metrics stream). */
  id?: string;
}

export interface HealthStatus {
  connectionStatus: 'connected' | 'disconnected' | 'connecting';
  lastHeartbeat?: number;
}

/** OTel log record (trace-linked when traceId/spanId present). */
export interface LogData {
  id: string;
  traceId?: string;
  spanId?: string;
  resourceName?: string;
  severityText?: string;
  severityNumber?: number;
  body: string | Record<string, unknown>;
  timestamp: number;
  attributes?: Record<string, unknown>;
  resource?: Record<string, unknown>;
}

export interface WidgetData {
  traces: TraceData[];
  metrics: MetricData[];
  health: HealthStatus;
  errors?: ErrorGroup[];
  logs?: LogData[];
  agents?: AgentSession[];
}

/**
 * Aggregated error group - groups similar errors together
 */
export interface ErrorGroup {
  /** Unique fingerprint for this error group (hash of stack trace) */
  fingerprint: string;
  /** Error type/class name */
  type: string;
  /** Error message (first occurrence) */
  message: string;
  /** Normalized stack trace (first few frames) */
  stackTrace?: string;
  /** Number of occurrences */
  count: number;
  /** Timestamp of first occurrence */
  firstSeen: number;
  /** Timestamp of most recent occurrence */
  lastSeen: number;
  /** Sample of affected trace IDs (last N) */
  affectedTraces: string[];
  /** Sample of affected span names */
  affectedSpans: string[];
  /** Service where error originated */
  service?: string;
  /** Additional attributes from the error spans */
  attributes?: Record<string, unknown>;
}

export type TabType =
  | 'traces'
  | 'agents'
  | 'resources'
  | 'service-map'
  | 'metrics'
  | 'logs'
  | 'errors'
  | 'genai'
  | 'flow'
  | 'security';

export type CornerPosition =
  'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type DockPosition = 'left' | 'right' | 'top' | 'bottom' | null;

export interface WidgetPosition {
  x: number;
  y: number;
}

/** Size of the docked panel along its docking axis (see `panelSizeSignal`). */
export interface PanelSize {
  /** Height when docked top/bottom. */
  vertical: number;
  /** Width when docked left/right. */
  horizontal: number;
}

/** A span plus its resolved children/depth, used by the waterfall view. */
export interface SpanNode {
  span: SpanData;
  children: SpanNode[];
  depth: number;
}

export interface WidgetState {
  isExpanded: boolean;
  position: WidgetPosition;
  corner: CornerPosition;
  docked: DockPosition;
  selectedTab: TabType;
  selectedTraceId: string | null;
  panelSize: PanelSize;
}
