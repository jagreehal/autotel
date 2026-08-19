// src/server/types.ts
import type { AgentSession } from 'autotel-agents';
import type { SpanAttributes } from '../widget/types.js';

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
  status: { code: 'OK' | 'ERROR' | 'UNSET'; message?: string };
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

export interface MetricData {
  type: 'event' | 'funnel' | 'outcome' | 'value';
  name: string;
  value?: number;
  attributes: SpanAttributes;
  timestamp: number;
  traceId?: string;
}

export interface ErrorGroup {
  fingerprint: string;
  type: string;
  message: string;
  stackTrace?: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  affectedTraces: string[];
  affectedSpans: string[];
  service?: string;
  attributes?: SpanAttributes;
}

export interface ErrorOccurrence {
  traceId: string;
  spanId: string;
  spanName: string;
  service: string;
  timestamp: number;
  error: {
    type: string;
    message: string;
    stackTrace?: string;
    /**
     * Grouping key the emitting SDK already decided on (`exception.fingerprint`,
     * written by autotel's `exceptionFingerprint()` enricher). When present the
     * aggregator groups by it instead of re-deriving one from the stack string,
     * so this tab agrees with every other backend receiving the same spans.
     */
    fingerprint?: string;
  };
  attributes?: SpanAttributes;
}

export interface DevtoolsData {
  traces: TraceData[];
  metrics: MetricData[];
  logs: LogData[];
  errors: ErrorGroup[];
  /** Full-state on every broadcast (client replaces, like `errors`). Coding-agent
   *  sessions reconstructed from agent metrics + log events. */
  agents?: AgentSession[];
}
