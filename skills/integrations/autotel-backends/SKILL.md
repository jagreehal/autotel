---
name: autotel-backends
description: >
  Use this skill when configuring autotel for a specific vendor backend — ready-made AutotelConfig presets for Honeycomb, Datadog, Google Cloud, Grafana Cloud, Pydantic Logfire, Langfuse, and PostHog with best-practice defaults baked in.
---

# autotel-backends

Drop-in configuration presets for popular observability backends. Each preset returns an `AutotelConfig` you pass directly to `autotel`'s `init()`. All vendor-specific concerns (endpoints, auth headers, protocol selection, log processors) are handled for you.

Available backends:

| Preset        | Subpath                         | Function                  |
| ------------- | ------------------------------- | ------------------------- |
| Honeycomb     | `autotel-backends/honeycomb`    | `createHoneycombConfig`   |
| Datadog       | `autotel-backends/datadog`      | `createDatadogConfig`     |
| Google Cloud  | `autotel-backends/google-cloud` | `createGoogleCloudConfig` |
| Grafana Cloud | `autotel-backends/grafana`      | `createGrafanaConfig`     |
| Logfire       | `autotel-backends/logfire`      | `createLogfireConfig`     |
| Langfuse      | `autotel-backends/langfuse`     | `createLangfuseConfig`    |
| PostHog       | `autotel-backends/posthog`      | `createPostHogConfig`     |

All are also exported from the root `autotel-backends`.

Endpoints in these presets (and in `init({ endpoint })`) are **base URLs**: autotel appends `/v1/traces`, `/v1/metrics`, `/v1/logs` itself.

## Setup

```bash
pnpm add autotel-backends autotel
```

Extra packages by preset:

- **Honeycomb** uses gRPC, so install `@opentelemetry/exporter-trace-otlp-grpc` (and `@opentelemetry/exporter-metrics-otlp-grpc` for metrics). They are optional peers of `autotel`, loaded lazily; a missing one fails at `init()`.
- **Logfire and PostHog** use OTLP/HTTP protobuf, so install `@opentelemetry/exporter-trace-otlp-proto` (plus `-metrics-otlp-proto` / `-logs-otlp-proto` if you export those signals). Also optional peers of `autotel`.
- **Google Cloud direct export** needs `google-auth-library` and `@opentelemetry/exporter-trace-otlp-http`, resolved from your project.
- **Datadog / Grafana log export** uses `@opentelemetry/sdk-logs` and `@opentelemetry/exporter-logs-otlp-http`, which are direct dependencies of `autotel-backends`.

All of these are loaded with `createRequire`, which bundlers (Vercel, Nitro, esbuild) do not follow: in a bundled app, add them as direct dependencies of the app.

## Configuration / Core Patterns

### Honeycomb

```typescript
import { init } from 'autotel';
import { createHoneycombConfig } from 'autotel-backends/honeycomb';

init(
  createHoneycombConfig({
    apiKey: process.env.HONEYCOMB_API_KEY!,
    service: 'my-app',
  }),
);
```

Uses gRPC to `api.honeycomb.io:443`. Sets `x-honeycomb-team` header automatically.

**All options:**

| Option        | Required | Default                       | Description                                                     |
| ------------- | -------- | ----------------------------- | --------------------------------------------------------------- |
| `apiKey`      | yes      | —                             | Team API key                                                    |
| `service`     | yes      | —                             | Service name (= dataset in modern accounts)                     |
| `dataset`     | no       | —                             | Classic Honeycomb dataset; sets `x-honeycomb-dataset` header    |
| `environment` | no       | `NODE_ENV \|\| 'development'` | Deployment environment (autotel default, same for every preset) |
| `version`     | no       | auto                          | Service version (autotel default, same for every preset)        |
| `endpoint`    | no       | `'api.honeycomb.io:443'`      | Override for custom regions or on-prem                          |
| `sampleRate`  | no       | —                             | Head-based sample rate; sets `x-honeycomb-samplerate` header    |

### Datadog

Two modes: **direct cloud ingestion** (API key required) and **local Datadog Agent** (no key needed).

**Direct cloud ingestion:**

```typescript
import { init } from 'autotel';
import { createDatadogConfig } from 'autotel-backends/datadog';

init(
  createDatadogConfig({
    apiKey: process.env.DATADOG_API_KEY!,
    service: 'my-app',
    environment: 'production',
    enableLogs: true,
  }),
);
```

**Local Datadog Agent (Kubernetes / long-running services):**

```typescript
init(
  createDatadogConfig({
    service: 'my-api',
    useAgent: true,
    agentHost: 'datadog-agent.default.svc.cluster.local',
  }),
);
```

**All options:**

| Option                | Required       | Default           | Description                                                                 |
| --------------------- | -------------- | ----------------- | --------------------------------------------------------------------------- |
| `apiKey`              | if `!useAgent` | —                 | Datadog API key                                                             |
| `service`             | yes            | —                 | Service name                                                                |
| `site`                | no             | `'datadoghq.com'` | Datadog site region (`datadoghq.eu`, `us3.datadoghq.com`, etc.)             |
| `environment`         | no             | autotel default   | Deployment environment                                                      |
| `version`             | no             | autotel default   | Service version                                                             |
| `enableLogs`          | no             | `false`           | Export OTel logs via OTLP; also sets `OTEL_EXPORTER_OTLP_LOGS_*` env vars   |
| `llmobs`              | no             | `true`            | Send `dd-otlp-source: llmobs` so `gen_ai.*` spans reach Agent Observability |
| `useAgent`            | no             | `false`           | Route telemetry to local Datadog Agent instead of direct cloud ingestion    |
| `agentHost`           | no             | `'localhost'`     | Agent hostname (when `useAgent: true`)                                      |
| `agentPort`           | no             | `4318`            | Agent OTLP HTTP port (when `useAgent: true`)                                |
| `logRecordProcessors` | no             | —                 | Override default log processor (direct mode with `enableLogs` only)         |

In `useAgent` mode, `enableLogs` only sets the `OTEL_EXPORTER_OTLP_LOGS_*` env vars (pointing at the Agent); it adds no log processor.

**GenAI spans reach Agent Observability by default.** Direct cloud ingestion
sends `dd-otlp-source: llmobs` alongside the API key, which is what maps
canonical OTel GenAI conventions — model, provider, token usage, cost, finish
reason — onto Datadog's Agent Observability schema. Traces are written to APM
as well, so a service that is not LLM-shaped loses nothing by sending it; pass
`llmobs: false` to send only the API key. In `useAgent` mode the Agent decides
the routing, so the option does not apply.

When `enableLogs: true`, the preset auto-sets `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`, `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL`, and `OTEL_EXPORTER_OTLP_LOGS_HEADERS` environment variables (only if not already set), enabling `pino-opentelemetry-transport` without extra configuration.

### Google Cloud

**Via OpenTelemetry Collector (recommended, no auth in app):**

```typescript
import { init } from 'autotel';
import { createGoogleCloudConfig } from 'autotel-backends/google-cloud';

init(
  createGoogleCloudConfig({
    projectId: process.env.GOOGLE_CLOUD_PROJECT!,
    service: 'my-app',
    useCollector: true,
    collectorEndpoint: 'http://localhost:4318',
  }),
);
```

**Direct export (requires `google-auth-library`):**

```bash
pnpm add google-auth-library
```

```typescript
init(
  createGoogleCloudConfig({
    projectId: process.env.GOOGLE_CLOUD_PROJECT!,
    service: 'my-app',
  }),
);
// Uses Application Default Credentials (ADC) automatically
```

**All options:**

| Option              | Required | Default                              | Description                                         |
| ------------------- | -------- | ------------------------------------ | --------------------------------------------------- |
| `projectId`         | yes      | —                                    | GCP project ID (also from `GOOGLE_CLOUD_PROJECT`)   |
| `service`           | yes      | —                                    | Service name                                        |
| `environment`       | no       | autotel default                      | Deployment environment                              |
| `version`           | no       | autotel default                      | Service version                                     |
| `useCollector`      | no       | `false`                              | Send to local Collector; Collector handles GCP auth |
| `collectorEndpoint` | no       | `'http://localhost:4318'`            | OTLP Collector address                              |
| `endpoint`          | no       | `'https://telemetry.googleapis.com'` | Override Telemetry API base URL                     |

### Grafana Cloud

```typescript
import { init } from 'autotel';
import { createGrafanaConfig } from 'autotel-backends/grafana';

init(
  createGrafanaConfig({
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT!,
    headers: process.env.OTEL_EXPORTER_OTLP_HEADERS,
    service: 'my-app',
    enableLogs: true,
  }),
);
```

Get `endpoint` and `headers` from: Grafana Cloud portal → your stack → Connections → OpenTelemetry → Configure.

**All options:**

| Option                | Required | Default         | Description                                                               |
| --------------------- | -------- | --------------- | ------------------------------------------------------------------------- |
| `endpoint`            | yes      | —               | OTLP gateway base URL; a trailing `/v1/traces\|metrics\|logs` is stripped |
| `headers`             | no       | —               | Auth headers; accepts `"Key=Value,Key2=Value2"` string or an object       |
| `service`             | yes      | —               | Service name                                                              |
| `environment`         | no       | autotel default | Deployment environment                                                    |
| `version`             | no       | autotel default | Service version                                                           |
| `enableLogs`          | no       | `true`          | Export logs to Grafana Loki via OTLP                                      |
| `logRecordProcessors` | no       | —               | Override default log processor (advanced)                                 |

Grafana preset also enables `metrics: true` by default. Logs go to `/v1/logs` on the same gateway.

### Pydantic Logfire

```typescript
import { init } from 'autotel';
import { createLogfireConfig } from 'autotel-backends/logfire';

init(
  createLogfireConfig({
    writeToken: process.env.LOGFIRE_WRITE_TOKEN!,
    service: 'my-app',
    region: 'eu', // required: 'us' | 'eu'
  }),
);
```

OTLP/HTTP protobuf to `https://logfire-<region>.pydantic.dev` with the bare token as `Authorization`. Options: `writeToken` (required, a **write** token, not a read token), `service` (required), `region` (required; a wrong region is a bare 401), `environment`, `version`, `endpoint` (self-hosted override, takes precedence over `region`).

### Langfuse

```typescript
import { init } from 'autotel';
import { createLangfuseConfig } from 'autotel-backends/langfuse';

init(
  createLangfuseConfig({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
    secretKey: process.env.LANGFUSE_SECRET_KEY!,
    service: 'my-app',
  }),
);
```

OTLP/HTTP to `<base>/api/public/otel` with Basic auth (`publicKey:secretKey`) and `x-langfuse-ingestion-version: 4`. Options: `publicKey`, `secretKey`, `service` (all required), `region` (`'eu'` default, or `'us'`), `environment`, `version`, `baseUrl` (self-hosted, without the OTLP path; takes precedence over `region`).

### PostHog

```typescript
import { init } from 'autotel';
import { createPostHogConfig } from 'autotel-backends/posthog';

init(
  createPostHogConfig({
    projectToken: process.env.POSTHOG_PROJECT_TOKEN!,
    service: 'my-app',
    region: 'eu',
  }),
);
```

OTLP/HTTP protobuf to `https://<region>.i.posthog.com/i` with `Authorization: Bearer <projectToken>`. Options: `projectToken` (required, `phc_...`), `service` (required), `region` (`'us'` default, or `'eu'`), `environment`, `version`, `host` (self-hosted, without the OTLP path). This is the telemetry path; product events go through `autotel-posthog/subscriber`.

## Common Mistakes

### LOW: Passing apiKey to Datadog with useAgent: true

```typescript
// Misleading: apiKey is silently ignored in Agent mode
init(
  createDatadogConfig({
    apiKey: process.env.DATADOG_API_KEY!,
    service: 'my-api',
    useAgent: true,
  }),
);
```

```typescript
// CORRECT: omit apiKey when using Agent — Agent handles authentication
init(
  createDatadogConfig({
    service: 'my-api',
    useAgent: true,
  }),
);
```

### HIGH: Calling init() without apiKey in direct Datadog mode

`createDatadogConfig` throws at call-time if `!useAgent && !apiKey`. This is a startup crash, not a runtime one.

```typescript
// WRONG: missing apiKey
init(createDatadogConfig({ service: 'my-app' }));
// throws: "Datadog API key is required..."
```

### HIGH: Trying Google Cloud direct export without google-auth-library installed

```typescript
// WRONG: throws at runtime if package is absent
init(createGoogleCloudConfig({ projectId: 'my-project', service: 'my-app' }));
// throws: "Direct export to Google Cloud requires google-auth-library..."
```

```typescript
// CORRECT: either `pnpm add google-auth-library @opentelemetry/exporter-trace-otlp-http`
// or let a Collector handle GCP auth:
init(
  createGoogleCloudConfig({
    projectId: 'my-project',
    service: 'my-app',
    useCollector: true,
  }),
);
```

### MEDIUM: Using wrong Honeycomb API key type

Modern Honeycomb environments use a team-level API key. Classic environments use dataset-specific keys. If traces are missing, verify key type in Honeycomb's account settings. The `dataset` option is only needed for classic accounts.

### MEDIUM: Setting OTEL*EXPORTER_OTLP_LOGS*\* env vars before calling createDatadogConfig with enableLogs

The Datadog preset respects existing env vars and skips overwriting them. If you set `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` manually to the wrong value before calling the preset, the preset's correct value is silently skipped.

```typescript
// RISKY: if this env var is already set incorrectly, the preset won't fix it
process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'http://wrong-host';
init(createDatadogConfig({ apiKey: key, service: 'app', enableLogs: true }));
```

Clear or unset conflicting env vars before calling the preset, or pass `logRecordProcessors` directly.

### MEDIUM: Putting a signal path on a plain init() endpoint

```typescript
// WRONG: autotel appends /v1/traces, so this posts to /v1/traces/v1/traces
init({
  service: 'my-app',
  endpoint: 'https://collector.example.com/v1/traces',
});
```

```typescript
// CORRECT: base URL only
init({ service: 'my-app', endpoint: 'https://collector.example.com' });
```

`createGrafanaConfig` is forgiving here: it strips a trailing `/v1/traces`, `/v1/metrics` or `/v1/logs` from `endpoint`, so pasting the full URL from the Grafana portal works. Plain `init({ endpoint })` does not strip it.

### HIGH: Honeycomb without the gRPC exporter installed

`createHoneycombConfig` sets `protocol: 'grpc'`. Without `@opentelemetry/exporter-trace-otlp-grpc` in the app, `init()` fails, which in serverless means the first traced request in production.

## Version

Targets autotel-backends v2.14.11. Direct deps: `autotel`, `@opentelemetry/exporter-logs-otlp-http` >=0.223.0, `@opentelemetry/sdk-logs` >=0.223.0. Optional peers: `@opentelemetry/exporter-trace-otlp-http` >=0.223.0, `@opentelemetry/exporter-metrics-otlp-http` >=0.223.0, `@opentelemetry/sdk-metrics` >=2.12.0, `google-auth-library` >=10.9.1. See also: `autotel` (core `init()`), `autotel-adapters` (HTTP framework adapters), `autotel-aws` (AWS instrumentation).
