import { trace } from '@opentelemetry/api';
import type { SentryLinkable } from './types';

/**
 * Install a global Sentry event processor that attaches the active
 * OpenTelemetry trace_id and span_id to every Sentry event.
 *
 * This is the "external propagation context" from the Sentry OTLP Integration
 * spec — it ensures errors, check-ins, and logs are linked to the correct
 * OTel trace without requiring a SpanProcessor bridge.
 *
 * Call once after Sentry.init() and autotel init().
 */
export function linkSentryErrors(sentry: SentryLinkable): void {
  sentry.getGlobalScope().addEventProcessor((event) => {
    const otelSpan = trace.getActiveSpan();
    if (!otelSpan) return event;

    const contexts = (event.contexts ?? {}) as Record<string, unknown>;

    // Don't overwrite trace context that's already set
    if (contexts.trace) return event;

    const ctx = otelSpan.spanContext();
    return {
      ...event,
      contexts: {
        ...contexts,
        trace: {
          trace_id: ctx.traceId,
          span_id: ctx.spanId,
        },
      },
    };
  });
}
