import type {
  AgentEvent,
  AgentKind,
  AgentRawEvent,
  MetricTemporality,
  OtelMetricRecord,
} from '../types';

/** A metric-only signal (lines of code, commits, active time, …) keyed to a session. */
export interface AgentMetricSignal {
  agent: AgentKind;
  /** session.id from the data point / resource, when present. */
  sessionId?: string;
  identity: SessionIdentity;
  kind: AgentMetricKind;
  value: number;
  /** Counter temporality — `cumulative` values are differenced per series. */
  temporality?: MetricTemporality;
  timestamp: number;
  /** Original data-point attributes (e.g. `type: "input"` on token usage). */
  attributes: Record<string, unknown>;
}

// Only the metric-only signals we actually fold into rollups have a kind.
// Everything that overlaps an event (token.usage, cost.usage,
// code_edit_tool.decision, session.count) maps to 'other' and is ignored —
// events are authoritative.
export type AgentMetricKind =
  | 'lines_of_code'
  | 'commit'
  | 'pull_request'
  | 'active_time'
  | 'other';

/** Common identity attributes shared by every signal in a session. */
export interface SessionIdentity {
  user?: string;
  organization?: string;
  terminal?: string;
  appVersion?: string;
  model?: string;
}

/**
 * An adapter recognizes one agent's telemetry (by instrumentation scope and/or
 * metric/event-name prefix) and normalizes it to the shared model. Adding Codex
 * or another agent = adding one adapter; no UI or reducer changes.
 */
export interface AgentAdapter {
  kind: AgentKind;
  matchesMetric(record: OtelMetricRecord): boolean;
  matchesEvent(record: AgentRawEvent): boolean;
  normalizeEvent(record: AgentRawEvent): AgentEvent | null;
  normalizeMetric(record: OtelMetricRecord): AgentMetricSignal[];
}
