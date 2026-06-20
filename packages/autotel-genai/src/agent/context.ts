import { getTraceContext, otelTrace } from 'autotel';

export interface AgentContext {
  traceId: string;
  spanId: string;
  correlationId: string;
  setAttribute(key: string, value: string | number | boolean): void;
  setAttributes(
    attrs: Record<string, string | number | boolean | string[] | number[] | boolean[]>,
  ): void;
}

export const MISSING_CONTEXT_MESSAGE =
  '[autotel-genai] No active trace context. Wrap the call in trace()/instrument(), pass options.ctx, ' +
  'or set options.onMissingContext to "warn"/"skip" to degrade gracefully instead of throwing.';

/**
 * Resolve an agent context without throwing. Returns `null` when no trace context
 * is available, so callers can degrade gracefully (best-effort instrumentation).
 */
const INVALID_TRACE_ID = '00000000000000000000000000000000';

export function resolveContextSafe(ctx?: AgentContext): AgentContext | null {
  if (ctx) return ctx;

  const span = otelTrace.getActiveSpan();
  if (!span) return null;

  // Resolve trace ids from autotel's context when available, otherwise from the
  // active OTel span itself. This makes agent audit work in *any* OTel setup —
  // @effect/opentelemetry, a vanilla NodeSDK, autotel-cloudflare's instrumented
  // fetch handler — not just inside autotel's own `trace()`.
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

export function resolveContext(ctx?: AgentContext): AgentContext {
  const resolved = resolveContextSafe(ctx);
  if (resolved) return resolved;
  throw new Error(MISSING_CONTEXT_MESSAGE);
}

const warnedMissingContext = new Set<string>();

/** Warn (once per action) that an agent action is running without a trace context. */
export function warnMissingContextOnce(action: string): void {
  if (warnedMissingContext.has(action)) return;
  warnedMissingContext.add(action);
  console.warn(
    `[autotel-genai] No active trace context for "${action}" — running un-audited. ` +
      'Wrap the call in trace()/instrument() or pass options.ctx to capture agent audit telemetry. ' +
      '(set options.onMissingContext: "throw" to fail fast, or "skip" to silence this warning)',
  );
}

/** A no-op {@link AgentContext} whose attribute setters do nothing. */
export function noopAgentContext(): AgentContext {
  return {
    traceId: '',
    spanId: '',
    correlationId: '',
    setAttribute() {},
    setAttributes() {},
  };
}

/** Adapt an OpenTelemetry span (or span-like object) to {@link AgentContext}. */
export function agentContextFromSpan(span: {
  spanContext(): { traceId: string; spanId: string };
  setAttribute(key: string, value: string | number | boolean): void;
  setAttributes(
    attrs: Record<string, string | number | boolean | string[] | number[] | boolean[]>,
  ): void;
}): AgentContext {
  const sc = span.spanContext();
  return {
    traceId: sc.traceId,
    spanId: sc.spanId,
    correlationId: sc.traceId.slice(0, 16),
    setAttribute: (key, value) => span.setAttribute(key, value),
    setAttributes: (attrs) => span.setAttributes(attrs),
  };
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

  if (typeof value === 'bigint') {
    return value.toString(10);
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
