# Autotel Backends

Vendor backend configurations for [Autotel](../autotel) - simplified setup helpers for popular observability platforms.

## What are Backends?

**Backends** are vendor-specific configuration helpers that simplify setting up Autotel with observability platforms like Honeycomb, Datadog, New Relic, etc.

They handle:

- Correct endpoint URLs for each vendor
- Authentication headers and API key formats
- Protocol selection (gRPC vs HTTP)
- Region-specific configurations
- Best practice defaults

### Backends vs Plugins

| Package              | Purpose                                               | Examples                    |
| -------------------- | ----------------------------------------------------- | --------------------------- |
| **autotel-backends** | Configure **where** telemetry goes (outputs)          | Honeycomb, Datadog, Grafana |
| **autotel-plugins**  | Instrument **libraries** to create telemetry (inputs) | Drizzle ORM, custom SDKs    |

**Think of it this way**: Plugins create the data, backends send it somewhere.

## Installation

```bash
npm install autotel autotel-backends
```

## Quick Start

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

### Datadog

```typescript
import { init } from 'autotel';
import { createDatadogConfig } from 'autotel-backends/datadog';

// Direct cloud ingestion (serverless, edge)
init(
  createDatadogConfig({
    apiKey: process.env.DATADOG_API_KEY!,
    service: 'my-lambda',
  }),
);

// Or use local Datadog Agent (Kubernetes, long-running services)
init(
  createDatadogConfig({
    service: 'my-api',
    useAgent: true,
  }),
);
```

## Available Backends

### 🍯 Honeycomb

[Honeycomb](https://honeycomb.io) provides powerful distributed tracing and observability.

```typescript
import { createHoneycombConfig } from 'autotel-backends/honeycomb';

init(
  createHoneycombConfig({
    apiKey: process.env.HONEYCOMB_API_KEY!,
    service: 'my-app',
    environment: 'production',
    version: '1.0.0',
    dataset: 'my-dataset', // Optional: for classic accounts
  }),
);
```

**Features**:

- Auto-configures gRPC protocol (Honeycomb's preferred)
- Supports both classic datasets and modern service-based routing
- Environment and version tagging
- Head-based sampling configuration

[View full Honeycomb configuration options →](./src/honeycomb.ts)

### 🐕 Datadog

[Datadog](https://datadoghq.com) provides comprehensive APM, infrastructure monitoring, and logs.

```typescript
import { createDatadogConfig } from 'autotel-backends/datadog';

// Cloud ingestion (best for serverless/edge)
init(
  createDatadogConfig({
    apiKey: process.env.DATADOG_API_KEY!,
    site: 'datadoghq.com', // or 'datadoghq.eu', 'us3.datadoghq.com', etc.
    service: 'my-lambda',
    environment: 'production',
    enableLogs: true, // Optional: also send logs
  }),
);

// Agent-based (best for Kubernetes/VMs)
init(
  createDatadogConfig({
    service: 'my-api',
    useAgent: true,
    agentHost: 'localhost', // or 'datadog-agent.default.svc.cluster.local'
    agentPort: 4318,
  }),
);
```

**Features**:

- Direct cloud ingestion OR local agent
- Multi-region support (US1, US3, US5, EU, AP1, FedRAMP)
- Unified service tagging (service, env, version)
- Optional log export via OTLP
- Kubernetes-friendly agent configuration

[View full Datadog configuration options →](./src/datadog.ts)

### 🔥 Logfire

[Pydantic Logfire](https://pydantic.dev/logfire) keeps `gen_ai.*` semantic-convention attributes and W3C trace IDs intact on the read path, so GenAI traces come back the shape you emitted them.

```typescript
import { createLogfireConfig } from 'autotel-backends/logfire';

init(
  createLogfireConfig({
    writeToken: process.env.LOGFIRE_WRITE_TOKEN!,
    service: 'my-app',
  }),
);
```

**Features**:

- Forces OTLP/HTTP **protobuf** — Logfire rejects gRPC and silently drops a JSON body, so either default loses your traces without an error
- Defaults to the token-routed ingest host, so an EU token doesn't 401 against a US endpoint; pin with `region: 'us' | 'eu'` or override `endpoint` for self-hosted
- Sends the write token bare, as Logfire's ingest expects (its query API wants `Bearer <read-token>` instead — different credential, different format)

[View full Logfire configuration options →](./src/logfire.ts)

### 🦔 PostHog

[PostHog](https://posthog.com) ingests OTLP traces, logs and metrics, so product analytics and distributed traces can share a destination. (For product _events_, see `autotel-subscribers/posthog` — a separate path.)

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

**Features**:

- OTLP/HTTP **protobuf** — PostHog's docs steer away from the JSON exporter, and a JSON body is dropped rather than rejected
- Handles the `/i` path prefix its OTLP receiver lives under, so signals land on `/i/v1/traces`, `/i/v1/logs` and `/i/v1/metrics`
- US and EU cloud regions, plus a self-hosted `host` override
- Bearer auth with the `phc_…` project token

[View full PostHog configuration options →](./src/posthog.ts)

### 🪢 Langfuse

[Langfuse](https://langfuse.com) ingests plain OTLP, so autotel's GenAI spans land without a Langfuse SDK in your app.

```typescript
import { createLangfuseConfig } from 'autotel-backends/langfuse';

init(
  createLangfuseConfig({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
    secretKey: process.env.LANGFUSE_SECRET_KEY!,
    service: 'my-app',
    region: 'eu', // or 'us'
  }),
);
```

**Features**:

- OTLP/HTTP only — Langfuse does not support gRPC
- EU and US cloud regions, plus a self-hosted `baseUrl` override
- Basic auth built from your public/secret key pair
- Opts into v4 ingestion, which keeps traces queryable promptly

[View full Langfuse configuration options →](./src/langfuse.ts)

## Why Use Backend Configs?

### Without backend configs (manual):

```typescript
import { init } from 'autotel';

init({
  service: 'my-app',
  endpoint: 'https://api.honeycomb.io:443',
  protocol: 'grpc',
  otlpHeaders: {
    'x-honeycomb-team': process.env.HONEYCOMB_API_KEY!,
    'x-honeycomb-dataset': 'production',
  },
  environment: 'production',
  version: '1.0.0',
});
```

### With backend configs:

```typescript
import { init } from 'autotel';
import { createHoneycombConfig } from 'autotel-backends/honeycomb';

init(
  createHoneycombConfig({
    apiKey: process.env.HONEYCOMB_API_KEY!,
    service: 'my-app',
    environment: 'production',
    version: '1.0.0',
  }),
);
```

**Benefits**:

- Less code, fewer mistakes
- Vendor best practices built-in
- Validated configurations
- Easy to switch vendors

## Using Environment Variables

All backends work great with environment variables:

```typescript
import { createHoneycombConfig } from 'autotel-backends/honeycomb';

init(
  createHoneycombConfig({
    apiKey: process.env.HONEYCOMB_API_KEY!,
    service: process.env.SERVICE_NAME || 'my-app',
    environment: process.env.NODE_ENV,
  }),
);
```

Or use Autotel's built-in env var support:

```bash
# .env
OTEL_SERVICE_NAME=my-app
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=YOUR_API_KEY
```

```typescript
import { init } from 'autotel';

// Reads from env vars automatically
init({});
```

## Migration from autotel/presets

If you were using `autotel/presets/*`, migration is simple:

**Before** (v1.x):

```typescript
import { createHoneycombConfig } from 'autotel/presets/honeycomb';
```

**After** (v2.x):

```bash
npm install autotel-backends
```

```typescript
import { createHoneycombConfig } from 'autotel-backends/honeycomb';
```

The configuration options are **identical** - only the import path changed.

## Philosophy

Autotel follows the principle: **"Write once, observe everywhere"**.

Backend configurations are:

- **Optional**: Use raw `init()` config if you prefer
- **Vendor-agnostic at core**: Keeping these separate maintains the vendor-neutral philosophy
- **Best practices**: Configurations follow vendor recommendations
- **Tree-shakeable**: Import only what you need

## TypeScript

Full type safety with TypeScript:

```typescript
import type {
  HoneycombPresetConfig,
  DatadogPresetConfig,
} from 'autotel-backends';

const honeycombConfig: HoneycombPresetConfig = {
  apiKey: process.env.HONEYCOMB_API_KEY!,
  service: 'my-app',
};

const datadogConfig: DatadogPresetConfig = {
  apiKey: process.env.DATADOG_API_KEY!,
  service: 'my-app',
  site: 'datadoghq.com',
};
```

## Contributing

Want to add a new backend configuration? Please [open an issue](https://github.com/jagreehal/autotel/issues) to discuss.

Popular backends we'd love to support:

- Grafana Cloud
- New Relic
- Lightstep
- Elastic APM
- AWS X-Ray
- Google Cloud Trace

## License

Apache-2.0
