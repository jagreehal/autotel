// Same shape as a typical CommonJS Express API: loaded with `node --require`,
// Http + Express instrumentations, head sampling from the OTEL_* env vars.
const { init } = require('autotel');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const {
  ExpressInstrumentation,
} = require('@opentelemetry/instrumentation-express');

// Prints one line per server span so smoke.mjs can compare trace ids with the
// browser's traceparent. In a real app this is your OTLP exporter.
const printServerSpans = {
  onStart() {},
  onEnd(span) {
    if (span.kind !== 1) return; // SERVER
    const ctx = span.spanContext();
    console.log(
      `server-span ${JSON.stringify({
        name: span.name,
        traceId: ctx.traceId,
        parentSpanId: span.parentSpanContext?.spanId,
      })}`,
    );
  },
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};

init({
  service: 'example-web-react-express-api',
  instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation()],
  spanProcessors: [printServerSpans],
});
