/**
 * Autotel initialization for the Fastify example.
 *
 * Loaded before the app via: tsx --import ./instrumentation.ts src/index.ts
 * HTTP and Fastify instrumentation provide automatic server spans.
 */

import { init } from 'autotel';

init({
  service: 'example-fastify-service',
  devtools:
    process.env.AUTOTEL_DEVTOOLS === 'embedded'
      ? { embedded: true }
      : process.env.AUTOTEL_DEVTOOLS === 'off'
        ? false
        : true,
  debug: 'pretty',
  autoInstrumentations: ['http', 'fastify'],
  endpoint:
    process.env.AUTOTEL_DEVTOOLS === 'off'
      ? process.env.OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      : undefined,
});
