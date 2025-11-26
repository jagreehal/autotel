# Datadog + Autotel Integration Example

This example demonstrates how to send **all observability signals** (traces, logs, and metrics) from Node.js to Datadog using autotel and the OpenTelemetry Protocol (OTLP).

## Overview

This example shows how autotel provides a unified, vendor-neutral approach to observability with Datadog:

- **Traces**: Distributed tracing sent to Datadog APM via OTLP
- **Logs**: Structured logs with automatic trace correlation via OTLP
- **Metrics**: Custom application metrics via OTLP

All configuration is done via environment variables (`DATADOG_API_KEY` and `DATADOG_SITE`), making it simple to deploy across environments.

## Prerequisites

1. **Datadog Account**
   - Sign up at [datadoghq.com](https://www.datadoghq.com) or [datadoghq.eu](https://www.datadoghq.eu)
   - Get your API key from [Organization Settings → API Keys](https://app.datadoghq.com/organization-settings/api-keys)

2. **Node.js**
   - Node.js 18+ installed
   - pnpm package manager

## Quick Start

### Step 1: Install Dependencies

```bash
pnpm install
```

> **Note**: This example installs `@opentelemetry/sdk-logs` and `@opentelemetry/exporter-logs-otlp-http` because they are **optional peer dependencies** of autotel. They are only needed for log export via OTLP. If you only want **traces and metrics** (not logs), you can omit these packages and remove the `logRecordProcessors` configuration from `init()`.

### Step 2: Configure Environment Variables

Copy the example environment file and add your Datadog API key:

```bash
cp .env.example .env
```

Edit `.env` and set your configuration:

```bash
# Required: Your Datadog API key
DATADOG_API_KEY=your_api_key_here

# Optional: Datadog site (defaults to datadoghq.com)
DATADOG_SITE=datadoghq.com  # or datadoghq.eu for EU region

# Optional: Service name (defaults to example-datadog)
SERVICE_NAME=example-datadog

# Optional: Environment (defaults to development)
ENVIRONMENT=development
```

### Step 3: Run the Example

```bash
pnpm start
```

The example will:
1. Initialize autotel with Datadog OTLP endpoints
2. Execute several traced operations (orders, payments, refunds, reports)
3. Send traces, logs, and metrics to Datadog
4. Output Datadog URLs to view your data

### Step 4: View Results in Datadog

After running the example, visit Datadog to see your data:

**Traces (APM)**
```
https://app.datadoghq.com/apm/traces?query=service:example-datadog
```

**Logs**
```
https://app.datadoghq.com/logs?query=service:example-datadog
```

**Metrics**
```
https://app.datadoghq.com/metric/explorer?query=example-datadog
```

> **Note**: Replace `datadoghq.com` with your Datadog site (e.g., `datadoghq.eu`) if you're in a different region.

## How It Works

### Architecture

This example uses the **OpenTelemetry Protocol (OTLP)** to send all observability signals to Datadog:

```
┌─────────────────┐
│   Application   │
│  (autotel)  │
└────────┬────────┘
         │
         │ OTLP over HTTPS
         │
         ├──────────────────┐
         │                  │
    ┌────▼────┐      ┌─────▼──────┐
    │ Traces  │      │    Logs    │
    │ Metrics │      │            │
    └────┬────┘      └─────┬──────┘
         │                  │
         ▼                  ▼
┌────────────────────────────────┐
│     Datadog OTLP Endpoint      │
│      otlp.{site}/v1/*          │
└────────────────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│         Datadog UI             │
│  APM | Logs | Metrics Explorer │
└────────────────────────────────┘
```

### Configuration Explained

The key setup happens in `src/index.ts:55-75`:

```typescript
init({
  // Service identification
  service: 'example-datadog',
  environment: 'development',

  // Datadog OTLP endpoint for traces and metrics
  endpoint: `https://otlp.${DATADOG_SITE}`,
  otlpHeaders: `dd-api-key=${DATADOG_API_KEY}`,

  // Configure log export to Datadog
  logRecordProcessors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: `https://otlp.${DATADOG_SITE}/v1/logs`,
        headers: { 'dd-api-key': DATADOG_API_KEY }
      })
    )
  ]
});
```

#### What Gets Configured

| Signal | Endpoint | Authentication |
|--------|----------|----------------|
| **Traces** | `https://otlp.{site}/v1/traces` | `dd-api-key` header |
| **Metrics** | `https://otlp.{site}/v1/metrics` | `dd-api-key` header |
| **Logs** | `https://otlp.{site}/v1/logs` | `dd-api-key` header |

All three signals use the same API key and site configuration.

### Minimal Setup (Traces + Metrics Only)

If you don't need log export, you can use a simpler configuration without installing the log packages:

```typescript
import { init, trace } from 'autotel';

// No need to install @opentelemetry/sdk-logs or exporter-logs-otlp-http!
init({
  service: 'my-app',
  endpoint: `https://otlp.${DATADOG_SITE}`,
  otlpHeaders: `dd-api-key=${DATADOG_API_KEY}`,
  // No logRecordProcessors needed
});

// Traces and metrics work automatically
const processOrder = trace(ctx => async (orderId: string) => {
  ctx.setAttribute('order.id', orderId);
  // ... business logic
});
```

**This sends**:
- ✅ Traces to Datadog APM
- ✅ Metrics to Datadog Metrics
- ❌ No logs (use your existing logger separately)

**Package.json dependencies**:
```json
{
  "dependencies": {
    "autotel": "^0.1.3"
    // No need for @opentelemetry/sdk-logs or exporter-logs-otlp-http
  }
}
```

## Direct Cloud Ingestion vs Datadog Agent

Autotel supports **two architectures** for sending telemetry to Datadog. Choose the approach that best fits your deployment:

### Architecture Comparison

#### 1. Direct Cloud Ingestion (This Example)

**What it is**: Your application sends OTLP data directly to Datadog's cloud intake endpoints over HTTPS.

```
┌─────────────────┐
│  Application    │
│  (autotel)  │
└────────┬────────┘
         │ OTLP/HTTPS
         │ (requires API key)
         ▼
┌─────────────────┐
│ Datadog Cloud   │
│ OTLP Intake     │
└─────────────────┘
```

**Configuration**:
```typescript
import { init } from 'autotel';

init({
  service: 'my-app',
  endpoint: `https://otlp.datadoghq.com`,
  otlpHeaders: `dd-api-key=${DATADOG_API_KEY}`,
});
```

**Best for**:
- ✅ **Serverless environments** (AWS Lambda, Google Cloud Functions, Azure Functions)
- ✅ **Edge runtimes** (Cloudflare Workers, Vercel Edge Functions)
- ✅ **Container platforms without persistent agents** (AWS Fargate, Google Cloud Run)
- ✅ **Simple deployments** (single service, getting started quickly)
- ✅ **Development environments** (no infrastructure needed)

**Pros**:
- Zero infrastructure - no Agent to install or manage
- Simple configuration - just API key and endpoint
- Works anywhere with HTTPS egress
- Perfect for ephemeral/short-lived workloads
- Fast initial setup

**Cons**:
- Higher egress costs (direct HTTPS to Datadog)
- No advanced Agent features (see below)
- No local data aggregation/buffering
- Each app instance sends directly

---

#### 2. Local Datadog Agent (Production Recommended)

**What it is**: Your application sends OTLP data to a local Datadog Agent, which aggregates and forwards to Datadog cloud.

```
┌─────────────────┐
│  Application    │
│  (autotel)  │
└────────┬────────┘
         │ OTLP/HTTP
         │ (no API key needed)
         ▼
┌─────────────────┐
│ Datadog Agent   │
│   (localhost)   │
│                 │
│ • Aggregates    │
│ • Enriches      │
│ • Scrubs PII    │
└────────┬────────┘
         │ Optimized
         │ (API key in Agent)
         ▼
┌─────────────────┐
│ Datadog Cloud   │
└─────────────────┘
```

**Configuration**:
```typescript
import { init } from 'autotel';

init({
  service: 'my-app',
  // Local Agent OTLP receiver (no API key needed in app!)
  endpoint: 'http://localhost:4318',
  // No otlpHeaders needed - Agent handles authentication
});
```

**Best for**:
- ✅ **Production long-running services** (Node.js servers, APIs)
- ✅ **Kubernetes/container orchestration** (Agent as DaemonSet/sidecar)
- ✅ **On-premise deployments** (VMs, bare metal)
- ✅ **High-volume applications** (many instances sending data)
- ✅ **Advanced use cases** (log multi-line parsing, data scrubbing, enrichment)

**Pros**:
- **Lower egress costs** - Agent batches and compresses data locally
- **500+ integrations** - Agent auto-collects infrastructure metrics (CPU, memory, disk, network)
- **Advanced log features**:
  - Multi-line log parsing (stack traces, JSON)
  - PII scrubbing and sensitive data redaction
  - Log enrichment with Kubernetes tags
- **Trace-log correlation** - Agent enhances correlation automatically
- **Local buffering** - Agent queues data during network issues
- **DogStatsD support** - Send metrics via UDP for ultra-low latency
- **Live debugging** - Datadog Live Tail, Dynamic Instrumentation

**Cons**:
- Requires Agent installation and management
- Additional infrastructure dependency
- Not available in serverless/edge environments
- More complex initial setup

---

### Agent Setup Instructions

If you want to use the Datadog Agent approach:

#### Step 1: Install Datadog Agent

**On macOS**:
```bash
DD_API_KEY=<YOUR_API_KEY> DD_SITE="datadoghq.com" bash -c "$(curl -L https://install.datadoghq.com/scripts/install_mac_os.sh)"
```

**On Ubuntu/Debian**:
```bash
DD_API_KEY=<YOUR_API_KEY> DD_SITE="datadoghq.com" bash -c "$(curl -L https://install.datadoghq.com/scripts/install_script_agent7.sh)"
```

**On Kubernetes** (using Helm):
```bash
helm repo add datadog https://helm.datadoghq.com
helm repo update

helm install datadog-agent datadog/datadog \
  --set datadog.apiKey=<YOUR_API_KEY> \
  --set datadog.site=datadoghq.com \
  --set datadog.otlp.receiver.protocols.http.enabled=true
```

**On Docker**:
```bash
docker run -d \
  --name datadog-agent \
  -e DD_API_KEY=<YOUR_API_KEY> \
  -e DD_SITE="datadoghq.com" \
  -e DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_HTTP_ENDPOINT="0.0.0.0:4318" \
  -p 4318:4318 \
  gcr.io/datadoghq/agent:latest
```

#### Step 2: Enable OTLP in Agent Config

Edit `/etc/datadog-agent/datadog.yaml` (or use environment variables):

```yaml
# Enable OTLP receiver on port 4318 (HTTP) and 4317 (gRPC)
otlp_config:
  receiver:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
      grpc:
        endpoint: 0.0.0.0:4317

# Optional: Enable debug mode to see OTLP data
log_level: debug
```

Restart the Agent:
```bash
sudo systemctl restart datadog-agent
```

#### Step 3: Update Application Configuration

Change your autotel config to point to the local Agent:

```typescript
import { init } from 'autotel';

init({
  service: 'my-app',
  environment: 'production',
  version: '1.0.0',

  // Point to local Datadog Agent instead of cloud
  endpoint: 'http://localhost:4318',
  // No otlpHeaders needed - Agent has the API key

  // Optional: logs still work with Agent
  logRecordProcessors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: 'http://localhost:4318/v1/logs',
        // No headers needed
      })
    )
  ],
});
```

**For Kubernetes**: Use the Agent's service hostname:
```typescript
init({
  service: 'my-app',
  // Agent runs as DaemonSet, accessible via localhost or service name
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://datadog-agent.default.svc.cluster.local:4318',
});
```

#### Step 4: Verify Agent is Receiving Data

Check Agent status:
```bash
sudo datadog-agent status
```

Look for the OTLP section showing received spans/metrics/logs.

---

### Using the Datadog Preset Helper

For even simpler configuration, use the Datadog preset helper that automatically handles both architectures:

```typescript
import { init } from 'autotel';
import { createDatadogConfig } from 'autotel/presets/datadog';

// Direct cloud ingestion
init(createDatadogConfig({
  apiKey: process.env.DATADOG_API_KEY!,
  service: 'my-app',
  site: 'datadoghq.com',
  enableLogs: true,
}));

// OR use local Agent
init(createDatadogConfig({
  service: 'my-app',
  useAgent: true,  // No API key needed!
  agentHost: 'localhost',  // Default
  agentPort: 4318,         // Default
}));
```

**Benefits of the preset**:
- Automatic endpoint configuration based on site/Agent
- Handles API key authentication headers
- Optional log processor setup
- Unified service tagging best practices
- Type-safe configuration

See `/packages/autotel/src/presets/datadog.ts` for full API.

---

### Decision Guide

**Choose Direct Cloud Ingestion if**:
- You're deploying to serverless (Lambda, Cloud Functions)
- You're using edge runtimes (Cloudflare Workers, Vercel)
- You're getting started and want simplest setup
- You have low/moderate data volume
- You don't need advanced Agent features

**Choose Datadog Agent if**:
- You're running production long-lived services
- You're on Kubernetes or container orchestration
- You have high data volume (cost optimization matters)
- You want infrastructure metrics collection
- You need advanced log parsing/scrubbing
- You want the lowest possible performance overhead

**Hybrid Approach**:
- Serverless functions → Direct cloud ingestion
- Backend services → Datadog Agent
- Edge functions → Direct cloud ingestion
- Kubernetes workloads → Datadog Agent (DaemonSet)

Both approaches send identical telemetry to Datadog - the data appears the same in the UI. Choose based on your infrastructure and operational needs.

## Features Demonstrated

### 1. Traces with Custom Attributes

```typescript
const processOrder = trace(ctx => async (orderId: string, amount: number) => {
  // Custom attributes appear in Datadog APM
  ctx.setAttribute('order.id', orderId);
  ctx.setAttribute('order.amount', amount);
  ctx.setAttribute('order.currency', 'USD');

  // ... business logic
});
```

**View in Datadog**: APM → Traces → Select a trace → See custom tags

### 2. Logs with Automatic Trace Correlation

```typescript
const logger = createLogger('datadog-example');

const processOrder = trace(ctx => async (orderId: string) => {
  // This log automatically includes trace_id and span_id
  logger.info({ orderId }, 'Processing order');

  // Access trace ID for manual correlation if needed
  console.log(`Trace ID: ${ctx.traceId}`);
});
```

**View in Datadog**: Logs → Filter by service → Click any log → See linked trace

### 3. Nested Spans (Parent-Child Relationships)

```typescript
const processPayment = trace(ctx => async (orderId: string) => {
  // These automatically create child spans
  await validatePayment(orderId);
  await chargeCard(orderId);
});
```

**View in Datadog**: APM → Traces → See flame graph with nested operations

### 4. Error Handling and Capture

```typescript
const processRefund = trace(ctx => async (orderId: string) => {
  if (shouldFail) {
    // Error is automatically captured with full stack trace
    throw new Error('Refund failed: insufficient funds');
  }
});
```

**View in Datadog**: APM → Error Tracking → See errors with traces

### 5. Custom Metrics

```typescript
import { recordMetric } from 'autotel';

recordMetric('order.processed', 1, {
  currency: 'USD',
  environment: 'development'
});

recordMetric('report.duration_ms', duration, {
  report_type: 'daily_sales'
});
```

**View in Datadog**: Metrics → Explorer → Search for your service name

## Migration from pino-datadog-transport

If you're currently using `pino-datadog-transport`, this example shows how to replace it with autotel's OTLP-based approach.

### Before (pino-datadog-transport)

```typescript
import pino from 'pino';

const logger = pino(
  pino.transport({
    target: 'pino-datadog-transport',
    options: {
      ddClientConf: {
        authMethods: { apiKeyAuth: process.env.DATADOG_API_KEY }
      },
      ddServerConf: { site: 'datadoghq.eu' },
      ddsource: 'nodejs',
      service: 'my-app'
    }
  })
);
```

**Provides**: Logs only

### After (autotel with OTLP)

```typescript
import { init } from 'autotel';
import { createLogger } from 'autotel/logger';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';

const logger = createLogger('my-app');

init({
  service: 'my-app',
  endpoint: `https://otlp.${process.env.DATADOG_SITE}`,
  otlpHeaders: `dd-api-key=${process.env.DATADOG_API_KEY}`,
  logger,
  logRecordProcessors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: `https://otlp.${process.env.DATADOG_SITE}/v1/logs`,
        headers: { 'dd-api-key': process.env.DATADOG_API_KEY }
      })
    )
  ]
});
```

**Provides**: Traces + Logs + Metrics with automatic correlation

### Migration Benefits

| Feature | pino-datadog-transport | Autotel OTLP |
|---------|------------------------|------------------|
| **Logs** | ✅ Direct | ✅ Via OTLP (optional) |
| **Traces** | ❌ No | ✅ Built-in |
| **Metrics** | ❌ No | ✅ Built-in |
| **Trace Correlation** | ❌ Manual | ✅ Automatic |
| **Vendor Lock-in** | ⚠️ Datadog-specific | ✅ OTLP standard |
| **Additional Dependencies** | pino-datadog-transport | Only autotel<br/>(+optional log packages if needed) |
| **Unified Observability** | ❌ Logs only | ✅ All signals |

### Incremental Migration Strategy

**Option 1: Hybrid Approach (Recommended for existing apps)**
Keep `pino-datadog-transport` for logs, add autotel for traces and metrics:

```typescript
// Keep your existing logger setup
import pino from 'pino';

const logger = pino(
  pino.transport({
    target: 'pino-datadog-transport',
    options: {
      ddClientConf: {
        authMethods: { apiKeyAuth: process.env.DATADOG_API_KEY }
      },
      ddServerConf: { site: 'datadoghq.eu' },
      service: 'my-app'
    }
  })
);

// Add autotel for traces and metrics only
import { init } from 'autotel';

init({
  service: 'my-app',
  endpoint: `https://otlp.datadoghq.eu`,
  otlpHeaders: `dd-api-key=${process.env.DATADOG_API_KEY}`,
  // No logRecordProcessors - keep existing log pipeline
});
```

**Benefits**:
- ✅ No changes to existing log pipeline
- ✅ Immediately get traces and metrics
- ✅ Low risk migration
- ✅ Only need to install `autotel` (no log packages)

**Option 2: Full Migration**
Replace everything with autotel OTLP (this example app):
- Install log packages: `@opentelemetry/sdk-logs`, `@opentelemetry/exporter-logs-otlp-http`
- Configure `logRecordProcessors` in `init()`
- Use `createLogger()` from autotel
- Remove `pino-datadog-transport`

### Key Differences

1. **Protocol**: pino-datadog-transport uses Datadog's proprietary log intake API; autotel uses standard OTLP
2. **Signals**: pino-datadog-transport only handles logs; autotel provides traces, logs, and metrics
3. **Correlation**: pino-datadog-transport requires manual trace ID injection; autotel does this automatically
4. **Portability**: OTLP is vendor-neutral - you can switch from Datadog to any OTLP-compatible backend (Honeycomb, New Relic, etc.) without code changes

## Datadog Site Configuration

Datadog has multiple geographic regions. Use the correct site for your account:

| Region | Site Value | OTLP Endpoint |
|--------|------------|---------------|
| **US1 (default)** | `datadoghq.com` | `https://otlp.datadoghq.com` |
| **EU** | `datadoghq.eu` | `https://otlp.datadoghq.eu` |
| **US3** | `us3.datadoghq.com` | `https://otlp.us3.datadoghq.com` |
| **US5** | `us5.datadoghq.com` | `https://otlp.us5.datadoghq.com` |
| **AP1** | `ap1.datadoghq.com` | `https://otlp.ap1.datadoghq.com` |

Check your Datadog URL to determine your site:
- If you log in at `app.datadoghq.com`, use `datadoghq.com`
- If you log in at `app.datadoghq.eu`, use `datadoghq.eu`

## Troubleshooting

### Traces/Logs/Metrics Not Appearing in Datadog

1. **Check API Key**
   ```bash
   echo $DATADOG_API_KEY
   ```
   Verify it's not empty and is the correct key from Datadog.

2. **Verify Site Configuration**
   ```bash
   echo $DATADOG_SITE
   ```
   Make sure it matches your Datadog region.

3. **Check Application Output**
   The example prints the OTLP endpoint on startup:
   ```
   OTLP Endpoint: https://otlp.datadoghq.com
   ```
   Verify this matches your expected site.

4. **Wait for Data**
   Data may take 1-2 minutes to appear in Datadog after export.

5. **Check for Errors**
   Look for error messages in the application output related to OTLP export failures.

### API Key Validation

Test your API key with curl:

```bash
curl -X POST "https://http-intake.logs.datadoghq.com/api/v2/logs" \
  -H "Content-Type: application/json" \
  -H "dd-api-key: ${DATADOG_API_KEY}" \
  -d '{
    "ddsource": "test",
    "ddtags": "env:test",
    "message": "Test message"
  }'
```

If you get a `403 Forbidden` response, your API key is invalid.

### Logs Missing Trace Context

If logs appear in Datadog but don't show trace correlation:

1. Ensure you're using `createLogger()` from autotel, not raw Pino
2. Verify logs are created within a `trace()` function
3. Check that the log processor is configured correctly in `init()`

## Advanced Configuration

### Custom Sampling

Adjust sampling rates to control costs:

```typescript
import { AdaptiveSampler } from 'autotel';

init({
  service: 'my-app',
  endpoint: `https://otlp.${DATADOG_SITE}`,
  otlpHeaders: `dd-api-key=${DATADOG_API_KEY}`,
  sampler: new AdaptiveSampler({
    baselineSampleRate: 0.05,    // Sample 5% of normal requests
    slowThresholdMs: 500,         // Requests >500ms are "slow"
    alwaysSampleErrors: true,     // Always capture errors
    alwaysSampleSlow: true,       // Always capture slow requests
  })
});
```

### Environment-Specific Configuration

Use different settings for dev/staging/prod:

```typescript
const isProduction = process.env.ENVIRONMENT === 'production';

init({
  service: SERVICE_NAME,
  environment: process.env.ENVIRONMENT,
  endpoint: `https://otlp.${DATADOG_SITE}`,
  otlpHeaders: `dd-api-key=${DATADOG_API_KEY}`,

  // More aggressive sampling in production
  sampler: isProduction
    ? new AdaptiveSampler({ baselineSampleRate: 0.1 })
    : new AdaptiveSampler({ baselineSampleRate: 1.0 }), // 100% in dev
});
```

### Additional Resource Attributes

Add custom resource attributes that appear on all spans:

```typescript
import { Resource } from '@opentelemetry/resources';

init({
  service: SERVICE_NAME,
  endpoint: `https://otlp.${DATADOG_SITE}`,
  otlpHeaders: `dd-api-key=${DATADOG_API_KEY}`,
  resource: new Resource({
    'deployment.environment': process.env.ENVIRONMENT,
    'service.version': process.env.APP_VERSION,
    'service.namespace': 'payments',
    'host.name': process.env.HOSTNAME,
  })
});
```

## Learn More

- [Autotel Documentation](https://github.com/jagreehal/autotel)
- [Datadog OTLP Ingestion](https://docs.datadoghq.com/tracing/trace_collection/opentelemetry/)
- [OpenTelemetry Protocol Specification](https://opentelemetry.io/docs/specs/otlp/)
- [Datadog API Keys](https://docs.datadoghq.com/account_management/api-app-keys/)

## Support

For issues or questions:
- Autotel: [GitHub Issues](https://github.com/jagreehal/autotel/issues)
- Datadog: [Support Portal](https://help.datadoghq.com/)
