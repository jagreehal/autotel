# autotel-datadog

## 1.0.0

### Major Changes

- 039f92c: Adopt OpenTelemetry JS SDK 3 and add state transitions.

  **SDK 3:** upgrade to Node.js 22.15+ and `@opentelemetry/api` 1.10.

  - Import `@opentelemetry/sdk-trace` in place of `sdk-trace-base`, `sdk-trace-node` and `sdk-trace-web`, and `@opentelemetry/api` in place of `api-logs`.
  - Use `TracerProvider` for the Basic, Node and Web providers, and `trace.setGlobalTracerProvider()` for `register()`.
  - Pass processors an options object: `new BatchSpanProcessor({ exporter })`.
  - Rename `SdkLogRecord` to `ReadWriteLogRecord`. `SpanAttributeValue` in `autotel-subscribers` is now `unknown`.
  - Send to Jaeger over OTLP.
  - `init()` reads `OTEL_BSP_*`, `OTEL_SPAN_*` and `OTEL_ATTRIBUTE_*`.

  **State transitions:**

  - **autotel:** `transition()` counts `autotel.state.transitions` after a persisted write, whatever the sampling decision. `init()` warns when another tracer provider holds the global, and sets `deployment.environment` and `deployment.environment.name` to one value, taken from `environment`, then either key in `OTEL_RESOURCE_ATTRIBUTES` or `resourceAttributes`, then `NODE_ENV`.
  - **autotel-subscribers:** `ArchitectureSnapshotSubscriber` adds aggregated `transitions`.
  - **autotel-mongoose:** prototype `watchTransitions()` records transitions from a change stream.
  - **autotel-mcp:** `get_state_transitions` and `get_entity_history` read them. `getMetricSeries` takes `groupBy`, the collector keeps metric temporality and start times, and Loki attribute filters reach structured metadata.

  `autotel-aws/durable` has an install command in its README.

### Patch Changes

- Updated dependencies [039f92c]
  - autotel-web@3.0.0

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
