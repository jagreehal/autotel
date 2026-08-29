/**
 * Core data types for Autotel Devtools Widget
 */

import type { AgentSession } from 'autotel-agents';

/**
 * What a span attribute holds once it has crossed OTLP. The widget is
 * browser-safe and does not depend on the OTel API package, so the value type
 * is named here rather than imported.
 */
export type AttributeValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Uint8Array
  | Array<AttributeValue>
  | { [key: string]: AttributeValue };

/**
 * A span's attribute bag as the devtools receives it. Wider than OpenTelemetry's
 * own `Attributes` on purpose: OTLP's kvlist and array values decode to nested
 * maps and lists, and the devtools displays whatever actually arrived.
 */
export type SpanAttributes = Record<string, AttributeValue>;

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
  attributes: SpanAttributes;
  status: {
    code: 'OK' | 'ERROR' | 'UNSET';
    message?: string;
  };
  events?: Array<{
    name: string;
    timestamp: number;
    attributes?: SpanAttributes;
  }>;
  links?: Array<{
    traceId: string;
    spanId: string;
    attributes?: SpanAttributes;
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
  attributes?: SpanAttributes;
  resource?: Record<string, unknown>;
}

export interface WidgetData {
  traces: TraceData[];
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
  attributes?: SpanAttributes;
}

export type TabType =
  | 'traces'
  | 'compare'
  | 'coverage'
  | 'agents'
  | 'resources'
  | 'service-map'
  | 'metrics'
  | 'logs'
  | 'errors'
  | 'genai'
  | 'flow'
  | 'security'
  | 'webmcp';

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

/**
 * The WebMCP tool surface, as folded by `server/webmcp-aggregator`.
 *
 * A tool is not a span: it is a name whose lifecycle spans a registration, any
 * number of executions and possibly a withdrawal, and it is only meaningful
 * within the installation (page load) that registered it.
 */
export interface WebMcpCall {
  timestamp: number;
  durationMs: number;
  resultBytes: number;
  resultType?: string;
  envelope: boolean;
  substituted: boolean;
  error: boolean;
  /** Present only when the app opted into payload capture. Render masked. */
  input?: string;
  /** The exact string the agent received. Present only with payload capture. */
  result?: string;
  traceId: string;
  spanId: string;
}

export interface WebMcpTool {
  name: string;
  /** Installation (page load) this record belongs to. */
  installationId: string;
  service: string;
  sessionId?: string;
  /** False when the tool was only ever seen executing — see the module note. */
  observedAtRegistration: boolean;
  /** True while the tool is offered: registered, and not since withdrawn. */
  offered: boolean;
  firstSeen: number;
  lastSeen: number;
  descriptionLength?: number;
  hasInputSchema?: boolean;
  annotationsSent: string[];
  /** Annotations the browser discarded. Available nowhere else. */
  annotationsDropped: string[];
  calls: number;
  errors: number;
  /** Executions whose result was an unwrapped MCP `{ content: [...] }` envelope. */
  envelopeCalls: number;
  /** Of `resultBytes`, the part that is envelope wrapper rather than content. */
  envelopeBytes: number;
  /** Executions where the browser replaced an empty result with its own text. */
  substitutedCalls: number;
  /** UTF-8 bytes of result the agent has paid for across every call. */
  resultBytes: number;
  medianResultBytes: number;
  /** The last few executions, newest first. Bounded — this is not a call log. */
  recentCalls: WebMcpCall[];
  traceId?: string;
  spanId?: string;
}

export interface WebMcpSummary {
  installations: number;
  /** Installations that registered nothing — the "instrumented too late" signature. */
  emptyInstallations: number;
  toolsOffered: number;
  toolsWithdrawn: number;
  calls: number;
  errors: number;
  resultBytes: number;
  /** Bytes that are envelope wrapper rather than content. See `envelopeOverhead`. */
  envelopeBytes: number;
  toolsWithDroppedAnnotations: number;
  toolsWithoutInputSchema: number;
}

export interface WebMcpInventory {
  tools: WebMcpTool[];
  summary: WebMcpSummary;
}
