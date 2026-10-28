// Imported first by index.ts: init() must run before pino loads so the
// instrumentation can patch it.
import 'dotenv/config';
import * as Sentry from '@sentry/node';
import { init } from 'autotel';
import { sentryOtlpConfig } from 'autotel-sentry';

// Build OTLP config from DSN: extracts endpoint and auth headers.
const config = sentryOtlpConfig(process.env.SENTRY_DSN!);

// Sentry handles errors only; Autotel owns the OTel setup.
Sentry.init({
  dsn: config.dsn,
});
// Sentry reads trace ids from the active OTel span, so captured errors join it.
Sentry.setOpenTelemetryContextAsyncContextStrategy();

// Autotel exports traces and logs to Sentry over OTLP.
init({
  service: 'example-sentry',
  endpoint: config.endpoint,
  headers: config.headers,
  // Adds trace_id/span_id to every pino record and exports it via OTLP.
  autoInstrumentations: ['pino'],
  logs: true,
  debug: !!process.env.AUTOTEL_DEBUG,
});
