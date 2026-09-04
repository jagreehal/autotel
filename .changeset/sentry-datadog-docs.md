---
'autotel-sentry': minor
'autotel-web': patch
'autotel-cli': patch
---

Sharpen the Sentry and Datadog integrations.

**autotel-sentry** is now a single function. `sentryOtlpConfig(dsn)` parses a
DSN into `{ dsn, endpoint, headers }`, which is everything `init()` needs to
export to Sentry. The package ships no runtime dependencies and calls no Sentry
API.

`linkSentryErrors()` is removed, along with the `SentryLinkable`, `SentryEvent`
and `SentryTraceContext` types. `@sentry/node` bundles `@sentry/opentelemetry`
and reads the active OpenTelemetry span when it builds an event, so captured
errors carry the right `trace_id` and `span_id` on their own.

**Migration:** delete the `linkSentryErrors(Sentry)` call and its import.
Nothing replaces it. The `autotel-cli` Sentry preset no longer scaffolds it.

**autotel-web** header injection now covers three more cases: headers carried on
a `Request` object survive `fetch(new Request(url, { headers }))`; XHR injection
happens in `send()`, leaving an application's `onreadystatechange` untouched;
and a reused `XMLHttpRequest` instance gets a fresh `traceparent` on every
request, while any header the caller sets is kept as-is. Covered by tests
against a real `XMLHttpRequest` under jsdom and a real HTTP server.

**Docs.** The Datadog guides now cover reading telemetry back: querying through
`autotel-mcp` needs `DD_APP_KEY` alongside `DD_API_KEY`, with the `apm_read`
scope. The Sentry guides cover linking a Sentry browser or mobile SDK to an
OpenTelemetry backend with `propagateTraceparent` and
`browserTracingIntegration()`, which of autotel-web and Sentry owns the
`traceparent` header, and what Sentry's OTLP ingestion accepts.
