/**
 * Security telemetry wire schema — the single source of truth for the
 * `security.*` span-attribute contract emitted by `autotel-audit`
 * (`securityEvent()`, `withSecurity()`, `createSecuritySignalProcessor()`)
 * and consumed by `autotel-subscribers`, `autotel-devtools`, and the
 * `autotel security` CLI commands.
 *
 * Dependency-free and side-effect-free by design: safe to import from
 * browser bundles (devtools widget) and anything else that only needs
 * the constants, without pulling in the OpenTelemetry SDK.
 */

export type SecuritySeverity = 'info' | 'warning' | 'error' | 'critical';

/** All severities, lowest first. */
export const SECURITY_SEVERITIES: readonly SecuritySeverity[] = [
  'info',
  'warning',
  'error',
  'critical',
];

/** Numeric rank per severity for threshold comparisons. */
export const SECURITY_SEVERITY_RANK: Record<SecuritySeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

/**
 * Parse an untrusted value (span attribute, event payload field) into a
 * severity, falling back when it is missing or malformed.
 */
export function parseSecuritySeverity(
  value: unknown,
  fallback: SecuritySeverity = 'info',
): SecuritySeverity {
  return typeof value === 'string' && value in SECURITY_SEVERITY_RANK
    ? (value as SecuritySeverity)
    : fallback;
}

/** `true` when `severity` meets or exceeds `min`. */
export function securitySeverityAtLeast(
  severity: SecuritySeverity,
  min: SecuritySeverity,
): boolean {
  return SECURITY_SEVERITY_RANK[severity] >= SECURITY_SEVERITY_RANK[min];
}

/** The higher-ranked of two severities (e.g. escalate failures to ≥ error). */
export function escalateSecuritySeverity(
  severity: SecuritySeverity,
  floor: SecuritySeverity,
): SecuritySeverity {
  return SECURITY_SEVERITY_RANK[severity] >= SECURITY_SEVERITY_RANK[floor]
    ? severity
    : floor;
}

/**
 * Span attribute keys of the security schema. Emitters and consumers must
 * reference these instead of re-typing the strings.
 */
export const SECURITY_ATTR = {
  /** Marker set on every span carrying a security event. */
  marker: 'autotel.security',
  /** Set when the event was force-kept through tail sampling. */
  forceKeep: 'autotel.security.force_keep',
  event: 'security.event',
  category: 'security.category',
  outcome: 'security.outcome',
  severity: 'security.severity',
  actorId: 'security.actor_id',
  targetType: 'security.target_type',
  targetId: 'security.target_id',
  tenantId: 'security.tenant_id',
  reason: 'security.reason',
  /** Custom metadata keys dropped because they looked credential-shaped. */
  droppedKeys: 'security.dropped_keys',
  /** Set by the signal processor on suspicious request paths. */
  suspiciousRequest: 'security.suspicious_request',
  /** Pattern name that flagged a suspicious request, e.g. `path_traversal`. */
  signal: 'security.signal',
} as const;

/** Metric names emitted by the security instrumentation. */
export const SECURITY_METRICS = {
  events: 'autotel.security.events',
  httpSuspicious: 'autotel.security.http.suspicious',
  httpDenied: 'autotel.security.http.denied',
  anomaly: 'autotel.security.anomaly',
  heartbeat: 'autotel.security.heartbeat',
} as const;

/** HTTP statuses counted as denied responses by default. */
export const SECURITY_DENIED_STATUSES: readonly number[] = [401, 403, 429];

/**
 * Span attributes carrying the HTTP response status, current semconv
 * first, legacy fallback second.
 */
export const HTTP_STATUS_ATTRIBUTES: readonly string[] = [
  'http.response.status_code',
  'http.status_code',
];
