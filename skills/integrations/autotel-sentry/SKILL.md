---
name: autotel-sentry
description: >
  Use this skill when sending autotel/OpenTelemetry traces to Sentry, or joining autotel-web's browser traces to the Sentry browser SDK. sentryOtlpConfig(dsn) turns a Sentry DSN into the OTLP endpoint and auth header autotel's init() needs (plus browserEndpoint for autotel-web). On the server, @sentry/node captures errors on the active span once Sentry.setOpenTelemetryContextAsyncContextStrategy() runs after Sentry.init(). In the browser, joinSentry(Sentry) from autotel-sentry/browser puts the autotel trace on every Sentry error and the Sentry user and replay on every span.
---

# autotel-sentry

Parses a Sentry DSN into the OTLP endpoint and auth headers autotel's `init()` expects, so autotel exports traces straight to Sentry's OTLP ingestion. The root entry is one function, `sentryOtlpConfig`; it calls no Sentry API and depends on no Sentry package. `autotel-sentry/browser` adds `joinSentry` for pages that run the Sentry browser SDK.

To put captured errors on the active trace, call `Sentry.setOpenTelemetryContextAsyncContextStrategy()` after `Sentry.init()`. `@sentry/node` then reads the active OpenTelemetry span when it builds an event, so each error carries that span's `trace_id` and `span_id`.

## Setup

```bash
pnpm add autotel autotel-sentry @sentry/node
```

```ts
import * as Sentry from '@sentry/node';
import { init } from 'autotel';
import { sentryOtlpConfig } from 'autotel-sentry';

const config = sentryOtlpConfig(process.env.SENTRY_DSN!);

// 1. Sentry captures errors; @sentry/node 11 leaves OpenTelemetry to autotel
// (on 8–10, add skipOpenTelemetrySetup: true)
Sentry.init({ dsn: config.dsn });
// Sentry reads trace ids from the active OpenTelemetry span
Sentry.setOpenTelemetryContextAsyncContextStrategy();

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
// config.browserEndpoint — the endpoint with ?sentry_key=, for autotel-web
```

Throws if the DSN is empty, has no public key, or has no project id. `new URL()` throws on a malformed DSN.

### Browser: autotel traces, Sentry errors (`joinSentry`)

Keep Sentry for errors and replays and let `autotel-web` trace:

```ts
import * as Sentry from '@sentry/browser'; // or @sentry/react, @sentry/nextjs
import { initFull } from 'autotel-web/full';
import { joinSentry, sentryOtlpConfig } from 'autotel-sentry/browser';

const sentry = sentryOtlpConfig(SENTRY_DSN);
Sentry.init({ dsn: sentry.dsn, integrations: [Sentry.replayIntegration()] });
initFull({
  service: 'web',
  endpoint: sentry.browserEndpoint, // Sentry's OTLP endpoint accepts browser requests
  spanEnrichers: [joinSentry(Sentry)],
});
```

- Every Sentry error carries the autotel trace (`contexts.trace`), including one captured after an `await` or from a failed request (it reads `hint.originalException`). A trace you pass in `captureException(error, { contexts: { trace } })` is kept.
- Spans get `user.id` from the Sentry scope and `sentry.replay_id` while replay records the session. `replayUrl` adds `session.replay.url` on failed spans; `traceUrl` links the issue to another backend.
- `joinSentry` reads the SDK structurally and imports no Sentry package.

### Letting the Sentry browser SDK trace instead

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

### HIGH: Letting `@sentry/node` 8–10 register its own OTel SDK

On 8–10, pass `skipOpenTelemetrySetup: true`, or Sentry's SDK registers a second OTel SDK beside autotel's (duplicate span processors). `@sentry/node` 11 leaves OpenTelemetry alone by default and has no `skipOpenTelemetrySetup` in its types, so leave the option out there.

### HIGH: Leaving out `Sentry.setOpenTelemetryContextAsyncContextStrategy()`

Without its own OTel setup, `@sentry/node` keeps its own scope trace ids, so a captured error starts a trace of its own. Call it once after `Sentry.init()`.

### HIGH: Using the old bridge API

`SentrySpanProcessor`, `createSentrySpanProcessor`, `SentryPropagator`, `SENTRY_PROPAGATION_KEY`, `linkSentryErrors` and `instrumenter: 'otel'` are gone. Delete them and use the setup above.

### MEDIUM: Also adding Sentry's `otlpIntegration`

`@sentry/node-core/light/otlp`'s `otlpIntegration` defaults to `setupOtlpTracesExporter: true` and appends its own exporter to the provider it finds. With autotel already exporting to Sentry, every span ships twice. Use one or the other; with autotel, use `sentryOtlpConfig`.

### HIGH: `browserTracingIntegration` beside autotel-web

Two tracers put two trace headers on each request, and `joinSentry` leaves an error on Sentry's own span whenever Sentry has one. With autotel-web tracing, leave Sentry's browser tracing out (`joinSentry` warns in development).

### MEDIUM: Browser `traceparent` overriding backend sampling

The header carries the frontend's sampling decision, and the default `parentbased_always_on` sampler honours it, so a tail sampler in your collector never sees unsampled traces. Set `OTEL_TRACES_SAMPLER=always_on` on the backend to take the decision back.

## Version

Targets autotel-sentry v0.8. The root entry has no dependencies; `autotel-sentry/browser` has `autotel-web` as an optional peer. Use with `autotel` and `@sentry/node`, or `autotel-web` and any `@sentry/*` browser SDK.
