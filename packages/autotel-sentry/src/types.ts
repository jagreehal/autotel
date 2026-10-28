/** OTLP configuration returned by sentryOtlpConfig(). */
export interface SentryOtlpConfig {
  /** The normalized DSN string (for Sentry.init). */
  dsn: string;
  /** OTLP base endpoint (autotel appends /v1/traces). */
  endpoint: string;
  /** Auth headers for OTLP requests. */
  headers: Record<string, string>;
  /**
   * The endpoint for a browser: the same, with the DSN's public key as
   * `?sentry_key=`. The browser exporter sends no custom headers, and the
   * unload beacon cannot carry any, so the key rides in the URL. It is the
   * DSN's public key, already in every page that runs the Sentry SDK.
   */
  browserEndpoint: string;
}
