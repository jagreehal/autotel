// Imported first by index.ts: init() must run before pino loads so the
// instrumentation can patch it.
import 'dotenv/config';
import { init } from 'autotel';

init({
  service: 'example-pino-service',
  debug: true,
  // Injects trace_id/span_id into every pino record and exports it via OTLP.
  autoInstrumentations: ['pino'],
  logs: true,
  endpoint:
    process.env.OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
