/** OTLP configuration returned by sentryOtlpConfig(). */
export interface SentryOtlpConfig {
  /** The normalized DSN string (for Sentry.init). */
  dsn: string;
  /** OTLP base endpoint (autotel appends /v1/traces). */
  endpoint: string;
  /** Auth headers for OTLP requests. */
  headers: Record<string, string>;
}

/** The trace context Sentry carries on an event, and that autotel fills in. */
export interface SentryTraceContext {
  trace_id: string;
  span_id: string;
}

/**
 * The slice of a Sentry event this package reads and writes. A real event
 * carries much more; everything else passes through untouched, which is why
 * nothing else is named here.
 */
export interface SentryEvent {
  message?: string;
  contexts?: {
    trace?: SentryTraceContext;
  };
}

/** Minimal Sentry SDK interface needed by linkSentryErrors(). */
export interface SentryLinkable {
  getGlobalScope(): {
    addEventProcessor(fn: (event: SentryEvent) => SentryEvent): void;
  };
}
