/**
 * autotel-sentry: Convenience helpers for Sentry OTLP integration with Autotel.
 *
 * Usage:
 *   import { sentryOtlpConfig, linkSentryErrors } from 'autotel-sentry';
 *
 *   const config = sentryOtlpConfig(process.env.SENTRY_DSN!);
 *   Sentry.init({ dsn: config.dsn, skipOpenTelemetrySetup: true });
 *   init({ service: 'my-app', endpoint: config.endpoint, headers: config.headers });
 *   linkSentryErrors(Sentry);
 */
export { sentryOtlpConfig } from './config';
export { linkSentryErrors } from './link';
export type { SentryOtlpConfig, SentryLinkable } from './types';
