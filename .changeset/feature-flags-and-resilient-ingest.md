---
'autotel': minor
'autotel-posthog': minor
'autotel-adapters': patch
'autotel-devtools': patch
'autotel-cli': patch
'autotel-sentry': patch
---

**autotel**

- `init()` registers the OpenFeature hook when `@openfeature/server-sdk` is installed and turns on log export for its `feature_flag.evaluation` events. `logs: false` keeps export off, `openFeature: false` skips the hook, and `openFeature: { includeValue: true }` passes options.
- `span()`, `withNewContext()`, `finalizeSpan()`, the decorators and the db helpers keep a status the code set on the span, and mark it OK when nothing chose one.
- `recordFeatureFlag({ key, value })` records onto the active span with no `ctx`. Passed a span, it emits every evaluation as a log record.
- Each evaluation emits a complete event. The span keeps its first evaluation, and `error.type` goes on the event, taken from OpenFeature's error code.
- `feature_flag.result.value` goes on when the flag has no variant and is opt-in beside one (`includeValue`). `feature_flag.set.id` and `feature_flag.version` come from the provider's `flagMetadata`.

**autotel-posthog**

- `posthogCompatibility({ featureFlags })` reads flags with `send_event: false`, so a span label never counts as an experiment exposure. A multivariate answer goes on as `feature_flag.result.variant`.

**autotel-adapters**

- `autotel-adapters/hono` reads the matched route through the app's own copy of Hono when the two differ, and warns once.

**autotel-devtools**

- `/v1/logs` and `/v1/traces` store an empty OTLP value as `null`. A log record, span or metric point that cannot be stored is set aside with a warning naming the reason, and the rest of its batch is kept. A trace whose root span is set aside shows as partial.

**autotel-cli**

- `autotel map` keeps each framework adapter in its own file. Output is unchanged.
- `collector --kind` accepts only the catalog's kinds, `query traces|spans --status-code` accepts `OK`, `ERROR` or `UNSET`, and `health --otlp-encoding` falls back to the backend default for an unknown encoding.
- The `score` error's `expected` field is flat: `{ operationName, serviceName, tags, hasError }`.
- The Sentry preset calls `Sentry.setOpenTelemetryContextAsyncContextStrategy()`, so captured errors join the active trace.

**autotel-sentry**

- The docs and setup call `Sentry.setOpenTelemetryContextAsyncContextStrategy()` after `Sentry.init()`, so captured errors carry the active span's trace and span ids. `example-sentry` sends pino logs to Sentry on the same trace.
