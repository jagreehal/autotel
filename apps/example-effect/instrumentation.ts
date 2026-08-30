/**
 * Autotel initialization for the Effect example.
 *
 * Loaded before the app via: tsx --import ./instrumentation.ts src/index.ts
 * Registers the global OpenTelemetry TracerProvider. autotel-effect's layer()
 * reads that provider so Effect.withSpan spans export through autotel.
 */

import { init } from 'autotel';

init({
  service: 'example-effect',
  debug: true,
  endpoint:
    process.env.OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
