import { getTraceContext, otelTrace } from 'autotel';

export interface AuditContext {
  traceId: string;
  spanId: string;
  correlationId: string;
  setAttribute(key: string, value: string | number | boolean): void;
  setAttributes(
    attrs: Record<string, string | number | boolean | string[] | number[] | boolean[]>,
  ): void;
}

const MISSING_CONTEXT_MESSAGE =
  '[autotel-audit] No active trace context. Wrap the call in trace()/instrument(), pass options.ctx, ' +
  'or set options.onMissingContext to "warn"/"skip" to degrade gracefully instead of throwing.';

/**
 * Resolve an audit context without throwing. Returns `null` when no trace context
 * is available, so callers can degrade gracefully (best-effort instrumentation).
 */
const INVALID_TRACE_ID = '00000000000000000000000000000000';

export function resolveContextSafe(ctx?: AuditContext): AuditContext | null {
  if (ctx) return ctx;

  const span = otelTrace.getActiveSpan();
  if (!span) return null;

  // Resolve trace ids from autotel's context when available, otherwise from the
  // active OTel span itself, so audit works in any OTel setup — not only inside
  // autotel's own `trace()`.
  const ids = getTraceContext();
  const sc = span.spanContext();
  const traceId = ids?.traceId ?? sc.traceId;
  if (!traceId || traceId === INVALID_TRACE_ID) return null;

  return {
    traceId,
    spanId: ids?.spanId ?? sc.spanId,
    correlationId: ids?.correlationId ?? traceId.slice(0, 16),
    setAttribute: (key, value) => span.setAttribute(key, value),
    setAttributes: (attrs) => span.setAttributes(attrs),
  };
}

export function resolveContext(ctx?: AuditContext): AuditContext {
  const resolved = resolveContextSafe(ctx);
  if (resolved) return resolved;
  throw new Error(MISSING_CONTEXT_MESSAGE);
}

export { MISSING_CONTEXT_MESSAGE };

/**
 * How instrumentation should behave when no trace context is available.
 *
 * - `throw` — fail fast (original behaviour). Use when telemetry is mandatory.
 * - `warn` — run the wrapped handler un-audited and log one warning per action (default).
 * - `skip` — run the wrapped handler un-audited, silently.
 *
 * Telemetry is observability: a missing context should never crash the business
 * logic it wraps, so the default is best-effort (`warn`).
 */
export type OnMissingContext = 'throw' | 'warn' | 'skip';

/** A no-op {@link AuditContext} whose attribute setters do nothing. */
export function noopAuditContext(): AuditContext {
  return {
    traceId: '',
    spanId: '',
    correlationId: '',
    setAttribute() {},
    setAttributes() {},
  };
}

const warnedMissingContext = new Set<string>();
const warnedMissingLogger = new Set<string>();

/** Warn (once per action) that instrumentation is running without a trace context. */
export function warnMissingContextOnce(action: string): void {
  if (warnedMissingContext.has(action)) return;
  warnedMissingContext.add(action);
  console.warn(
    `[autotel-audit] No active trace context for "${action}" — running un-audited. ` +
      'Wrap the call in trace()/instrument() or pass options.ctx to capture telemetry. ' +
      '(set options.onMissingContext: "throw" to fail fast, or "skip" to silence this warning)',
  );
}

/** Warn (once per action) that attributes were recorded but no canonical log line emitted. */
export function warnMissingLoggerOnce(action: string): void {
  if (warnedMissingLogger.has(action)) return;
  warnedMissingLogger.add(action);
  console.warn(
    `[autotel-audit] No request logger for "${action}" — attributes were recorded on the span, ` +
      'but no canonical log line was emitted. Pass options.logger or run inside runWithRequestContext().',
  );
}

export function toAttributeValue(
  value: unknown,
): string | number | boolean | string[] | number[] | boolean[] | undefined {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry === 'string')) {
      return value;
    }

    if (value.every((entry) => typeof entry === 'number')) {
      return value;
    }

    if (value.every((entry) => typeof entry === 'boolean')) {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return '<serialization-failed>';
    }
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value === null || value === undefined) {
    return undefined;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return '<serialization-failed>';
  }
}
