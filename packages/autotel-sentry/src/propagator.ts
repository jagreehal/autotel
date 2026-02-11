/**
 * SentryPropagator: injects and extracts sentry-trace and baggage headers
 * for trace propagation and dynamic sampling with Sentry.
 */

import {
  trace,
  propagation,
  type Context,
  type TextMapPropagator,
  type TextMapSetter,
  type TextMapGetter,
} from '@opentelemetry/api';

/** Context key for stored Sentry propagation data (sentry-trace, baggage). */
export const SENTRY_PROPAGATION_KEY = Symbol.for('autotel.sentry.propagation');

export interface SentryPropagationData {
  sentryTrace?: string;
  baggage?: string;
}

/** Sentry trace header format: traceid-spanid-sampled (sampled 1 or 0). */
const TRACE_FLAGS_SAMPLED = 0x1;

function getSpanContextFromContext(context: Context): { traceId: string; spanId: string; traceFlags: number } | null {
  const span = trace.getSpan(context);
  if (!span) return null;
  const ctx = span.spanContext();
  return { traceId: ctx.traceId, spanId: ctx.spanId, traceFlags: ctx.traceFlags };
}

function formatSentryTrace(traceId: string, spanId: string, traceFlags: number): string {
  const sampled = (traceFlags & TRACE_FLAGS_SAMPLED) === TRACE_FLAGS_SAMPLED ? '1' : '0';
  return `${traceId}-${spanId}-${sampled}`;
}

/** Serialize OTel baggage to header value (key=value; key2=value2). */
function serializeBaggage(context: Context): string | undefined {
  const baggage = propagation.getBaggage(context);
  if (!baggage) return undefined;
  const entries: string[] = [];
  const allEntries = baggage.getAllEntries();
  for (const [key, entry] of allEntries) {
    if (entry?.value !== undefined) {
      const encoded = encodeURIComponent(key) + '=' + encodeURIComponent(entry.value);
      entries.push(encoded);
    }
  }
  return entries.length > 0 ? entries.join('; ') : undefined;
}

export class SentryPropagator implements TextMapPropagator {
  inject(context: Context, carrier: unknown, setter: TextMapSetter): void {
    const spanCtx = getSpanContextFromContext(context);
    if (!spanCtx) return;

    const sentryTrace = formatSentryTrace(
      spanCtx.traceId,
      spanCtx.spanId,
      spanCtx.traceFlags,
    );
    setter.set(carrier, 'sentry-trace', sentryTrace);

    const baggageStr = serializeBaggage(context);
    if (baggageStr) {
      setter.set(carrier, 'baggage', baggageStr);
    }
  }

  extract(context: Context, carrier: unknown, getter: TextMapGetter): Context {
    const keys = getter.keys(carrier);
    let sentryTrace: string | undefined;
    let baggageStr: string | undefined;

    for (const key of keys) {
      const lower = key.toLowerCase();
      const value = getter.get(carrier, key);
      const str = Array.isArray(value) ? value[0] : value;
      if (lower === 'sentry-trace' && typeof str === 'string') sentryTrace = str;
      if (lower === 'baggage' && typeof str === 'string') baggageStr = str;
    }

    const data: SentryPropagationData = {};
    if (sentryTrace) data.sentryTrace = sentryTrace;
    if (baggageStr) data.baggage = baggageStr;

    if (Object.keys(data).length === 0) return context;

    return context.setValue(SENTRY_PROPAGATION_KEY, data);
  }

  fields(): string[] {
    return ['sentry-trace', 'baggage'];
  }
}
