---
name: autotel-sentry
description: >
  Bridge that converts OpenTelemetry (Autotel) spans to Sentry transactions/spans and propagates sentry-trace/baggage headers, linking OTel traces to Sentry performance monitoring and error tracking.
type: integration
library: autotel-sentry
library_version: "0.5.4"
sources:
  - jagreehal/autotel:packages/autotel-sentry/CLAUDE.md
  - jagreehal/autotel:packages/autotel-sentry/src/processor.ts
  - jagreehal/autotel:packages/autotel-sentry/src/propagator.ts
---

# autotel-sentry

Bridges Autotel (OpenTelemetry) traces into Sentry for performance monitoring and error linking. Use it when your app initializes OTel via `autotel` but you also send data to Sentry and want spans, transactions, and exceptions to appear in both backends from a single instrumentation.

Two exports ship in this package:

- **`SentrySpanProcessor`** — converts OTel spans to Sentry transactions/child spans as they start and end.
- **`SentryPropagator`** — injects and extracts `sentry-trace` and `baggage` headers for distributed tracing and dynamic sampling.

## Setup

Sentry must be initialized **before** Autotel `init()`. The order matters: the processor is registered with Autotel and Sentry must be ready to receive spans when the first span starts.

```ts
import * as Sentry from '@sentry/node';
import { init } from 'autotel';
import { createSentrySpanProcessor, SentryPropagator } from 'autotel-sentry';

// 1. Init Sentry first
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
  instrumenter: 'otel', // REQUIRED — prevents Sentry from double-instrumenting
});

// 2. Then init Autotel with the Sentry processor
init({
  service: 'my-app',
  spanProcessors: [createSentrySpanProcessor(Sentry)],
});
```

## Configuration / Core Patterns

### `createSentrySpanProcessor(sentry)` — factory function

Preferred over constructing `new SentrySpanProcessor(sentry)` directly. Both are equivalent.

```ts
import { createSentrySpanProcessor } from 'autotel-sentry';

const processor = createSentrySpanProcessor(Sentry);
```

The processor accepts any object implementing the `SentryLike` interface (three methods: `getCurrentHub`, `addGlobalEventProcessor`, `captureException`). This keeps the package compatible across Sentry SDK versions without depending on internal types.

### Span lifecycle mapping

| OTel concept | Sentry concept |
|---|---|
| Root span (no OTel parent) | Sentry transaction |
| Child span | Sentry child span |
| OTel exception event on a span | `Sentry.captureException` call |
| Span status ERROR | Sentry span status error |

### Error context enrichment

The processor automatically calls `addGlobalEventProcessor` on Sentry so that any captured exception while an OTel span is active gets `trace_id` and `span_id` added to its context. This links Sentry errors to the correct trace in your OTel backend.

```ts
// No extra code needed — this happens automatically when SentrySpanProcessor is registered
throw new Error('payment failed'); // Sentry error will have OTel trace context attached
```

### `SentryPropagator` — header injection/extraction

Use when you need outgoing requests to carry `sentry-trace` and `baggage` headers so Sentry can stitch distributed traces and apply dynamic sampling:

```ts
import { init } from 'autotel';
import { SentryPropagator } from 'autotel-sentry';
import { CompositePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';

init({
  service: 'my-app',
  textMapPropagator: new CompositePropagator({
    propagators: [
      new W3CTraceContextPropagator(), // standard traceparent/tracestate
      new SentryPropagator(),          // adds sentry-trace + baggage
    ],
  }),
  spanProcessors: [createSentrySpanProcessor(Sentry)],
});
```

The propagator injects `sentry-trace` (format: `traceId-spanId-sampled`) and `baggage` on outgoing requests. On extraction, it stores the raw header values under `SENTRY_PROPAGATION_KEY` in the OTel context (available for Sentry's dynamic sampling).

```ts
import { SENTRY_PROPAGATION_KEY } from 'autotel-sentry';
// context.getValue(SENTRY_PROPAGATION_KEY) → { sentryTrace?, baggage? }
```

### Infinite loop prevention

The processor silently skips any span whose URL matches your Sentry DSN host. This prevents a loop where spans for Sentry ingestion requests themselves get sent to Sentry, which would generate more spans.

No configuration needed — it is automatic when `getCurrentHub().getClient().getDsn()` is available.

### Using `SentryLike` interface for testing / custom Sentry builds

```ts
import type { SentryLike } from 'autotel-sentry';

const mockSentry: SentryLike = {
  getCurrentHub: () => mockHub,
  addGlobalEventProcessor: (cb) => { /* noop */ },
  captureException: (err, opts) => { /* noop */ },
};

const processor = createSentrySpanProcessor(mockSentry);
```

## Common Mistakes

### HIGH: Initializing Autotel before Sentry

If `autotel.init()` runs first, spans may start before the processor has a valid Sentry hub, causing spans to be silently dropped or mapped to incorrect transactions.

Wrong:
```ts
init({ service: 'my-app', spanProcessors: [createSentrySpanProcessor(Sentry)] });
Sentry.init({ dsn: '...', instrumenter: 'otel' }); // too late
```

Correct:
```ts
Sentry.init({ dsn: '...', instrumenter: 'otel' });
init({ service: 'my-app', spanProcessors: [createSentrySpanProcessor(Sentry)] });
```

### HIGH: Omitting `instrumenter: 'otel'` in `Sentry.init()`

Without this flag, Sentry's own auto-instrumentation runs alongside OTel, causing duplicate transactions and spans for every operation.

Wrong:
```ts
Sentry.init({ dsn: '...', tracesSampleRate: 1.0 }); // missing instrumenter
```

Correct:
```ts
Sentry.init({ dsn: '...', tracesSampleRate: 1.0, instrumenter: 'otel' });
```

### MEDIUM: Not using `SentryPropagator` when downstream services check Sentry dynamic sampling

The `SentrySpanProcessor` handles span creation but does not inject `sentry-trace`/`baggage` headers into outgoing HTTP requests. Without `SentryPropagator` in the propagator chain, downstream services cannot participate in Sentry's dynamic sampling decisions.

Add `SentryPropagator` to the composite propagator if you need cross-service Sentry tracing:

```ts
textMapPropagator: new CompositePropagator({
  propagators: [new W3CTraceContextPropagator(), new SentryPropagator()],
}),
```

### MEDIUM: Passing the Sentry module namespace after tree-shaking

In some bundler setups (especially ESM with aggressive tree-shaking), `* as Sentry` may not include all methods that `SentryLike` requires. Verify `Sentry.getCurrentHub`, `Sentry.addGlobalEventProcessor`, and `Sentry.captureException` are present at runtime. If missing, import them explicitly and construct a `SentryLike` object manually.

## Version

Targets autotel-sentry v0.5.4. Peer dependency: `@sentry/node >=10.45.0`. See also: [Sentry OpenTelemetry integration spec](https://develop.sentry.dev/sdk/telemetry/traces/opentelemetry/).
