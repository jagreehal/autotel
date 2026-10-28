# autotel-datadog

## 0.1.0

### Minor Changes

- 3acd402: Join autotel-web traces to the frontend SDKs a page already runs, in layers you choose.

  - **`autotel-web/join`** (new): `enrichSpans()` and `currentSpanContext()` are the building blocks for joining any SDK. A vendor's session becomes `session.id` on spans, baggage, logs and events, with one decision for sampling. An error from a failed request links to that request's trace. Joins compose: the first one owns `session.id` and the others record `<name>.session.id`.
  - **`autotel-web`**: `version` and `environment` options; `ignoreUrls`; other telemetry SDKs' uploads stay untraced; endpoints accept a query string.
  - **`autotel-sentry/browser`** (new): `joinSentry(Sentry)` puts the trace on every Sentry error and the user and replay on spans. `sentryOtlpConfig().browserEndpoint` exports from the browser straight to Sentry.
  - **`autotel-datadog`** (new): `joinDatadog(datadogRum)` puts the trace on RUM errors and the RUM session, user and replay link on spans.
  - **`autotel-backends/relay`** (new): `otlpRelay()` forwards a page's OTLP to any backend preset, with the API key added on the server.
  - **`autotel-posthog`**: rebuilt on `autotel-web/join`. `traceProperties(error)` links a failed request's exception to its trace. Diagnostics read `[autotel-web:posthog]`.
  - **Sentry 11**: docs, examples and `autotel-cli` use `@sentry/node` 11's defaults.
  - **`apps/example-datadog-react-express`** (new): React 19, react-router 7, TanStack Query and Express, with Datadog tracing as the base and RUM and PostHog as optional layers.

### Patch Changes

- Updated dependencies [3acd402]
  - autotel-web@2.5.0
