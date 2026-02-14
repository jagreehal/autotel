/**
 * Autotel initialization for the Effect example.
 *
 * Loaded before the app via: tsx --import ./instrumentation.ts src/index.ts
 * This registers the global OpenTelemetry TracerProvider so Effect's
 * Tracer.layerGlobal uses autotel for span export.
 */

import { init } from 'autotel';

init({
  service: 'example-effect',
  debug: true,
  endpoint: process.env.OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
