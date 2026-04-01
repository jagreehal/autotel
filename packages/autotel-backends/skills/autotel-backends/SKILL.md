---
name: autotel-backends
description: >
  Vendor preset configs for autotel that produce a ready-to-use AutotelConfig for Honeycomb, Datadog, Google Cloud, and Grafana Cloud with best-practice defaults already baked in.
type: integration
library: autotel-backends
library_version: '2.12.4'
sources:
  - jagreehal/autotel:packages/autotel-backends/src/
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

## Setup

```bash
pnpm add autotel-backends autotel
```

No additional peer dependencies are required for Honeycomb and most Datadog configurations. Google Cloud direct export requires `google-auth-library`. Log export for Datadog and Grafana requires `@opentelemetry/sdk-logs` and `@opentelemetry/exporter-logs-otlp-http` (bundled as direct dependencies).

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

| Option        | Required | Default                       | Description                                                  |
| ------------- | -------- | ----------------------------- | ------------------------------------------------------------ |
| `apiKey`      | yes      | —                             | Team API key                                                 |
| `service`     | yes      | —                             | Service name (= dataset in modern accounts)                  |
| `dataset`     | no       | —                             | Classic Honeycomb dataset; sets `x-honeycomb-dataset` header |
| `environment` | no       | `NODE_ENV \|\| 'development'` | Deployment environment                                       |
| `version`     | no       | auto                          | Service version                                              |
| `endpoint`    | no       | `'api.honeycomb.io:443'`      | Override for custom regions or on-prem                       |
| `sampleRate`  | no       | —                             | Head-based sample rate; sets `x-honeycomb-samplerate` header |

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

| Option                | Required       | Default                | Description                                                               |
| --------------------- | -------------- | ---------------------- | ------------------------------------------------------------------------- |
| `apiKey`              | if `!useAgent` | —                      | Datadog API key                                                           |
| `service`             | yes            | —                      | Service name                                                              |
| `site`                | no             | `'datadoghq.com'`      | Datadog site region (`datadoghq.eu`, `us3.datadoghq.com`, etc.)           |
| `environment`         | no             | `DD_ENV \|\| NODE_ENV` | Deployment environment                                                    |
| `version`             | no             | `DD_VERSION \|\| auto` | Service version                                                           |
| `enableLogs`          | no             | `false`                | Export OTel logs via OTLP; also sets `OTEL_EXPORTER_OTLP_LOGS_*` env vars |
| `useAgent`            | no             | `false`                | Route telemetry to local Datadog Agent instead of direct cloud ingestion  |
| `agentHost`           | no             | `'localhost'`          | Agent hostname (when `useAgent: true`)                                    |
| `agentPort`           | no             | `4318`                 | Agent OTLP HTTP port (when `useAgent: true`)                              |
| `logRecordProcessors` | no             | —                      | Override default log processor (advanced)                                 |

When `enableLogs: true`, the preset auto-sets `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`, `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL`, and `OTEL_EXPORTER_OTLP_LOGS_HEADERS` environment variables (only if not already set), enabling `pino-opentelemetry-transport` without extra configuration.

### Google Cloud

**Via OpenTelemetry Collector (recommended — no auth in app):**

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
| `environment`       | no       | `NODE_ENV`                           | Deployment environment                              |
| `version`           | no       | `GCP_VERSION \|\| VERSION`           | Service version                                     |
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

| Option                | Required | Default                | Description                                                         |
| --------------------- | -------- | ---------------------- | ------------------------------------------------------------------- |
| `endpoint`            | yes      | —                      | OTLP gateway endpoint                                               |
| `headers`             | no       | —                      | Auth headers; accepts `"Key=Value,Key2=Value2"` string or an object |
| `service`             | yes      | —                      | Service name                                                        |
| `environment`         | no       | `NODE_ENV`             | Deployment environment                                              |
| `version`             | no       | `OTEL_SERVICE_VERSION` | Service version                                                     |
| `enableLogs`          | no       | `true`                 | Export logs to Grafana Loki via OTLP                                |
| `logRecordProcessors` | no       | —                      | Override default log processor (advanced)                           |

Grafana preset also enables `metrics: true` by default. Logs go to `/v1/logs` on the same gateway.

## Common Mistakes

### HIGH — Passing apiKey to Datadog with useAgent: true

```typescript
// WRONG: apiKey is ignored and Agent mode doesn't use it
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

### HIGH — Calling init() without apiKey in direct Datadog mode

`createDatadogConfig` throws at call-time if `!useAgent && !apiKey`. This is a startup crash, not a runtime one.

```typescript
// WRONG: missing apiKey
init(createDatadogConfig({ service: 'my-app' }));
// throws: "Datadog API key is required..."
```

### HIGH — Trying Google Cloud direct export without google-auth-library installed

```typescript
// WRONG: throws at runtime if package is absent
init(createGoogleCloudConfig({ projectId: 'my-project', service: 'my-app' }));
// throws: "Direct export to Google Cloud requires google-auth-library..."
```

```typescript
// CORRECT: either install the package or use useCollector: true
pnpm add google-auth-library
// or:
init(createGoogleCloudConfig({
  projectId: 'my-project',
  service: 'my-app',
  useCollector: true,
}));
```

### MEDIUM — Using wrong Honeycomb API key type

Modern Honeycomb environments use a team-level API key. Classic environments use dataset-specific keys. If traces are missing, verify key type in Honeycomb's account settings. The `dataset` option is only needed for classic accounts.

### MEDIUM — Setting OTEL*EXPORTER_OTLP_LOGS*\* env vars before calling createDatadogConfig with enableLogs

The Datadog preset respects existing env vars and skips overwriting them. If you set `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` manually to the wrong value before calling the preset, the preset's correct value is silently skipped.

```typescript
// RISKY: if this env var is already set incorrectly, the preset won't fix it
process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'http://wrong-host';
init(createDatadogConfig({ apiKey: key, service: 'app', enableLogs: true }));
```

Clear or unset conflicting env vars before calling the preset, or pass `logRecordProcessors` directly.

### MEDIUM — Stripping the /v1/traces suffix from Grafana endpoint

```typescript
// WRONG: Grafana gateway expects the full base URL; the SDK appends /v1/traces
init(
  createGrafanaConfig({
    endpoint: 'https://otlp-gateway-prod-gb-south-1.grafana.net/otlp/v1/traces',
    // ...
  }),
);
```

```typescript
// CORRECT: base endpoint without signal path
init(
  createGrafanaConfig({
    endpoint: 'https://otlp-gateway-prod-gb-south-1.grafana.net/otlp',
    // ...
  }),
);
```

The preset automatically derives `/v1/logs` for log export by stripping any trailing signal path.

## Version

Targets autotel-backends v2.12.4. Direct deps: `@opentelemetry/exporter-logs-otlp-http` >=0.213.0, `@opentelemetry/sdk-logs` >=0.213.0. Optional peers: `google-auth-library` >=10.6.2 (Google Cloud direct export only). See also: `autotel` (core `init()`), `autotel-adapters` (HTTP framework adapters), `autotel-aws` (AWS instrumentation).
