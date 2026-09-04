/**
 * autotel-sentry: build Sentry's OTLP endpoint and auth headers from a DSN.
 *
 * Usage:
 *   import { sentryOtlpConfig } from 'autotel-sentry';
 *
 *   const config = sentryOtlpConfig(process.env.SENTRY_DSN!);
 *   Sentry.init({ dsn: config.dsn, skipOpenTelemetrySetup: true });
 *   init({ service: 'my-app', endpoint: config.endpoint, headers: config.headers });
 *
 * Sentry links captured errors to the active OpenTelemetry span by itself, so
 * there is nothing here for that.
 */
export { sentryOtlpConfig } from './config';
export type { SentryOtlpConfig } from './types';
