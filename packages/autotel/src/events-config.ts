/**
 * Events configuration types for trace context, correlation IDs, and enrichment
 *
 * @example Basic usage
 * ```typescript
 * import { init } from 'autotel';
 *
 * init({
 *   service: 'my-app',
 *   events: {
 *     includeTraceContext: true,
 *     traceUrl: (ctx) => `https://grafana.internal/explore?traceId=${ctx.traceId}`
 *   }
 * });
 * ```
 */

/**
 * Context passed to the traceUrl function for generating clickable trace URLs
 */
export interface TraceUrlContext {
  /** Trace ID (32 hex chars) - may be undefined outside a trace */
  traceId?: string;
  /** Span ID (16 hex chars) - may be undefined outside a trace */
  spanId?: string;
  /** Correlation ID (always present, 16 hex chars) */
  correlationId: string;
  /** Service name from init config */
  serviceName: string;
  /** Environment from init config */
  environment?: string;
}

/**
 * Per-key transform options for baggage enrichment
 */
export type BaggageTransform = 'plain' | 'hash' | ((value: string) => string);

/**
 * Baggage enrichment configuration with guardrails
 */
export interface EnrichFromBaggageConfig {
  /**
   * Allowlist of baggage keys to include in events
   * Supports exact matches and patterns (e.g., 'tenant.*')
   */
  allow: string[];

  /**
   * Optional denylist of baggage keys to exclude
   * Takes precedence over allow list
   */
  deny?: string[];

  /**
   * Optional prefix to add to all enriched keys
   * @example 'ctx.' results in 'ctx.tenant.id'
   */
  prefix?: string;

  /**
   * Maximum number of keys to include (default: 10)
   * Prevents payload bloat from excessive baggage
   */
  maxKeys?: number;

  /**
   * Maximum total bytes for enriched values (default: 1024)
   * Prevents payload bloat from large baggage values
   */
  maxBytes?: number;

  /**
   * Per-key transform options
   * - 'plain': Include value as-is
   * - 'hash': Hash the value (for PII protection)
   * - function: Custom transform function
   *
   * @example
   * ```typescript
   * transform: {
   *   'user.id': 'hash',      // Hash user ID for privacy
   *   'tenant.id': 'plain',   // Include tenant ID as-is
   *   'session.id': (v) => v.slice(0, 8) // Custom truncation
   * }
   * ```
   */
  transform?: Record<string, BaggageTransform>;
}

/**
 * Events configuration for trace context and enrichment
 */
export interface EventsConfig {
  /**
   * Include trace context in events (default: false)
   *
   * When enabled, events automatically include:
   * - autotel.trace_id (32 hex chars)
   * - autotel.span_id (16 hex chars)
   * - autotel.trace_flags (2 hex chars)
   * - autotel.trace_state (raw tracestate string, if present)
   * - autotel.correlation_id (always present, 16 hex chars)
   *
   * Subscribers map these to platform-specific names:
   * - PostHog: $trace_id, $span_id
   * - Mixpanel: trace_id, span_id
   */
  includeTraceContext?: boolean;

  /**
   * Include full array of linked trace IDs for batch/fan-in scenarios (default: false)
   *
   * When false (default), batch/fan-in events include:
   * - autotel.linked_trace_id_count: Number of linked parents
   * - autotel.linked_trace_id_hash: Stable hash of sorted IDs (keeps payload lean)
   *
   * When true, events also include:
   * - autotel.linked_trace_ids: Full array of linked trace IDs
   */
  includeLinkedTraceIds?: boolean;

  /**
   * Generate clickable trace URL from context
   *
   * @param ctx - Trace context with traceId, spanId, correlationId, serviceName, environment
   * @returns URL string or undefined to skip
   *
   * @example Grafana Tempo
   * ```typescript
   * traceUrl: (ctx) => ctx.traceId
   *   ? `https://grafana.internal/explore?traceId=${ctx.traceId}`
   *   : undefined
   * ```
   *
   * @example Datadog
   * ```typescript
   * traceUrl: (ctx) => ctx.traceId
   *   ? `https://app.datadoghq.com/apm/traces?traceId=${ctx.traceId}`
   *   : undefined
   * ```
   *
   * @example Jaeger
   * ```typescript
   * traceUrl: (ctx) => ctx.traceId
   *   ? `https://jaeger.internal/trace/${ctx.traceId}`
   *   : undefined
   * ```
   */
  traceUrl?: (ctx: TraceUrlContext) => string | undefined;

  /**
   * Auto-enrich events from baggage with guardrails
   *
   * Automatically includes baggage entries in events without manual code.
   * Apply allow/deny lists and per-key transforms for PII protection.
   *
   * @example Basic allowlist
   * ```typescript
   * enrichFromBaggage: {
   *   allow: ['tenant.id', 'user.id', 'request.id']
   * }
   * // Events include: tenant.id, user.id, request.id from baggage
   * ```
   *
   * @example With prefix and transforms
   * ```typescript
   * enrichFromBaggage: {
   *   allow: ['tenant.id', 'user.id', 'user.email'],
   *   deny: ['user.ssn'],
   *   prefix: 'ctx.',
   *   transform: {
   *     'user.id': 'hash',
   *     'user.email': 'hash'
   *   }
   * }
   * // Events include: ctx.tenant.id, ctx.user.id (hashed), ctx.user.email (hashed)
   * ```
   */
  enrichFromBaggage?: EnrichFromBaggageConfig;
}

/**
 * Autotel context object attached to event envelopes
 *
 * This structured object is attached to events and subscribers
 * decide how to map/flatten for their platform.
 */
export interface AutotelEventContext {
  /** Trace ID (32 hex chars) - present when inside a trace */
  trace_id?: string;
  /** Span ID (16 hex chars) - present when inside a span */
  span_id?: string;
  /** Trace flags (2 hex chars, e.g., '01' for sampled) */
  trace_flags?: string;
  /** Raw tracestate string - present if tracestate exists */
  trace_state?: string;
  /** Clickable trace URL - present if traceUrl config is set */
  trace_url?: string;
  /** Correlation ID (always present, 16 hex chars) */
  correlation_id: string;
  /** Number of linked parent traces (batch/fan-in scenarios) */
  linked_trace_id_count?: number;
  /** Stable hash of linked trace IDs (default for batch/fan-in) */
  linked_trace_id_hash?: string;
  /** Full array of linked trace IDs (only if includeLinkedTraceIds: true) */
  linked_trace_ids?: string[];
}

/**
 * Hash a string value for PII protection
 *
 * Uses a simple, fast hash function suitable for correlation.
 * NOT cryptographically secure - use for PII masking, not security.
 */
export function hashValue(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Convert to positive hex string
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Create a stable hash of an array of trace IDs
 *
 * Sorts the array first to ensure deterministic output regardless of order.
 */
export function hashLinkedTraceIds(traceIds: string[]): string {
  const sorted = [...traceIds].sort();
  return hashValue(sorted.join(','));
}
