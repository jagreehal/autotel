// Same shape as a typical CommonJS Express API: loaded with `node --require`,
// Http + Express instrumentations, head sampling from the OTEL_* env vars.
const { init } = require('autotel');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const {
  ExpressInstrumentation,
} = require('@opentelemetry/instrumentation-express');

// Prints one line per span so smoke.mjs can compare trace ids with the
// browser's traceparent and read status and exceptions. In a real app this is your OTLP exporter.
const printServerSpans = {
  onStart() {},
  onEnd(span) {
    const ctx = span.spanContext();
    console.log(
      `server-span ${JSON.stringify({
        name: span.name,
        kind: span.kind,
        traceId: ctx.traceId,
        parentSpanId: span.parentSpanContext?.spanId,
        status: span.status.code,
        httpStatus: span.attributes['http.response.status_code'],
        sessionId: span.attributes['session.id'],
        route: span.attributes['http.route'],
        urlTemplate: span.attributes['url.template'],
        exceptions: span.events
          .filter((e) => e.name === 'exception')
          .map((e) => e.attributes['exception.message']),
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
  // Copy the browser's `session.id` onto every API span, and nothing else:
  // baggage in a request is written by the client, so an unfiltered copy
  // would let it set any attribute, `user.id` included.
  baggage: { keys: ['session.id'] },
});
