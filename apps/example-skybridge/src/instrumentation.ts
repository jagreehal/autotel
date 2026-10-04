import { init } from 'autotel';

// Turns off Skybridge's own usage telemetry wherever the app runs.
process.env.SKYBRIDGE_TELEMETRY_DISABLED ??= '1';

// Imported first by src/index.ts. Spans print to the terminal or Vercel's
// function logs; OTEL_EXPORTER_OTLP_ENDPOINT and _HEADERS add a backend.
init({
  service: 'example-skybridge',
  debug: 'pretty',
  // The JSON exporter ships in the bundle, and hosted OTLP gateways accept it.
  protocol: 'http',
  // Export each request's spans before Vercel freezes the function.
  forceFlushOnShutdown: process.env.VERCEL === '1',
});
