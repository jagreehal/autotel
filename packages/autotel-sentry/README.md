# autotel-sentry

Bridge **OpenTelemetry (Autotel)** traces to **Sentry** so you can keep instrumenting with Autotel and send the same traces to Sentry for performance monitoring and error linking.

This package is for the **Sentry SDK + OpenTelemetry in the same service** scenario. For OTel-only backends (no Sentry SDK), see [Sentry OTLP](https://docs.sentry.io/concepts/otlp/).

This package implements Sentry's [OpenTelemetry traces integration](https://develop.sentry.dev/sdk/telemetry/traces/opentelemetry/) via a `SpanProcessor` and optional `SentryPropagator` for `sentry-trace` and `baggage` headers. The implementation follows that spec and may be updated if Sentry changes it.

## Prerequisites

- **Sentry must be initialized before** the OpenTelemetry SDK (and before `init()` from Autotel).
- Set **`instrumenter: 'otel'`** in `Sentry.init()` so Sentry does not double-instrument. All span/transaction creation is driven by OpenTelemetry; Sentry only consumes them.
- For linking errors to the active trace, the Sentry SDK should expose `addGlobalEventProcessor`. If it does not (e.g. some SDK versions), the processor still sends spans/transactions; error events may not get trace context attached.

## Installation

```bash
pnpm add autotel autotel-sentry @sentry/node
```

## Minimal setup

1. Initialize Sentry first (with `instrumenter: 'otel'`).
2. Call Autotel `init()` and pass `SentrySpanProcessor` in `spanProcessors`.

```typescript
import * as Sentry from '@sentry/node';
import { init } from 'autotel';
import { createSentrySpanProcessor } from 'autotel-sentry';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
  instrumenter: 'otel',
});

init({
  service: 'my-app',
  spanProcessors: [createSentrySpanProcessor(Sentry)],
});
```

Errors captured by Sentry will be linked to the active OpenTelemetry span (trace/span IDs). Spans created by Autotel (e.g. via `autotel-hono`, `autotel-plugins/drizzle`) are sent to Sentry as transactions and child spans. Spans for requests to Sentry's ingestion endpoint are not sent to Sentry.

## Optional: sentry-trace and baggage propagation

For cross-service trace continuity and dynamic sampling, register the **SentryPropagator** so `sentry-trace` and `baggage` headers are injected and extracted. Combine it with your existing propagators (e.g. W3C Trace Context and Baggage) using a composite propagator from your OpenTelemetry setup so that outbound requests carry Sentry headers and incoming requests restore them into context.

### Example: Using SentryPropagator with Composite Propagator

```typescript
import * as Sentry from '@sentry/node';
import { init } from 'autotel';
import { createSentrySpanProcessor, SentryPropagator } from 'autotel-sentry';
import { CompositePropagator } from '@opentelemetry/core';
import { W3CTraceContextPropagator, W3CBaggagePropagator } from '@opentelemetry/core';

// 1. Initialize Sentry first
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
  instrumenter: 'otel',
});

// 2. Initialize Autotel with Sentry processor AND propagator
init({
  service: 'my-app',
  spanProcessors: [createSentrySpanProcessor(Sentry)],

  // Register SentryPropagator alongside W3C propagators
  propagator: new CompositePropagator({
    propagators: [
      new W3CTraceContextPropagator(),  // traceparent header
      new W3CBaggagePropagator(),       // W3C baggage header
      new SentryPropagator(),           // sentry-trace + baggage headers
    ],
  }),
});
```

**What this does:**

- **Outbound requests** (fetch, http.request, etc.) get `traceparent`, `baggage`, and `sentry-trace` headers injected automatically
- **Incoming requests** restore trace context from all three header types
- Sentry's dynamic sampling decisions propagate across services via `baggage` header
- Full distributed tracing works across services using different backends (OTel collector + Sentry)

**When to use:**

- Multi-service architecture where some services send to Sentry, others to OTel collectors
- You want Sentry's dynamic sampling to work across service boundaries
- You need both W3C Trace Context (for OTel) and Sentry-specific headers

## API

- **`createSentrySpanProcessor(sentry)`** – Returns a `SentrySpanProcessor` instance. Pass the `@sentry/node` module (or any object implementing the minimal hub/transaction/span interface).
- **`SentrySpanProcessor`** – Class implementing OpenTelemetry's `SpanProcessor`. Converts OTel spans to Sentry transactions/spans and turns OTel exception events into Sentry errors.
- **`SentryPropagator`** – Class implementing OpenTelemetry's `TextMapPropagator` for `sentry-trace` and `baggage` headers.
- **`SENTRY_PROPAGATION_KEY`** – Context key under which extracted Sentry propagation data is stored (for advanced use).

## References

- [Sentry: OpenTelemetry traces](https://develop.sentry.dev/sdk/telemetry/traces/opentelemetry/) – spec this implementation follows
- [Sentry OTLP](https://docs.sentry.io/concepts/otlp/) – when to use OTLP direct vs SDK + OTel
- [Autotel init](https://github.com/jagreehal/autotel) – `spanProcessors` and configuration
