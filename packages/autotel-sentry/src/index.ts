/**
 * autotel-sentry: build Sentry's OTLP endpoint and auth headers from a DSN.
 *
 * Usage:
 *   import { sentryOtlpConfig } from 'autotel-sentry';
 *
 *   const config = sentryOtlpConfig(process.env.SENTRY_DSN!);
 *   Sentry.init({ dsn: config.dsn, skipOpenTelemetrySetup: true });
 *   Sentry.setOpenTelemetryContextAsyncContextStrategy();
 *   init({ service: 'my-app', endpoint: config.endpoint, headers: config.headers });
 *
 * `Sentry.setOpenTelemetryContextAsyncContextStrategy()` makes Sentry read trace ids
 * from the active OpenTelemetry span, so captured errors join the trace.
 */
export { sentryOtlpConfig } from './config';
export type { SentryOtlpConfig } from './types';
