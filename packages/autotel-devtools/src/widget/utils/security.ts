/**
 * Security lens helpers — surface spans carrying the `security.*` schema
 * emitted by autotel-audit (securityEvent / withSecurity /
 * createSecuritySignalProcessor).
 */

import {
  SECURITY_ATTR,
  parseSecuritySeverity,
  securitySeverityAtLeast,
} from 'autotel/security-schema';
import type { SecuritySeverity } from 'autotel/security-schema';
import type { SpanData, TraceData } from '../types';

export type { SecuritySeverity };

export interface SecuritySpanInfo {
  traceId: string;
  spanId: string;
  spanName: string;
  service?: string;
  timestamp: number;
  /** `security.event` — absent for processor-flagged suspicious requests. */
  event?: string;
  category?: string;
  outcome?: string;
  severity: SecuritySeverity;
  reason?: string;
  /** True when flagged by the signal processor (`security.suspicious_request`). */
  suspicious: boolean;
  /** `security.signal` pattern name for suspicious requests. */
  signal?: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function isSecuritySpan(span: SpanData): boolean {
  const attrs = span.attributes ?? {};
  return (
    attrs[SECURITY_ATTR.event] !== undefined ||
    attrs[SECURITY_ATTR.suspiciousRequest] !== undefined
  );
}

export function extractSecurityInfo(
  span: SpanData,
  service?: string,
): SecuritySpanInfo | null {
  const attrs = span.attributes ?? {};
  const event = asString(attrs[SECURITY_ATTR.event]);
  const suspicious = attrs[SECURITY_ATTR.suspiciousRequest] === true;
  if (!event && !suspicious) return null;

  return {
    traceId: span.traceId,
    spanId: span.spanId,
    spanName: span.name,
    service,
    timestamp: span.startTime,
    event,
    category: asString(attrs[SECURITY_ATTR.category]),
    outcome: asString(attrs[SECURITY_ATTR.outcome]),
    // Processor-flagged probes carry no explicit severity — treat as warning.
    severity: parseSecuritySeverity(
      attrs[SECURITY_ATTR.severity],
      suspicious ? 'warning' : 'info',
    ),
    reason: asString(attrs[SECURITY_ATTR.reason]),
    suspicious,
    signal: asString(attrs[SECURITY_ATTR.signal]),
  };
}

export function collectSecuritySpans(traces: TraceData[]): SecuritySpanInfo[] {
  const infos: SecuritySpanInfo[] = [];
  for (const trace of traces) {
    for (const span of trace.spans) {
      const info = extractSecurityInfo(span, trace.service);
      if (info) infos.push(info);
    }
  }
  // Newest first
  return infos.sort((a, b) => b.timestamp - a.timestamp);
}

export function countBySeverity(
  infos: SecuritySpanInfo[],
): Record<SecuritySeverity, number> {
  const counts: Record<SecuritySeverity, number> = {
    info: 0,
    warning: 0,
    error: 0,
    critical: 0,
  };
  for (const info of infos) counts[info.severity] += 1;
  return counts;
}

export function severityAtLeast(
  info: SecuritySpanInfo,
  min: SecuritySeverity,
): boolean {
  return securitySeverityAtLeast(info.severity, min);
}

/** Badge classes per severity (Tailwind utilities only — shadow DOM rules). */
export function severityBadgeClass(severity: SecuritySeverity): string {
  switch (severity) {
    case 'critical': {
      return 'bg-red-100 text-red-700';
    }
    case 'error': {
      return 'bg-orange-100 text-orange-700';
    }
    case 'warning': {
      return 'bg-amber-100 text-amber-700';
    }
    default: {
      return 'bg-hover text-fg-muted';
    }
  }
}
