/** OTLP configuration returned by sentryOtlpConfig(). */
export interface SentryOtlpConfig {
  /** The normalized DSN string (for Sentry.init). */
  dsn: string;
  /** OTLP base endpoint (autotel appends /v1/traces). */
  endpoint: string;
  /** Auth headers for OTLP requests. */
  headers: Record<string, string>;
}
