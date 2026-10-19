---
name: autotel-sentry
description: >
  Use this skill when sending autotel/OpenTelemetry traces to Sentry — sentryOtlpConfig(dsn) turns a Sentry DSN into the OTLP endpoint and auth header autotel's init() needs, while @sentry/node keeps capturing errors linked to the active span.
---

# autotel-sentry

Parses a Sentry DSN into the OTLP endpoint and auth headers autotel's `init()` expects, so autotel exports traces straight to Sentry's OTLP ingestion. That is the whole package: one function, `sentryOtlpConfig`, and its return type `SentryOtlpConfig`. It calls no Sentry API and has no dependency on `@sentry/node`.

Errors link to traces on their own: `@sentry/node` reads the active OpenTelemetry span when it builds an event, so a captured error already carries the right `trace_id` and `span_id`.

## Setup

```bash
pnpm add autotel autotel-sentry @sentry/node
```

```ts
import * as Sentry from '@sentry/node';
import { init } from 'autotel';
import { sentryOtlpConfig } from 'autotel-sentry';

const config = sentryOtlpConfig(process.env.SENTRY_DSN!);

// 1. Sentry captures errors; it must not register its own OTel SDK
Sentry.init({ dsn: config.dsn, skipOpenTelemetrySetup: true });

// 2. autotel owns OTel and exports to Sentry's OTLP endpoint
init({ service: 'my-app', endpoint: config.endpoint, headers: config.headers });
```

## Core Patterns

### `sentryOtlpConfig(dsn: string): SentryOtlpConfig`

```ts
const config = sentryOtlpConfig(
  'https://<key>@o<org>.ingest.sentry.io/<project>',
);
// config.dsn      — trimmed DSN (a leading "dsn=" is stripped), for Sentry.init
// config.endpoint — `${origin}/api/<project>/integration/otlp`; autotel appends /v1/traces
// config.headers  — { 'x-sentry-auth': 'sentry sentry_key=<key>' }
```

Throws if the DSN is empty, has no public key, or has no project id. `new URL()` throws on a malformed DSN.

### Linking a Sentry browser SDK to an autotel backend

The Sentry browser/mobile SDKs do not send W3C `traceparent` by default, so frontend and backend end up in separate traces. Turn it on:

```ts
Sentry.init({
  dsn: 'YOUR_DSN',
  integrations: [Sentry.browserTracingIntegration()], // required to instrument fetch/XHR
  tracesSampleRate: 1.0,
  propagateTraceparent: true,
});
```

The autotel backend continues that trace with no extra config. If autotel-web is also on the page, only one should own the header: set `instrumentFetch: false` and `instrumentXHR: false` on autotel-web rather than relying on init order.

### What Sentry drops on ingest

- Span events are dropped (feature-flag evaluations, workflow steps, request-logger events). Spans and their attributes arrive.
- Span links and array attributes are ingested but not queryable.

## Common Mistakes

### HIGH: Omitting `skipOpenTelemetrySetup: true`

Sentry SDK v8+ registers its own OTel SDK. Alongside autotel that means duplicate span processors and broken traces.

```ts
// Wrong
Sentry.init({ dsn: config.dsn });

// Correct
Sentry.init({ dsn: config.dsn, skipOpenTelemetrySetup: true });
```

### HIGH: Using the old bridge API

`SentrySpanProcessor`, `createSentrySpanProcessor`, `SentryPropagator`, `SENTRY_PROPAGATION_KEY`, `SentryLike`, `linkSentryErrors` and `instrumenter: 'otel'` no longer exist. Delete them and use the setup above.

### MEDIUM: Also adding Sentry's `otlpIntegration`

`@sentry/node-core/light/otlp`'s `otlpIntegration` defaults to `setupOtlpTracesExporter: true` and appends its own exporter to the provider it finds. With autotel already exporting to Sentry, every span ships twice. Use one or the other; with autotel, use `sentryOtlpConfig`.

### MEDIUM: Browser `traceparent` overriding backend sampling

The header carries the frontend's sampling decision, and the default `parentbased_always_on` sampler honours it, so a tail sampler in your collector never sees unsampled traces. Set `OTEL_TRACES_SAMPLER=always_on` on the backend to take the decision back.

## Version

Targets autotel-sentry v0.7.2. No peer dependencies; use with `autotel` and `@sentry/node`.
