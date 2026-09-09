/**
 * Autotel initialization for the Effect example.
 *
 * Loaded before the app via: tsx --import ./instrumentation.ts src/index.ts
 * Registers the global OpenTelemetry TracerProvider. autotel-effect's layer()
 * reads that provider so Effect.withSpan spans export through autotel.
 */

import { init } from 'autotel';

import { collected } from './src/collected-spans.js';

init({
  service: 'example-effect',
  // Collected so the app can print the trace shape when it finishes. Add an
  // OTLP endpoint and the same spans go to your backend as well.
  spanExporters: [collected],
  endpoint:
    process.env.OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
