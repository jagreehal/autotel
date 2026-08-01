---
'autotel': minor
'autotel-backends': minor
---

Support OTLP protobuf, and send to PostHog.

**`protocol: 'http/protobuf'`** is now a first-class option alongside `'http'`
and `'grpc'`. Until now autotel could only send OTLP/HTTP with a **JSON** body,
because `protocol: 'http'` resolves to
`@opentelemetry/exporter-trace-otlp-http`, which serializes JSON. Several
vendors — Pydantic Logfire and PostHog among them — accept protobuf only and
drop a JSON body without an error, so telemetry silently went nowhere.

The protobuf exporters are optional peer dependencies, loaded on demand like the
gRPC ones, so nothing is added to the default install:

```bash
pnpm add @opentelemetry/exporter-trace-otlp-proto
```

`OTEL_EXPORTER_OTLP_PROTOCOL` now follows the spec: `http/protobuf` selects
protobuf rather than being treated as a synonym for `http`, `http/json` and
`http` both select JSON, and `grpc` is unchanged. **If you already set
`OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`, you were getting JSON and will now
get protobuf** — which is what you asked for, but it means installing
`@opentelemetry/exporter-trace-otlp-proto` or your exporter will fail loudly at
startup rather than quietly sending the wrong encoding.

**`createLogfireConfig` is fixed** — it previously emitted `protocol: 'http'`,
so traces were serialized as JSON and Logfire discarded them. It now uses
`http/protobuf`. Anyone who adopted the preset should upgrade; the old behaviour
delivered nothing.

**`createPostHogConfig`** is new. PostHog ingests OTLP traces, logs and metrics,
so product analytics and distributed traces can share a destination:

```typescript
import { createPostHogConfig } from 'autotel-backends/posthog';

init(
  createPostHogConfig({
    projectToken: process.env.POSTHOG_PROJECT_TOKEN!,
    service: 'my-app',
    region: 'eu', // or 'us'
  }),
);
```

It handles the `/i` path prefix PostHog's OTLP receiver lives under, so signals
land on `/i/v1/traces`, `/i/v1/logs` and `/i/v1/metrics`. This is the telemetry
path; `autotel-subscribers/posthog` remains the separate route for product
events.

`createLangfuseConfig` is unaffected — Langfuse accepts both JSON and protobuf.
