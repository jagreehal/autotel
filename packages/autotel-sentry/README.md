# autotel-sentry

Parses a Sentry DSN into the OTLP endpoint and auth headers that Autotel's `init()` expects, so autotel exports traces and logs straight to Sentry.

That is the whole package. Errors link to traces on their own: `@sentry/node` reads the active OpenTelemetry span when it builds an event, so a captured error already carries the right `trace_id` and `span_id`.

## Prerequisites

- Node.js 22+
- `autotel`
- `@sentry/node`, to capture the errors. This package calls no Sentry API and
  declares no dependency on it.

## Installation

```bash
pnpm add autotel autotel-sentry @sentry/node
```

## Quick start

```typescript
import * as Sentry from '@sentry/node';
import { init } from 'autotel';
import { sentryOtlpConfig } from 'autotel-sentry';

const config = sentryOtlpConfig(process.env.SENTRY_DSN!);

// 1. Initialize Sentry — tell it not to register its own OTel SDK
Sentry.init({ dsn: config.dsn, skipOpenTelemetrySetup: true });

// 2. Initialize Autotel — it owns OTel and exports traces to Sentry's OTLP endpoint
init({ service: 'my-app', endpoint: config.endpoint, headers: config.headers });
```

`skipOpenTelemetrySetup: true` is required because Sentry SDK v8+ registers its own OTel SDK internally. Autotel owns OTel setup; without this flag you get duplicate span processors and broken traces.

## API reference

### `sentryOtlpConfig(dsn: string): SentryOtlpConfig`

Parses a Sentry DSN and returns the three values needed to wire Autotel to Sentry's OTLP ingestion endpoint.

```typescript
const config = sentryOtlpConfig(
  'https://<key>@o<org>.ingest.sentry.io/<project>',
);
// config.dsn      — normalized DSN string (pass to Sentry.init)
// config.endpoint — OTLP base URL (pass to Autotel init as `endpoint`)
// config.headers  — auth headers (pass to Autotel init as `headers`)
```

Throws if the DSN is missing or cannot be parsed.

### Type: `SentryOtlpConfig`

```typescript
interface SentryOtlpConfig {
  dsn: string; // Normalized DSN for Sentry.init
  endpoint: string; // OTLP base endpoint (Autotel appends /v1/traces)
  headers: Record<string, string>; // Auth headers for OTLP requests
}
```

## Why not Sentry's own `otlpIntegration`

Sentry ships `otlpIntegration` in `@sentry/node-core/light/otlp` (since
10.47.0), which derives the OTLP endpoint from the DSN and sets up the exporter
itself. Reach for it when Sentry owns the export.

Use `sentryOtlpConfig` when autotel owns it, which is the normal autotel setup.
`otlpIntegration` defaults to `setupOtlpTracesExporter: true`, and that path
appends its own `BatchSpanProcessor` to whatever provider it finds. With autotel
already exporting to Sentry, every span ships twice.

## Linking a Sentry browser SDK to an autotel backend

A Sentry SDK in the browser or a mobile app generates its own trace ids and does
not send W3C `traceparent` by default, so your frontend and your autotel
backend end up in two unconnected traces. Turn on `propagateTraceparent`:

```typescript
Sentry.init({
  dsn: 'YOUR_DSN',
  // Browser tracing is what instruments fetch/XHR. Plain @sentry/browser does
  // not auto-enable it, and without it no header is attached, whatever
  // propagateTraceparent says. Framework SDKs (Next.js, Remix, SvelteKit)
  // enable it for you.
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 1.0,
  propagateTraceparent: true,
});
```

Outgoing requests then carry `traceparent`, and any autotel backend continues
that trace without further configuration. The option covers the browser
JavaScript SDKs and their framework guides, the mobile SDKs, and .NET. See
[Sentry with OTel](https://docs.sentry.io/concepts/otlp/sentry-with-otel/) for
the current list.

If autotel-web is also on the page, only one of them can own the header. Both
inject `traceparent` only when it is absent, so whichever is initialized last
wraps the other and wins. Initialize autotel-web last and Sentry's
`propagateTraceparent` changes nothing for `fetch`. XHR does not follow the
same rule, so set both `instrumentFetch: false` and `instrumentXHR: false` on
autotel-web rather than relying on initialization order, or `fetch` and XHR can
end up in different traces. See the [autotel-web README](../autotel-web/README.md#sentry).

The header carries the frontend's sampling decision, and a `parentbased_*`
sampler honours it. Since `parentbased_always_on` is the OpenTelemetry default,
your backend stops making its own decision and a tail-based sampler in your
collector never sees the spans it is meant to judge. Keep tail-based sampling
by taking the decision back:

```bash
OTEL_TRACES_SAMPLER=always_on
```

## What Sentry drops on ingest

Sentry's OTLP ingestion does not accept everything autotel emits:

- **Span events are dropped.** autotel emits them for feature-flag evaluations,
  workflow steps, webhooks, messaging and request-logger events. The spans and
  their attributes arrive; the events attached to them do not.
- **Span links and array attributes are ingested but not queryable.** Both show
  in the trace view, and neither can be searched, filtered or aggregated.

Check [Sentry's known limitations](https://docs.sentry.io/concepts/otlp/direct/traces/#known-limitations)
before you rely on a signal being there.

## Migration

**From `linkSentryErrors`.** Delete the call and its import. `@sentry/node`
reads the active OpenTelemetry span when it builds an event, so errors keep
landing on the right trace without it.

**From the SpanProcessor approach.** Earlier versions shipped a
`SentrySpanProcessor` / `SentryPropagator` bridge over deprecated Sentry Hub
APIs. Remove any reference to `createSentrySpanProcessor`,
`SentrySpanProcessor`, `SentryPropagator` and `instrumenter: 'otel'`, and use
the quick start above instead.

## References

- [Sentry OTLP Integration spec](https://develop.sentry.dev/sdk/telemetry/traces/otlp/): protocol this package targets
- [Sentry OTLP docs](https://docs.sentry.io/concepts/otlp/): Sentry-side OTLP configuration
- [Autotel](https://github.com/jagreehal/autotel): `init()` and `endpoint`/`headers` options
