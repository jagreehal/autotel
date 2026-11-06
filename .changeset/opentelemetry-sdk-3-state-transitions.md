---
'autotel': major
'autotel-aws': major
'autotel-backends': major
'autotel-bedrock': major
'autotel-cli': major
'autotel-cloudflare': major
'autotel-datadog': major
'autotel-drizzle': major
'autotel-edge': major
'autotel-effect': major
'autotel-kafka': major
'autotel-langfuse': major
'autotel-mcp': major
'autotel-mcp-instrumentation': major
'autotel-mongoose': major
'autotel-plugins': major
'autotel-posthog': major
'autotel-sentry': major
'autotel-subscribers': major
'autotel-tanstack': major
'autotel-terminal': major
'autotel-web': major
'autotel-audit': patch
'autotel-devtools': patch
'autotel-genai': patch
'autotel-mongodb': patch
'autotel-playwright': patch
'autotel-skybridge': patch
'autotel-vitest': patch
---

Adopt OpenTelemetry JS SDK 3 and add state transitions.

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
