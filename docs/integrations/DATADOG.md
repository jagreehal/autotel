# Datadog Integration Guide

Complete guide for integrating autotel with Datadog using OpenTelemetry Protocol (OTLP).

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Architecture Choices](#architecture-choices)
  - [Direct Cloud Ingestion](#direct-cloud-ingestion)
  - [Datadog Agent](#datadog-agent)
  - [Decision Matrix](#decision-matrix)
- [Setup Instructions](#setup-instructions)
  - [Direct Cloud Ingestion Setup](#direct-cloud-ingestion-setup)
  - [Datadog Agent Setup](#datadog-agent-setup)
- [Using the Datadog Preset](#using-the-datadog-preset)
- [Migration from pino-datadog-transport](#migration-from-pino-datadog-transport)
- [Best Practices](#best-practices)
- [Deployment Patterns](#deployment-patterns)
- [Troubleshooting](#troubleshooting)
- [Advanced Configuration](#advanced-configuration)
- [FAQ](#faq)

---

## Overview

Autotel provides first-class support for Datadog through the industry-standard **OpenTelemetry Protocol (OTLP)**. This approach offers several advantages over vendor-specific integrations:

### Benefits of OTLP Integration

✅ **Unified Observability**: Send traces, logs, and metrics through a single protocol
✅ **Vendor Neutrality**: Switch between Datadog, Honeycomb, New Relic without code changes
✅ **Future-Proof**: Built on OpenTelemetry, the CNCF industry standard
✅ **Automatic Correlation**: Traces and logs are automatically linked
✅ **Simplified Setup**: Single configuration for all observability signals
✅ **Datadog Best Practices**: Built-in support for Unified Service Tagging, hostname detection, and proper resource attributes

### What You Get

When you integrate autotel with Datadog, you get:

| Signal | Destination | Features |
|--------|-------------|----------|
| **Traces** | Datadog APM | Distributed tracing, flame graphs, service maps, error tracking |
| **Logs** | Datadog Logs | Structured logs with automatic trace correlation |
| **Metrics** | Datadog Metrics | Custom business and application metrics |
| **Infrastructure** | Datadog Infrastructure (via Agent) | Host metrics, container metrics, process monitoring |

---

## Quick Start

### 1. Install Dependencies

```bash
# Core package
npm install autotel

# Optional: For log export via OTLP
npm install @opentelemetry/sdk-logs @opentelemetry/exporter-logs-otlp-http
```

### 2. Get Datadog API Key

1. Log in to [Datadog](https://app.datadoghq.com)
2. Go to **Organization Settings → API Keys**
3. Create or copy an existing API key
4. Note your Datadog site (e.g., `datadoghq.com`, `datadoghq.eu`)

### 3. Initialize Autotel

**Simple Configuration** (Traces + Metrics only):

```typescript
import { init } from 'autotel';

init({
  service: 'my-app',
  environment: 'production',
  version: '1.0.0',
  endpoint: 'https://otlp.datadoghq.com',
  otlpHeaders: `dd-api-key=${process.env.DATADOG_API_KEY}`,
});
```

**Full Configuration** (Traces + Logs + Metrics):

```typescript
import { init } from 'autotel';
import { createLogger } from 'autotel/logger';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';

const logger = createLogger('my-app');

init({
  service: 'my-app',
  environment: 'production',
  version: '1.0.0',
  endpoint: 'https://otlp.datadoghq.com',
  otlpHeaders: `dd-api-key=${process.env.DATADOG_API_KEY}`,
  logger,
  logRecordProcessors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: 'https://otlp.datadoghq.com/v1/logs',
        headers: { 'dd-api-key': process.env.DATADOG_API_KEY },
      })
    ),
  ],
});
```

**Recommended: Use the Datadog Preset**:

```typescript
import { init } from 'autotel';
import { createDatadogConfig } from 'autotel/presets/datadog';

init(createDatadogConfig({
  apiKey: process.env.DATADOG_API_KEY!,
  service: 'my-app',
  environment: 'production',
  version: '1.0.0',
  site: 'datadoghq.com',
  enableLogs: true,
}));
```

### 4. Instrument Your Code

```typescript
import { trace } from 'autotel';
import { createLogger } from 'autotel/logger';

const logger = createLogger('my-app');

const processOrder = trace((ctx) => async (orderId: string) => {
  logger.info('Processing order', { orderId });

  ctx.setAttribute('order.id', orderId);
  ctx.setAttribute('order.status', 'processing');

  // Your business logic here

  return { success: true };
});
```

### 5. View Results in Datadog

- **Traces**: https://app.datadoghq.com/apm/traces
- **Logs**: https://app.datadoghq.com/logs
- **Metrics**: https://app.datadoghq.com/metric/explorer
- **Service Catalog**: https://app.datadoghq.com/services

---

## Architecture Choices

Datadog supports two ingestion architectures. Choose based on your deployment type and requirements.

### Direct Cloud Ingestion

**How it works**: Application sends OTLP data directly to Datadog cloud endpoints via HTTPS.

```
┌─────────────────┐
│   Application   │
│  (autotel)  │
└────────┬────────┘
         │ OTLP/HTTPS
         │ (API key in headers)
         ▼
┌─────────────────┐
│ Datadog Cloud   │
│ OTLP Intake     │
└─────────────────┘
```

**Best for**:
- ✅ Serverless (AWS Lambda, Google Cloud Functions, Azure Functions)
- ✅ Edge runtimes (Cloudflare Workers, Vercel Edge, Deno Deploy)
- ✅ Containerized apps without persistent infrastructure (AWS Fargate, Cloud Run)
- ✅ Development environments
- ✅ Getting started quickly

**Pros**:
- Zero infrastructure - no Agent to install/manage
- Works anywhere with HTTPS egress
- Simple configuration
- Perfect for ephemeral workloads

**Cons**:
- Higher egress costs (every instance sends directly)
- No local data aggregation/buffering
- Missing Agent-specific features (see below)

**Configuration**:
```typescript
import { createDatadogConfig } from 'autotel/presets/datadog';

init(createDatadogConfig({
  apiKey: process.env.DATADOG_API_KEY!,
  service: 'my-lambda',
  site: 'datadoghq.com',
}));
```

---

### Datadog Agent

**How it works**: Application sends OTLP to local Datadog Agent, which aggregates and forwards to Datadog cloud.

```
┌─────────────────┐
│   Application   │
│  (autotel)  │
└────────┬────────┘
         │ OTLP/HTTP (localhost)
         │ (no API key needed)
         ▼
┌─────────────────┐
│ Datadog Agent   │
│  (localhost)    │
│                 │
│ • Aggregates    │
│ • Enriches      │
│ • Scrubs PII    │
│ • Buffers       │
└────────┬────────┘
         │ Optimized protocol
         │ (API key in Agent)
         ▼
┌─────────────────┐
│ Datadog Cloud   │
└─────────────────┘
```

**Best for**:
- ✅ Production long-running services (Node.js APIs, web servers)
- ✅ Kubernetes/container orchestration
- ✅ On-premise/VM deployments
- ✅ High-volume applications
- ✅ Advanced monitoring needs

**Pros**:
- **Lower costs**: Agent batches/compresses locally, reducing egress
- **500+ integrations**: Auto-collect infrastructure metrics (CPU, memory, disk, network, database stats)
- **Advanced log processing**:
  - Multi-line log parsing (stack traces)
  - PII scrubbing and sensitive data redaction
  - Log enrichment with Kubernetes/container tags
- **Trace-log correlation**: Enhanced correlation in Agent
- **Local buffering**: Queues data during network issues
- **DogStatsD**: Ultra-low latency metrics via UDP
- **Live debugging**: Datadog Live Tail, Dynamic Instrumentation

**Cons**:
- Requires Agent installation/management
- Not available in serverless/edge environments
- Additional infrastructure dependency

**Configuration**:
```typescript
import { createDatadogConfig } from 'autotel/presets/datadog';

init(createDatadogConfig({
  service: 'my-api',
  useAgent: true,
  agentHost: 'localhost', // Or Kubernetes service name
  agentPort: 4318,
}));
```

---

### Decision Matrix

| Factor | Direct Cloud Ingestion | Datadog Agent |
|--------|----------------------|---------------|
| **Deployment Type** | Serverless, Edge, Ephemeral | Long-running, VMs, Kubernetes |
| **Infrastructure Required** | None | Datadog Agent |
| **API Key Location** | Application | Agent (not in app) |
| **Egress Costs** | Higher (per instance) | Lower (Agent batches) |
| **Infrastructure Metrics** | ❌ No | ✅ Yes (500+ integrations) |
| **Log Processing** | Basic | Advanced (multi-line, PII scrubbing) |
| **Setup Complexity** | Low | Medium |
| **Buffering** | None | Yes (Agent queues) |
| **DogStatsD** | ❌ No | ✅ Yes |
| **Best For** | Serverless, development | Production, Kubernetes |

**Hybrid Approach** (Recommended for large deployments):
- Serverless functions → Direct cloud ingestion
- Backend APIs/services → Datadog Agent
- Edge functions → Direct cloud ingestion
- Kubernetes workloads → Datadog Agent (DaemonSet)

---

## Setup Instructions

### Direct Cloud Ingestion Setup

#### 1. Install Dependencies

```bash
npm install autotel

# Optional: for log export
npm install @opentelemetry/sdk-logs @opentelemetry/exporter-logs-otlp-http
```

#### 2. Set Environment Variables

```bash
export DATADOG_API_KEY="your_api_key_here"
export DATADOG_SITE="datadoghq.com"  # or datadoghq.eu, us3.datadoghq.com, etc.
```

#### 3. Configure Application

```typescript
import { init } from 'autotel';
import { createDatadogConfig } from 'autotel/presets/datadog';

init(createDatadogConfig({
  apiKey: process.env.DATADOG_API_KEY!,
  service: 'my-app',
  environment: process.env.NODE_ENV || 'development',
  version: process.env.APP_VERSION,
  site: process.env.DATADOG_SITE as any || 'datadoghq.com',
  enableLogs: true, // Optional
}));
```

#### 4. Deploy and Verify

After deploying, check Datadog:
- APM → Traces: Should see traces within 1-2 minutes
- Logs → Search: Filter by `service:my-app`
- Service Catalog: Your service should appear automatically

---

### Datadog Agent Setup

#### 1. Install Datadog Agent

**On macOS**:
```bash
DD_API_KEY="your_api_key" DD_SITE="datadoghq.com" bash -c "$(curl -L https://install.datadoghq.com/scripts/install_mac_os.sh)"
```

**On Ubuntu/Debian**:
```bash
DD_API_KEY="your_api_key" DD_SITE="datadoghq.com" bash -c "$(curl -L https://install.datadoghq.com/scripts/install_script_agent7.sh)"
```

**On Kubernetes (Helm)**:
```bash
helm repo add datadog https://helm.datadoghq.com
helm repo update

helm install datadog-agent datadog/datadog \
  --set datadog.apiKey=<YOUR_API_KEY> \
  --set datadog.site=datadoghq.com \
  --set datadog.otlp.receiver.protocols.http.enabled=true \
  --set datadog.otlp.receiver.protocols.grpc.enabled=true
```

**On Docker**:
```bash
docker run -d \
  --name datadog-agent \
  -e DD_API_KEY=<YOUR_API_KEY> \
  -e DD_SITE="datadoghq.com" \
  -e DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_HTTP_ENDPOINT="0.0.0.0:4318" \
  -e DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_GRPC_ENDPOINT="0.0.0.0:4317" \
  -p 4318:4318 \
  -p 4317:4317 \
  gcr.io/datadoghq/agent:latest
```

#### 2. Enable OTLP Receiver

Edit `/etc/datadog-agent/datadog.yaml`:

```yaml
# Enable OTLP receiver
otlp_config:
  receiver:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
      grpc:
        endpoint: 0.0.0.0:4317

# Optional: Enable debug logging
log_level: info
```

Restart the Agent:
```bash
sudo systemctl restart datadog-agent
```

Or with environment variables (Docker/Kubernetes):
```bash
DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_HTTP_ENDPOINT=0.0.0.0:4318
DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_GRPC_ENDPOINT=0.0.0.0:4317
```

#### 3. Configure Application

```typescript
import { init } from 'autotel';
import { createDatadogConfig } from 'autotel/presets/datadog';

init(createDatadogConfig({
  service: 'my-app',
  environment: 'production',
  version: '1.0.0',
  useAgent: true,
  agentHost: 'localhost', // Default
  agentPort: 4318,        // Default
}));
```

**For Kubernetes**: Use the Agent's service hostname:
```typescript
init(createDatadogConfig({
  service: 'my-app',
  useAgent: true,
  // Agent runs as DaemonSet, accessible via node-local or service
  agentHost: process.env.DD_AGENT_HOST || 'datadog-agent.default.svc.cluster.local',
}));
```

#### 4. Verify Agent is Receiving Data

```bash
sudo datadog-agent status
```

Look for the OTLP section showing received spans/metrics/logs:

```
=========
OTLP
=========
  HTTP:
    Endpoint: 0.0.0.0:4318
    Spans: 1234 received
    Metrics: 567 received

  Status: OK
```

---

## Using the Datadog Preset

The `createDatadogConfig()` preset helper simplifies configuration for both architectures.

### Basic Usage

```typescript
import { init } from 'autotel';
import { createDatadogConfig } from 'autotel/presets/datadog';

// Direct cloud ingestion
init(createDatadogConfig({
  apiKey: process.env.DATADOG_API_KEY!,
  service: 'my-app',
}));

// Local Agent
init(createDatadogConfig({
  service: 'my-app',
  useAgent: true,
}));
```

### Full Configuration Options

```typescript
interface DatadogPresetConfig {
  // Required
  service: string;

  // Cloud ingestion (required if useAgent: false)
  apiKey?: string;
  site?: 'datadoghq.com' | 'datadoghq.eu' | 'us3.datadoghq.com' | 'us5.datadoghq.com' | 'ap1.datadoghq.com';

  // Agent mode
  useAgent?: boolean;
  agentHost?: string;    // Default: 'localhost'
  agentPort?: number;    // Default: 4318

  // Optional (both modes)
  environment?: string;  // Default: DD_ENV || NODE_ENV || 'development'
  version?: string;      // Default: DD_VERSION || auto-detected
  enableLogs?: boolean;  // Default: false

  // Advanced
  logRecordProcessors?: LogRecordProcessor[]; // Custom log processors
}
```

### Environment Variables

The preset respects Datadog standard environment variables:

```bash
DD_ENV=production           # Sets environment
DD_VERSION=1.2.3            # Sets version
DD_HOSTNAME=my-host         # Sets hostname
DD_AGENT_HOST=localhost     # Sets Agent host
```

### Examples

**Serverless (Lambda)**:
```typescript
init(createDatadogConfig({
  apiKey: process.env.DATADOG_API_KEY!,
  service: 'order-processor',
  environment: 'production',
  site: 'datadoghq.com',
}));
```

**Kubernetes with Agent**:
```typescript
init(createDatadogConfig({
  service: 'api-gateway',
  useAgent: true,
  agentHost: process.env.DD_AGENT_HOST || 'datadog-agent.monitoring.svc.cluster.local',
}));
```

**Development**:
```typescript
init(createDatadogConfig({
  apiKey: process.env.DATADOG_API_KEY!,
  service: 'my-app-dev',
  environment: 'development',
  enableLogs: true, // More verbose in dev
}));
```

---

## Migration from pino-datadog-transport

If you're currently using `pino-datadog-transport`, autotel provides a superior alternative with traces and automatic correlation.

### Why Migrate?

| Feature | pino-datadog-transport | Autotel + OTLP |
|---------|------------------------|---------------------|
| **Logs** | ✅ Yes | ✅ Yes |
| **Traces** | ❌ No | ✅ Yes |
| **Metrics** | ❌ No | ✅ Yes |
| **Trace-Log Correlation** | ⚠️ Manual | ✅ Automatic |
| **Protocol** | Proprietary Datadog API | ✅ OTLP (industry standard) |
| **Vendor Lock-in** | ⚠️ Datadog-only | ✅ Vendor-neutral |
| **Infrastructure Metrics** | ❌ No | ✅ Yes (with Agent) |

### Migration Strategies

#### Strategy 1: Incremental (Recommended)

Keep `pino-datadog-transport` for logs, add autotel for traces and metrics.

**Before** (logs only):
```typescript
import pino from 'pino';

const logger = pino(
  pino.transport({
    target: 'pino-datadog-transport',
    options: {
      ddClientConf: {
        authMethods: { apiKeyAuth: process.env.DATADOG_API_KEY }
      },
      ddServerConf: { site: 'datadoghq.com' },
      service: 'my-app'
    }
  })
);
```

**After** (logs + traces + metrics):
```typescript
import pino from 'pino';
import { init, trace } from 'autotel';

// Keep existing logger for now
const logger = pino(
  pino.transport({
    target: 'pino-datadog-transport',
    options: {
      ddClientConf: {
        authMethods: { apiKeyAuth: process.env.DATADOG_API_KEY }
      },
      ddServerConf: { site: 'datadoghq.com' },
      service: 'my-app'
    }
  })
);

// Add autotel for traces and metrics only
init({
  service: 'my-app',
  endpoint: 'https://otlp.datadoghq.com',
  otlpHeaders: `dd-api-key=${process.env.DATADOG_API_KEY}`,
  // No logRecordProcessors - keep existing log pipeline
});

// Now you have traces!
const processOrder = trace(async (orderId) => {
  logger.info({ orderId }, 'Processing order');
  // ... business logic
});
```

**Benefits**:
- ✅ Zero risk - no changes to existing log pipeline
- ✅ Immediately gain distributed tracing
- ✅ Can validate traces before migrating logs
- ✅ Only requires installing `autotel`

#### Strategy 2: Full Migration

Replace everything with autotel OTLP.

**Before**:
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
      service: 'my-app',
      ddsource: 'nodejs'
    }
  })
);

logger.info({ userId: '123' }, 'User created');
```

**After**:
```typescript
import { init, trace } from 'autotel';
import { createLogger } from 'autotel/logger';
import { createDatadogConfig } from 'autotel/presets/datadog';

const logger = createLogger('my-app');

init(createDatadogConfig({
  apiKey: process.env.DATADOG_API_KEY!,
  service: 'my-app',
  site: 'datadoghq.eu',
  enableLogs: true,
}));

const createUser = trace((ctx) => async (userId: string) => {
  logger.info('User created', { userId });
  // Trace ID automatically included in logs!
  ctx.setAttribute('user.id', userId);
  // ... business logic
});
```

**Benefits**:
- ✅ Unified observability (traces + logs + metrics)
- ✅ Automatic trace-log correlation (no manual injection)
- ✅ OTLP standard (can switch to Honeycomb, New Relic later)
- ✅ Simpler configuration

**Migration Steps**:
1. Install: `npm install @opentelemetry/sdk-logs @opentelemetry/exporter-logs-otlp-http`
2. Replace `pino` setup with `createLogger()`
3. Update `init()` to include `logRecordProcessors`
4. Test in development
5. Deploy to staging, validate logs appear in Datadog
6. Remove `pino-datadog-transport` dependency

---

## Best Practices

### 1. Use Unified Service Tagging

Datadog's Unified Service Tagging requires three tags on all telemetry:

```typescript
init(createDatadogConfig({
  service: 'checkout-api',       // Required
  environment: 'production',      // Required
  version: '2.1.0',              // Required
}));
```

**Why**: Enables Deployment Tracking, Service Catalog, and proper correlation across signals.

### 2. Use Environment Variables

Don't hardcode configuration:

```typescript
init(createDatadogConfig({
  apiKey: process.env.DATADOG_API_KEY!,
  service: process.env.SERVICE_NAME!,
  environment: process.env.DD_ENV || process.env.NODE_ENV,
  version: process.env.DD_VERSION || require('./package.json').version,
  site: (process.env.DATADOG_SITE as any) || 'datadoghq.com',
}));
```

### 3. Use Adaptive Sampling in Production

Default sampling (10% baseline, 100% errors/slow) is good for most cases:

```typescript
init(createDatadogConfig({
  apiKey: process.env.DATADOG_API_KEY!,
  service: 'my-app',
  // Default sampling is already adaptive - no config needed!
}));
```

For custom sampling:
```typescript
import { AdaptiveSampler } from 'autotel/sampling';

init({
  service: 'my-app',
  endpoint: '...',
  otlpHeaders: '...',
  sampler: new AdaptiveSampler({
    baselineSampleRate: 0.05,  // 5% of normal traffic
    slowThresholdMs: 1000,      // Requests >1s are "slow"
    alwaysSampleErrors: true,   // Always capture errors
    alwaysSampleSlow: true,     // Always capture slow requests
  }),
});
```

### 4. Add Meaningful Attributes

Use semantic conventions where possible:

```typescript
const processCheckout = trace((ctx) => async (userId, items) => {
  // Datadog recognizes these standard attributes
  ctx.setAttribute('user.id', userId);
  ctx.setAttribute('http.method', 'POST');
  ctx.setAttribute('http.route', '/checkout');

  // Custom business attributes
  ctx.setAttribute('checkout.items_count', items.length);
  ctx.setAttribute('checkout.total_amount', calculateTotal(items));
});
```

### 5. Use Structured Logging

Always log with context objects:

```typescript
// Good
logger.info('Order processed', {
  orderId,
  amount,
  customerId,
  processingTime: duration
});

// Bad - harder to query in Datadog
logger.info(`Order ${orderId} processed for customer ${customerId}`);
```

### 6. Enable Log Correlation

Logs automatically include trace IDs for correlation:

```typescript
const logger = createLogger('my-app');

const processOrder = trace((ctx) => async (orderId) => {
  // This log automatically includes:
  // - traceId (hex)
  // - spanId (hex)
  // - dd.trace_id (decimal, for Datadog)
  // - dd.span_id (decimal, for Datadog)
  logger.info('Processing order', { orderId });
});
```

View correlated logs in Datadog:
1. Go to APM → Traces
2. Click any trace
3. See "Logs" tab with related log entries

### 7. Use Metrics for Business KPIs

Track important business metrics:

```typescript
import { Metrics } from 'autotel/metrics';

const metrics = new Metric('checkout');

const processCheckout = trace(async (items) => {
  const total = calculateTotal(items);

  // Track business metrics
  metrics.trackEvent('checkout.completed', {
    payment_method: 'credit_card',
    currency: 'USD',
  });

  metrics.trackValue('checkout.amount', total, {
    currency: 'USD',
  });
});
```

### 8. Use Agent in Production

For production workloads on Kubernetes/VMs, use the Datadog Agent:

**Benefits**:
- Lower costs (Agent batches/compresses)
- Infrastructure metrics (CPU, memory, network)
- Advanced log features (multi-line parsing, PII scrubbing)
- Better reliability (local buffering)

---

## Deployment Patterns

### AWS Lambda

**Challenge**: Ephemeral, no persistent Agent
**Solution**: Direct cloud ingestion

```typescript
import { init } from 'autotel';
import { createDatadogConfig } from 'autotel/presets/datadog';

// Initialize once (outside handler for warm starts)
init(createDatadogConfig({
  apiKey: process.env.DATADOG_API_KEY!,
  service: 'order-processor',
  environment: process.env.ENVIRONMENT!,
  version: process.env.VERSION,
  site: 'datadoghq.com',
}));

export const handler = trace(async (event) => {
  // Your Lambda logic
  return { statusCode: 200, body: 'OK' };
});
```

### Kubernetes

**Challenge**: Multiple pods, need infrastructure metrics
**Solution**: Datadog Agent as DaemonSet

**1. Install Agent**:
```bash
helm install datadog-agent datadog/datadog \
  --set datadog.apiKey=$DD_API_KEY \
  --set datadog.otlp.receiver.protocols.http.enabled=true \
  --set datadog.logs.enabled=true \
  --set datadog.logs.containerCollectAll=true
```

**2. Configure app**:
```typescript
init(createDatadogConfig({
  service: 'api-gateway',
  environment: 'production',
  useAgent: true,
  // Agent runs as DaemonSet on each node
  agentHost: process.env.DD_AGENT_HOST || 'localhost',
}));
```

**3. Set pod environment**:
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: api-gateway
spec:
  containers:
  - name: app
    image: myapp:1.0.0
    env:
    - name: DD_AGENT_HOST
      valueFrom:
        fieldRef:
          fieldPath: status.hostIP  # DaemonSet agent on node
```

### Docker Compose

**Solution**: Agent as sidecar service

```yaml
version: '3.8'

services:
  app:
    image: myapp:latest
    environment:
      DD_AGENT_HOST: datadog-agent
      SERVICE_NAME: my-app
    depends_on:
      - datadog-agent

  datadog-agent:
    image: gcr.io/datadoghq/agent:latest
    environment:
      DD_API_KEY: ${DATADOG_API_KEY}
      DD_SITE: datadoghq.com
      DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_HTTP_ENDPOINT: "0.0.0.0:4318"
    ports:
      - "4318:4318"
```

### Cloudflare Workers / Vercel Edge

**Challenge**: Edge runtime, no Node.js APIs
**Solution**: Use `autotel-edge` (not regular `autotel`)

```typescript
import { init, trace } from 'autotel-edge';

init({
  service: 'edge-api',
  endpoint: 'https://otlp.datadoghq.com',
  otlpHeaders: `dd-api-key=${DATADOG_API_KEY}`,
});

export default {
  fetch: trace(async (request) => {
    // Edge function logic
    return new Response('OK');
  }),
};
```

### Multi-Region Deployments

**Challenge**: Different Datadog sites per region
**Solution**: Configure site via environment variable

```typescript
// Automatically picks correct site based on deployment region
init(createDatadogConfig({
  apiKey: process.env.DATADOG_API_KEY!,
  service: 'global-api',
  site: (process.env.DATADOG_SITE as any) || 'datadoghq.com',
  // US: datadoghq.com
  // EU: datadoghq.eu
  // AP: ap1.datadoghq.com
}));
```

---

## Troubleshooting

### Traces/Logs Not Appearing

**1. Verify API Key**

```bash
curl -X POST "https://http-intake.logs.datadoghq.com/api/v2/logs" \
  -H "dd-api-key: ${DATADOG_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"message":"test","ddsource":"test"}'
```

Expected: `HTTP 202 Accepted`
If `403 Forbidden`: Invalid API key

**2. Check Endpoint URL**

Verify the site matches your Datadog region:
- US1: `datadoghq.com`
- EU: `datadoghq.eu`
- US3: `us3.datadoghq.com`

**3. Check Application Logs**

Enable debug logging:
```typescript
import { init } from 'autotel';
import { createLogger } from 'autotel/logger';

const logger = createLogger('my-app', { level: 'debug' });

init({
  service: 'my-app',
  logger, // Autotel will log export errors
  // ...
});
```

**4. Verify Data is Being Sent**

Check for OTLP export errors in application logs:
```
ERROR: Failed to export traces to https://otlp.datadoghq.com/v1/traces
```

**5. Wait for Data Ingestion**

Data may take 1-2 minutes to appear in Datadog UI after export.

### Agent Not Receiving Data

**1. Check Agent Status**

```bash
sudo datadog-agent status
```

Look for OTLP section. If missing, OTLP receiver is not enabled.

**2. Verify OTLP is Enabled**

```bash
cat /etc/datadog-agent/datadog.yaml | grep -A 10 otlp
```

Should show:
```yaml
otlp_config:
  receiver:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
```

**3. Check Agent Logs**

```bash
sudo tail -f /var/log/datadog/agent.log
```

Look for OTLP receiver startup messages.

**4. Test OTLP Endpoint**

```bash
curl -v http://localhost:4318/v1/traces
```

Expected: Response from OTLP receiver (not "connection refused")

**5. Check Firewall**

Ensure port 4318 is open:
```bash
sudo netstat -tulpn | grep 4318
```

### Logs Missing Trace Correlation

**Symptom**: Logs appear in Datadog but don't show linked traces

**Solution**: Ensure you're using `createLogger()` from autotel:

```typescript
// Correct - includes trace correlation
import { createLogger } from 'autotel/logger';
const logger = createLogger('my-app');

// Wrong - no trace correlation
import pino from 'pino';
const logger = pino();
```

**Verify in Datadog**:
1. Go to Logs
2. Click any log entry
3. Check for `dd.trace_id` and `dd.span_id` fields
4. If present, correlation should work

### High Costs

**Solution 1: Use Adaptive Sampling**

```typescript
import { AdaptiveSampler } from 'autotel/sampling';

init({
  service: 'my-app',
  sampler: new AdaptiveSampler({
    baselineSampleRate: 0.01,  // 1% of normal traffic
    alwaysSampleErrors: true,   // But always capture errors
  }),
  // ...
});
```

**Solution 2: Use Datadog Agent**

Agent batches/compresses data, reducing egress costs significantly.

**Solution 3: Filter Noisy Endpoints**

```typescript
import { AdaptiveSampler } from 'autotel/sampling';

const sampler = new AdaptiveSampler({
  shouldSample: (context) => {
    // Don't sample health checks
    const route = context.attributes['http.route'];
    if (route === '/health' || route === '/metrics') {
      return false;
    }
    return true;
  },
});
```

---

## Advanced Configuration

### Custom Resource Attributes

Add deployment-specific attributes:

```typescript
import { Resource } from '@opentelemetry/resources';

init({
  service: 'my-app',
  endpoint: '...',
  otlpHeaders: '...',
  resource: new Resource({
    'deployment.environment': 'production',
    'service.namespace': 'payments',
    'service.version': '2.1.0',
    'host.name': process.env.HOSTNAME,
    'cloud.provider': 'aws',
    'cloud.region': 'us-east-1',
  }),
});
```

### Custom Sampling Logic

Implement complex sampling rules:

```typescript
import { AdaptiveSampler } from 'autotel/sampling';

const sampler = new AdaptiveSampler({
  shouldSample: (context) => {
    // Always sample authenticated requests
    if (context.attributes['user.authenticated'] === true) {
      return true;
    }

    // Sample 100% of payments
    if (context.attributes['http.route']?.includes('/payment')) {
      return true;
    }

    // Sample 5% of everything else
    return Math.random() < 0.05;
  },
});

init({
  service: 'my-app',
  sampler,
  // ...
});
```

### Per-Environment Configuration

```typescript
const config = {
  development: {
    enableLogs: true,
    sampler: new AdaptiveSampler({ baselineSampleRate: 1.0 }), // 100%
  },
  staging: {
    enableLogs: true,
    sampler: new AdaptiveSampler({ baselineSampleRate: 0.5 }),  // 50%
  },
  production: {
    enableLogs: false, // Use existing log pipeline
    sampler: new AdaptiveSampler({ baselineSampleRate: 0.1 }),  // 10%
    useAgent: true,    // Always use Agent in prod
  },
};

const env = process.env.NODE_ENV as keyof typeof config;

init(createDatadogConfig({
  apiKey: process.env.DATADOG_API_KEY!,
  service: 'my-app',
  environment: env,
  ...config[env],
}));
```

---

## FAQ

### Q: Can I use both pino-datadog-transport and autotel?

**A**: Yes! Use pino-datadog-transport for logs and autotel for traces/metrics. This is the recommended incremental migration strategy. See [Migration Strategy 1](#strategy-1-incremental-recommended).

### Q: Do I need the Agent or can I just use direct ingestion?

**A**: Both work. Use **direct ingestion** for serverless/edge. Use **Agent** for production services (lower costs, more features). See [Architecture Choices](#architecture-choices).

### Q: What's the difference between autotel and @datadog/dd-trace?

**A**:
- `@datadog/dd-trace`: Datadog-specific tracing library, proprietary protocol
- `autotel`: Vendor-neutral OpenTelemetry wrapper, OTLP standard

Autotel is better if you want vendor flexibility. Both work with Datadog.

### Q: How do I reduce costs?

**A**:
1. Use Datadog Agent (batches/compresses data)
2. Use adaptive sampling (lower baseline rate)
3. Filter noisy endpoints (health checks, metrics endpoints)
See [High Costs](#high-costs) troubleshooting.

### Q: Can I send logs to Datadog without OTLP?

**A**: Yes! You can:
1. Keep your existing log transport (pino-datadog-transport, winston-datadog)
2. Use autotel for traces/metrics only
3. Set `enableLogs: false` in config

Traces will still correlate with logs if you use `createLogger()` (it adds trace IDs to logs).

### Q: Does this work with Cloudflare Workers / Vercel Edge?

**A**: Use `autotel-edge` instead of `autotel`. Same API, optimized for edge runtimes.

```typescript
import { init, trace } from 'autotel-edge';
// ... rest is the same
```

### Q: How do I see infrastructure metrics?

**A**: Install the Datadog Agent. It auto-collects CPU, memory, disk, network, and has 500+ integrations (Redis, PostgreSQL, etc.).

Direct cloud ingestion only sends application metrics (traces, custom metrics), not infrastructure.

### Q: Can I switch from Datadog to Honeycomb later?

**A**: Yes! That's the benefit of OTLP. Just change the `endpoint` and `otlpHeaders` in your config:

```typescript
// Switch from Datadog to Honeycomb
init({
  service: 'my-app',
  endpoint: 'https://api.honeycomb.io/v1/traces', // Changed
  otlpHeaders: `x-honeycomb-team=${HONEYCOMB_API_KEY}`, // Changed
  // No code changes needed!
});
```

---

## Example Application

See the complete working example:

**Location**: `/apps/example-datadog`

**Features demonstrated**:
- Direct cloud ingestion setup
- Traces with custom attributes
- Logs with automatic trace correlation
- Custom business metrics
- Error handling and capture
- Nested spans
- Environment-based configuration

**Run it**:
```bash
cd apps/example-datadog
cp .env.example .env
# Add your DATADOG_API_KEY to .env
pnpm install
pnpm start
```

---

## Additional Resources

- [Datadog OTLP Documentation](https://docs.datadoghq.com/tracing/trace_collection/opentelemetry/)
- [OpenTelemetry Specification](https://opentelemetry.io/docs/specs/otlp/)
- [Datadog Unified Service Tagging](https://docs.datadoghq.com/getting_started/tagging/unified_service_tagging/)
- [Datadog Agent OTLP Configuration](https://docs.datadoghq.com/opentelemetry/otlp_ingest_in_the_agent/)
- [Autotel GitHub](https://github.com/jagreehal/autotel)

---

## Support

**Autotel Issues**: [GitHub Issues](https://github.com/jagreehal/autotel/issues)
**Datadog Support**: [Datadog Help](https://help.datadoghq.com/)

For integration questions, please open a GitHub issue with:
- Your deployment type (serverless, Kubernetes, etc.)
- Architecture choice (Agent vs direct ingestion)
- Configuration snippet (redact API keys!)
- Error messages or unexpected behavior
