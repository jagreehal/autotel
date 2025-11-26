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

MIT
