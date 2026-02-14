/**
 * Autotel initialization for the Hono example.
 *
 * Loaded before the app via: tsx --import ./instrumentation.ts src/index.ts
 * HTTP tracing is handled by autotel-hono's otel() middleware.
 */

import { init } from 'autotel';

init({
  service: 'example-hono-service',
  debug: true,
  endpoint: process.env.OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
