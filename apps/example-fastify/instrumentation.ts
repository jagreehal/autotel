/**
 * Autotel initialization for the Fastify example.
 *
 * Loaded before the app via: tsx --import ./instrumentation.ts src/index.ts
 * HTTP and Fastify instrumentation provide automatic server spans.
 */

import { init } from 'autotel';

init({
  service: 'example-fastify-service',
  debug: true,
  autoInstrumentations: ['http', 'fastify'],
  endpoint: process.env.OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
