/**
 * Autotel initialization for the Fastify example.
 *
 * Loaded before the app via: tsx --import ./instrumentation.ts src/index.ts
 * HTTP instrumentation provides the per-request server spans. There is no
 * 'fastify' auto-instrumentation; add @fastify/otel for hook/handler spans.
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
  autoInstrumentations: ['http'],
  endpoint:
    process.env.AUTOTEL_DEVTOOLS === 'off'
      ? process.env.OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      : undefined,
});
