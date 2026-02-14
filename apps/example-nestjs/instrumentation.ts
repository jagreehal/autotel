/**
 * Autotel initialization for the NestJS example.
 *
 * Loaded before the app via: tsx --import ./instrumentation.ts src/main.ts
 * HTTP and NestJS instrumentation provide automatic server spans.
 */

import { init } from 'autotel';

init({
  service: 'example-nestjs-service',
  debug: true,
  autoInstrumentations: ['http', 'nestjs-core'],
  endpoint: process.env.OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
