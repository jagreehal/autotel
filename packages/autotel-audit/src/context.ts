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

export function resolveContext(ctx?: AuditContext): AuditContext {
  if (ctx) return ctx;

  const ids = getTraceContext();
  const span = otelTrace.getActiveSpan();
  if (ids && span) {
    return {
      traceId: ids.traceId,
      spanId: ids.spanId,
      correlationId: ids.correlationId,
      setAttribute: (key, value) => span.setAttribute(key, value),
      setAttributes: (attrs) => span.setAttributes(attrs),
    };
  }

  throw new Error(
    '[autotel-audit] No active trace context. Wrap your handler with trace() or pass options.ctx.',
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
