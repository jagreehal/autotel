// Imported first by index.ts: init() must run before winston loads so the
// instrumentation can patch it.
import 'dotenv/config';
import { init } from 'autotel';

export const DEVTOOLS_PORT = 4318;

init({
  service: 'example-winston-service',
  debug: true,
  // Injects trace_id/span_id into every winston record and exports it via OTLP
  // (export needs @opentelemetry/winston-transport installed).
  autoInstrumentations: ['winston'],
  // OTLP log export is off by default
  logs: true,
  // Devtools receiver in-process; init() points the exporters at it and
  // shutdown() closes it.
  devtools: { embedded: true, port: DEVTOOLS_PORT, verbose: true },
});
