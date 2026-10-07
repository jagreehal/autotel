// Imported first by index.ts: init() must run before bunyan loads so the
// instrumentation can patch it.
import 'dotenv/config';
import { init } from 'autotel';

init({
  service: 'example-bunyan-service',
  debug: true,
  // Injects trace_id/span_id into every bunyan record and exports it via OTLP.
  autoInstrumentations: ['bunyan'],
  // OTLP endpoint for Grafana (set via OTLP_ENDPOINT env var)
  endpoint: process.env.OTLP_ENDPOINT || 'http://localhost:4318',
  // OTLP log export is off by default
  logs: true,
});
