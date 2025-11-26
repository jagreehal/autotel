# Migration Guide: From OpenTelemetry to Autotel

This guide shows how to migrate from vanilla OpenTelemetry to autotel.

Typical migration reduces SDK setup from 30+ lines to 5-10 lines and replaces manual span lifecycle management with functional wrappers.

## Quick Migration

Follow these 4 steps:

### Step 1: Install

```bash
npm install autotel
# or
pnpm add autotel
```

### Step 2: Find Your Current OpenTelemetry Setup

Look for one of these patterns in your code:

**Pattern A**: Environment variables + `NODE_OPTIONS`

```bash
# In your .env, docker-compose.yml, or startup script
NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register"
OTEL_EXPORTER_OTLP_ENDPOINT="http://your-collector:4318"
OTEL_SERVICE_NAME="your-service"
```

**Pattern B**: Manual SDK initialization

```typescript
// In instrumentation.ts, tracing.ts, or app.ts
const sdk = new opentelemetry.NodeSDK({
  serviceName: 'your-service',
  traceExporter: new OTLPTraceExporter({ url: '...' }),
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();
```

> **Heads up**: Autotel lazily loads `@opentelemetry/auto-instrumentations-node`
> when you set `integrations`. Keep that package installed (or add it now) so the
> same auto-instrumentations you used with `NODE_OPTIONS` remain available.

### Step 3: Replace With Autotel

**If you found Pattern A** (environment variables):

1. **Remove** the `NODE_OPTIONS` environment variable
2. **Create** a new file `instrumentation.ts` (or add to existing entry point):

```typescript
import { init } from 'autotel';

init({
  service: process.env.OTEL_SERVICE_NAME || 'your-service',
  endpoint:
    process.env.OTLP_ENDPOINT ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    'http://localhost:4318',
  integrations: true, // Requires @opentelemetry/auto-instrumentations-node
});
```

3. **Import** this file at the very top of your entry point:

```typescript
// At the top of app.ts, server.ts, or index.ts
import './instrumentation'; // ← Add this FIRST

// Rest of your imports
import express from 'express';
// ...
```

**If you found Pattern B** (manual SDK):

1. **Replace** your entire SDK setup with:

```typescript
import { init, shutdown } from 'autotel';

init({
  service: 'your-service', // Copy from your NodeSDK config
  endpoint: 'http://your-collector:4318', // Copy from your exporter URL
  integrations: true,
});

// Replace sdk.shutdown() calls
process.on('SIGTERM', shutdown);
```

2. **Remove** these imports (you don't need them anymore):

```typescript
// DELETE THESE:
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
// etc.
```

### Step 4: Verify

1. Start your app:
   ```bash
   npm start
   ```

2. Check your observability backend (Honeycomb, Datadog, Grafana, etc.):
   - Traces should appear
   - Service name matches your configuration
   - Auto-instrumentations working (HTTP, database calls, etc.)

3. Trigger an error to verify error traces appear

### What Changed

- Auto-instrumentation uses the same libraries
- OTLP endpoint unchanged
- Tail sampling replaces head sampling (10% baseline, 100% errors/slow requests)
- Rate limiting and circuit breakers added
- PII redaction available

### Optional: Use Functional API

Replace manual spans with `trace()`:

```typescript
// OLD: Manual span management
const tracer = trace.getTracer('my-app');
async function createUser(data) {
  const span = tracer.startSpan('createUser');
  try {
    const user = await db.users.create(data);
    span.end();
    return user;
  } catch (error) {
    span.recordException(error);
    span.end();
    throw error;
  }
}

// NEW: Automatic lifecycle
import { trace } from 'autotel';
const createUser = trace(async (data) => {
  return await db.users.create(data);
});
```

Automatic log correlation:

```typescript
import { createLogger } from 'autotel/logger';

const logger = createLogger('my-service');
logger.info('Request processed'); // Trace ID included automatically
```

See sections below for pattern-by-pattern migrations, custom sampling, and edge cases.

---

## Table of Contents

- [Migration Guide: From OpenTelemetry to Autotel](#migration-guide-from-opentelemetry-to-autotel)
  - [Quick Migration](#quick-migration)
    - [Step 1: Install](#step-1-install)
    - [Step 2: Find Your Current OpenTelemetry Setup](#step-2-find-your-current-opentelemetry-setup)
    - [Step 3: Replace With Autotel](#step-3-replace-with-autotel)
    - [Step 4: Verify](#step-4-verify)
    - [What Changed](#what-changed)
    - [Optional: Use Functional API](#optional-use-functional-api)
  - [Table of Contents](#table-of-contents)
  - [Quick Reference](#quick-reference)
  - [Pattern-by-Pattern Migration](#pattern-by-pattern-migration)
    - [Pattern 1: Environment Variables + Auto-Instrumentation](#pattern-1-environment-variables--auto-instrumentation)
    - [Pattern 2: Manual SDK Setup](#pattern-2-manual-sdk-setup)
    - [Pattern 3: Manual Span Lifecycle](#pattern-3-manual-span-lifecycle)
    - [Pattern 4: Logger Integration](#pattern-4-logger-integration)
    - [Pattern 5: Custom Sampling](#pattern-5-custom-sampling)
    - [Pattern 6: Metrics and Logs](#pattern-6-metrics-and-logs)
  - [Feature Mapping Reference](#feature-mapping-reference)
  - [Advanced Migrations](#advanced-migrations)
    - [Migrating OpenTelemetry Collector Configuration](#migrating-opentelemetry-collector-configuration)
    - [Migrating Custom Instrumentations](#migrating-custom-instrumentations)
    - [Migrating Context Propagation](#migrating-context-propagation)
    - [Testing Your Migration](#testing-your-migration)
  - [Migration Checklist](#migration-checklist)
    - [Phase 1: Preparation](#phase-1-preparation)
    - [Phase 2: Installation](#phase-2-installation)
    - [Phase 3: Replace SDK Initialization](#phase-3-replace-sdk-initialization)
    - [Phase 4: Migrate Manual Spans](#phase-4-migrate-manual-spans)
    - [Phase 5: Migrate Logging](#phase-5-migrate-logging)
    - [Phase 6: Migrate Testing](#phase-6-migrate-testing)
    - [Phase 7: Validation](#phase-7-validation)
    - [Phase 8: Deployment](#phase-8-deployment)
    - [Phase 9: Optimization (Optional)](#phase-9-optimization-optional)
  - [Need Help?](#need-help)
  - [Appendix: Side-by-Side Comparison](#appendix-side-by-side-comparison)
    - [Full Stack Comparison](#full-stack-comparison)

---

## Quick Reference

| OpenTelemetry Pattern                                                         | Autotel Equivalent                   | What Changes                        |
| ----------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------- |
| `NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register"` | `init({ integrations: true })`           | Programmatic configuration          |
| `new NodeSDK({ ... })`                                                        | `init({ ... })`                          | Reduced boilerplate (30+ → 5 lines) |
| `tracer.startSpan()` + `span.end()`                                           | `trace(fn)`                              | Automatic span lifecycle            |
| Manual log correlation                                                        | `autotel/logger`                     | Automatic trace context injection   |
| Head sampling                                                                 | Tail sampling (default)                  | Sample 100% of errors/slow requests |
| Custom span processor                                                         | Built-in rate limiters, circuit breakers | Rate limiting, circuit breakers     |

---

## Pattern-by-Pattern Migration

### Pattern 1: Environment Variables + Auto-Instrumentation

**Before**:

```bash
OTEL_TRACES_EXPORTER="otlp" \
OTEL_METRICS_EXPORTER="otlp" \
OTEL_LOGS_EXPORTER="otlp" \
OTEL_NODE_RESOURCE_DETECTORS="env,host,os" \
OTEL_RESOURCE_ATTRIBUTES="service.name=my-service,service.namespace=production,deployment.environment=prod" \
OTEL_EXPORTER_OTLP_ENDPOINT=https://collector.example.com:4318 \
NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register" \
node app.js
```

**After**:

```typescript
import { init } from 'autotel';

init({
  service: 'my-service',
  environment: 'prod',
  endpoint: 'https://collector.example.com:4318',
  integrations: true, // Enables all auto-instrumentations
  resourceAttributes: {
    'service.namespace': 'production',
  },
});
```

Need advanced resource detection (env/host/os)? Reuse whichever detectors you
already configured (for example via `@opentelemetry/resource-detector-*`), build
a `Resource` with them, and pass it through the `resource` option.

**What Changed:**

- No `NODE_OPTIONS` flag
- Programmatic configuration (change without restart)
- Type-safe configuration
- Includes rate limiting, circuit breakers, PII redaction
- Tail sampling (10% baseline, 100% errors/slow requests)

---

### Pattern 2: Manual SDK Setup

**Before**:

```typescript
const process = require('process');
const opentelemetry = require('@opentelemetry/sdk-node');
const {
  getNodeAutoInstrumentations,
} = require('@opentelemetry/auto-instrumentations-node');
const {
  OTLPTraceExporter,
} = require('@opentelemetry/exporter-trace-otlp-http');
const {
  OTLPMetricExporter,
} = require('@opentelemetry/exporter-metrics-otlp-http');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { Resource } = require('@opentelemetry/resources');
const {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
} = require('@opentelemetry/semantic-conventions');

const resource = Resource.default().merge(
  new Resource({
    [ATTR_SERVICE_NAME]: 'my-service',
    [ATTR_SERVICE_NAMESPACE]: 'production',
  }),
);

const traceExporter = new OTLPTraceExporter({
  url: 'https://collector.example.com:4318/v1/traces',
});

const metricReader = new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter({
    url: 'https://collector.example.com:4318/v1/metrics',
  }),
  exportIntervalMillis: 60000,
});

const sdk = new opentelemetry.NodeSDK({
  resource,
  traceExporter,
  metricReader,
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk
    .shutdown()
    .then(() => console.log('Tracing terminated'))
    .catch((error) => console.log('Error terminating tracing', error))
    .finally(() => process.exit(0));
});
```

**After**:

```typescript
import { init, shutdown } from 'autotel';

init({
  service: 'my-service',
  environment: 'production',
  endpoint: 'https://collector.example.com:4318',
  integrations: true,
  metrics: true, // Enabled by default; set false to disable
});

process.on('SIGTERM', shutdown);
```

Need to customize metric export intervals or swap exporters? Provide your own
`metricReader`, just like you would with vanilla OpenTelemetry:

```typescript
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';

const metricReader = new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter({
    url: 'https://collector.example.com:4318/v1/metrics',
  }),
  exportIntervalMillis: 60000,
});

init({
  service: 'my-service',
  endpoint: 'https://collector.example.com:4318',
  metricReader,
});
```

**What Changed:**

- Automatic exporter configuration (traces, metrics, logs)
- Automatic resource detection and merging
- Simplified shutdown (single function)
- Includes rate limiting, circuit breakers, tail sampling
- No manual exporter/reader instantiation

---

### Pattern 3: Manual Span Lifecycle

**Before**:

```typescript
import { trace } from '@opentelemetry/api';
import { SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('my-app');

async function createUser(data) {
  const span = tracer.startSpan('createUser', {
    attributes: {
      'user.email': data.email,
    },
  });

  try {
    span.setAttribute('user.id', data.id);

    const user = await db.users.create(data);

    span.setStatus({ code: SpanStatusCode.OK });
    return user;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
    span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}

// Calling the function
const user = await createUser({ email: 'user@example.com', id: '123' });
```

**After**:

```typescript
import { trace } from 'autotel';

// Factory pattern (receives context parameter)
const createUser = trace((ctx) => async (data) => {
  // Span automatically created with function name as operation
  ctx.setAttribute('user.email', data.email);
  ctx.setAttribute('user.id', data.id);

  const user = await db.users.create(data);

  return user;
  // Span automatically ended, errors automatically recorded
});

// Calling the function (same API)
const user = await createUser({ email: 'user@example.com', id: '123' });
```

**Alternative**: Direct pattern (when you don't need context)

```typescript
import { trace } from 'autotel';

// Direct pattern (no context needed)
const getUser = trace(async (id) => {
  return await db.users.findById(id);
});

// Autotel auto-detects the pattern and handles lifecycle
const user = await getUser('123');
```

**What Changed:**

- No manual `span.start()` / `span.end()`
- Automatic error handling (no try/catch needed for telemetry)
- No manual status codes
- Context propagation handled automatically
- Function name used as span name (customizable via `@operationName` decorator)


### Pattern 4: Logger Integration

**Before**:

```typescript
import pino from 'pino';
import { trace, context } from '@opentelemetry/api';

const logger = pino();

async function handleRequest(req) {
  const span = trace.getActiveSpan();
  const spanContext = span?.spanContext();

  logger.info(
    {
      traceId: spanContext?.traceId,
      spanId: spanContext?.spanId,
      traceFlags: spanContext?.traceFlags,
    },
    'Processing request',
  );

  // Business logic...
}
```

**After**:

```typescript
import { createLogger } from 'autotel/logger';
import { trace } from 'autotel';

const logger = createLogger({ name: 'my-service' });

const handleRequest = trace(async (req) => {
  // Trace context automatically added to every log
  logger.info('Processing request');

  // Business logic...
});
```

**Log Output** (automatic trace correlation):

```json
{
  "level": "info",
  "msg": "Processing request",
  "trace_id": "a1b2c3d4e5f6g7h8",
  "span_id": "1234567890abcdef",
  "trace_flags": "01"
}
```

**What Changed:**

- Automatic trace context injection
- No manual span context extraction
- Works with structured logging (JSON)
- Supports pino and winston


### Pattern 5: Custom Sampling

**Before**:

```typescript
import {
  TraceIdRatioBasedSampler,
  ParentBasedSampler,
} from '@opentelemetry/sdk-trace-base';

const sdk = new opentelemetry.NodeSDK({
  // Sample 10% of all requests
  sampler: new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(0.1),
  }),
  // ...
});
```

**Problem**: With head sampling, you lose 90% of error traces and slow requests.

**After**:

```typescript
import { AdaptiveSampler, init } from 'autotel';

init({
  service: 'my-service',
  endpoint: 'https://collector.example.com:4318',
  sampler: new AdaptiveSampler({
    baselineSampleRate: 0.1, // Sample 10% of normal requests
    slowThresholdMs: 1000, // >1s is "slow"
    alwaysSampleErrors: true, // Sample 100% of errors
    alwaysSampleSlow: true, // Sample 100% of slow requests
  }),
});
```

**Custom Sampler** (advanced):

```typescript
import { init, type Sampler, type SamplingContext } from 'autotel';

class CustomSampler implements Sampler {
  shouldSample(context: SamplingContext): boolean {
    const firstArg = context.args[0] as { user?: { authenticated?: boolean } };
    if (firstArg?.user?.authenticated) {
      return true;
    }
    return Math.random() < 0.05;
  }
}

init({
  service: 'my-service',
  sampler: new CustomSampler(),
});
```

**What Changed:**

- Tail sampling instead of head sampling
- Sampling decisions can consider operation success/failure and duration
- Never lose error traces or slow requests
- Dramatically better observability at the same cost

**Benefits:**

- Capture 100% of errors with only 10-20% of total volume
- Inspect function inputs (args/metadata) plus duration before deciding
- Adaptive sampling based on conditions


### Pattern 6: Metrics and Logs

**Before**:

```typescript
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('my-app');
const requestCounter = meter.createCounter('http.requests', {
  description: 'Total HTTP requests',
});

function handleRequest(req) {
  requestCounter.add(1, {
    method: req.method,
    route: req.route,
  });
}
```

**After**:

```typescript
import { createCounter } from 'autotel/metrics';

const requestCounter = createCounter('http.requests', {
  description: 'Total HTTP requests',
});

function handleRequest(req) {
  requestCounter.add(1, {
    method: req.method,
    route: req.route,
  });
}
```

**What Changed:**

- Simpler helper: `createCounter()` instead of `meter.createCounter()`
- Built-in helpers for common patterns
- Automatic meter registration

---

### Pattern 7: Prisma ORM Integration

**Before** (Vanilla Prisma OpenTelemetry - ~50 lines):

```typescript
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { PrismaInstrumentation, registerInstrumentations } from '@prisma/instrumentation'
import { resourceFromAttributes } from '@opentelemetry/resources'

// Configure the trace provider
const provider = new NodeTracerProvider({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'my-app',
    [ATTR_SERVICE_VERSION]: '1.0.0',
  }),
  spanProcessors: [
    new SimpleSpanProcessor(new OTLPTraceExporter()),
  ],
});

// Register Prisma instrumentations
registerInstrumentations({
  tracerProvider: provider,
  instrumentations: [new PrismaInstrumentation()],
})

// Register the provider globally
provider.register()

// Import Prisma AFTER instrumentation setup
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// Manual span management for business logic
import { trace } from '@opentelemetry/api';
const tracer = trace.getTracer('my-app');

async function createUser(email: string) {
  const span = tracer.startSpan('createUser');
  try {
    span.setAttribute('user.email', email);
    const user = await prisma.user.create({ data: { email } });
    span.end();
    return user;
  } catch (error) {
    span.recordException(error);
    span.end();
    throw error;
  }
}
```

**After** (Autotel - ~10 lines):

```typescript
import { init, trace } from 'autotel';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import { PrismaClient } from '@prisma/client';

// Single init call with PrismaInstrumentation
init({
  service: 'my-app',
  instrumentations: [new PrismaInstrumentation()],
});

const prisma = new PrismaClient();

// Functional API - automatic span lifecycle
const createUser = trace(ctx => async (email: string) => {
  ctx.setAttribute('user.email', email);
  return await prisma.user.create({ data: { email } });
});
```

**What You Get:**

Autotel automatically captures detailed Prisma spans:
- `prisma:client:operation` - Full Prisma operation (e.g., `User.create`)
- `prisma:client:serialize` - Query serialization time
- `prisma:engine:query` - Query engine execution
- `prisma:engine:connection` - Database connection time
- `prisma:engine:db_query` - Actual SQL query with details
- `prisma:engine:serialize` - Response serialization

**Example Trace Tree:**

```
createUser                           (your function)
  └─ prisma:client:operation         (User.create)
      ├─ prisma:client:serialize
      └─ prisma:engine:query
          ├─ prisma:engine:connection
          ├─ prisma:engine:db_query  (INSERT INTO User ...)
          └─ prisma:engine:serialize
```

**What Changed:**

- Reduced from ~50 lines to ~10 lines
- No manual `NodeTracerProvider` or `SimpleSpanProcessor` setup
- No manual `registerInstrumentations()` call
- Automatic span lifecycle (no try/catch for telemetry)
- Built-in tail sampling (10% baseline, 100% errors)
- Built-in rate limiting and circuit breakers
- Functional `trace()` API instead of manual span management

**Full Working Example:**

See [apps/example-prisma](../apps/example-prisma) for a complete example with:
- SQLite database setup
- User and Post models
- Nested queries and transactions
- Multiple database operations

**Run the example:**

```bash
cd apps/example-prisma
pnpm install
pnpm db:generate
pnpm db:push
pnpm start
```

---

### Pattern 8: Drizzle ORM Integration

**Before** (Manual OpenTelemetry Setup - ~60 lines):

```typescript
import { trace, SpanKind } from '@opentelemetry/api';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';

// Configure tracing
const provider = new NodeTracerProvider({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'my-app',
  }),
  spanProcessors: [new SimpleSpanProcessor(new OTLPTraceExporter())],
});
provider.register();

const tracer = trace.getTracer('my-app');

// Create database client
const client = createClient({ url: 'file:./dev.db' });
const db = drizzle({ client });

// Manually instrument every database operation
async function createUser(email: string) {
  const span = tracer.startSpan('db.insert', {
    kind: SpanKind.CLIENT,
    attributes: {
      'db.system': 'sqlite',
      'db.operation': 'INSERT',
    },
  });

  try {
    // Extract SQL for logging
    const query = db.insert(users).values({ email });
    // Note: Getting the actual SQL is difficult in Drizzle

    const result = await query.returning();

    span.setStatus({ code: 1 }); // OK
    return result;
  } catch (error) {
    span.setStatus({ code: 2, message: error.message }); // ERROR
    span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}
```

**After** (Autotel + Drizzle Plugin - ~10 lines):

```typescript
import { init, trace } from 'autotel';
import { instrumentDrizzleClient } from 'autotel-plugins/drizzle';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';

// Single init call
init({ service: 'my-app' });

// Create and instrument database client (one line!)
const client = createClient({ url: 'file:./dev.db' });
const db = instrumentDrizzleClient(drizzle({ client }), { dbSystem: 'sqlite' });

// Automatic tracing - SQL queries captured automatically!
const createUser = trace(ctx => async (email: string) => {
  ctx.setAttribute('user.email', email);
  return await db.insert(users).values({ email }).returning();
});
```

**What You Get:**

Autotel's Drizzle plugin automatically captures:
- `drizzle.insert` - INSERT operations
- `drizzle.select` - SELECT operations
- `drizzle.update` - UPDATE operations
- `drizzle.delete` - DELETE operations

Each span includes:
- **SQL statement** (the actual SQL query executed)
- **Database system** (sqlite, postgresql, mysql)
- **Operation type** (INSERT, SELECT, UPDATE, DELETE)
- **Database name** (if configured)
- **Connection details** (peer name, port)
- **Transaction markers** (for queries within transactions)

**Example Trace Tree:**

```
createUserWithPosts                  (your function)
  └─ createUser                      (your function)
      └─ drizzle.insert              (INSERT INTO users ...)
  └─ createPost                      (your function)
      └─ drizzle.insert              (INSERT INTO posts ...)
  └─ createPost                      (your function)
      └─ drizzle.insert              (INSERT INTO posts ...)
```

**Transaction Support:**

```typescript
// Transactions are automatically traced
const result = await db.transaction(async (tx) => {
  const [user] = await tx.insert(users).values({ email }).returning();
  // ↑ Span includes db.transaction: true

  const [post] = await tx.insert(posts).values({
    title: 'Hello',
    authorId: user.id
  }).returning();
  // ↑ Also marked with db.transaction: true

  return { user, post };
});
```

**What Changed:**

- Reduced from ~60 lines to ~10 lines (83% reduction!)
- No manual `NodeTracerProvider` or `SimpleSpanProcessor` setup
- No manual span management (no `startSpan()` / `end()`)
- **SQL queries automatically captured** (hard to do manually in Drizzle)
- Automatic error handling and status codes
- Built-in tail sampling (10% baseline, 100% errors)
- Transaction queries automatically marked
- Works with all Drizzle adapters (PostgreSQL, MySQL, SQLite, LibSQL)

**Supported Databases:**

The plugin works with all Drizzle-supported databases:

```typescript
// PostgreSQL
import { drizzle } from 'drizzle-orm/postgres-js';
const db = instrumentDrizzleClient(drizzle({ client }), {
  dbSystem: 'postgresql',
  peerName: 'db.example.com',
  peerPort: 5432,
});

// MySQL
import { drizzle } from 'drizzle-orm/mysql2';
const db = instrumentDrizzleClient(drizzle({ client }), {
  dbSystem: 'mysql',
});

// SQLite / LibSQL
import { drizzle } from 'drizzle-orm/libsql';
const db = instrumentDrizzleClient(drizzle({ client }), {
  dbSystem: 'sqlite',
});
```

**Full Working Example:**

See [apps/example-drizzle](../apps/example-drizzle) for a complete example with:
- SQLite database setup
- User and Post models
- Nested queries
- Transactions
- Multiple database operations

**Run the example:**

```bash
cd apps/example-drizzle
pnpm install
pnpm db:push
pnpm start
```

---

## Feature Mapping Reference

| OpenTelemetry API/SDK               | Autotel Equivalent  | Notes                       |
| ----------------------------------- | ----------------------- | --------------------------- |
| `new NodeSDK({...})`                | `init({...})`           | Simplified configuration    |
| `tracer.startSpan()` + `span.end()` | `trace(fn)`             | Automatic lifecycle         |
| `span.setAttribute()`               | `ctx.setAttribute()`    | Same API, different context |
| `span.setStatus()`                  | Automatic               | Based on exception/return   |
| `span.recordException()`            | Automatic               | All errors auto-recorded    |
| `ParentBasedSampler`                | `sampler: new AdaptiveSampler()` | Tail sampling instead       |
| `getNodeAutoInstrumentations()`     | `integrations: true`    | Same libraries instrumented |
| `sdk.shutdown()`                    | `shutdown()`            | Graceful shutdown           |
| Manual log correlation              | `autotel/logger`    | Built-in correlation        |
| Manual context propagation          | Automatic               | Works out of the box        |
| `OTEL_EXPORTER_OTLP_ENDPOINT`       | `endpoint`              | Config over env vars        |

---

## Advanced Migrations

### Migrating OpenTelemetry Collector Configuration

Your collector config **doesn't need to change**. Autotel uses standard OTLP protocol.

**Before** (collector config):

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: '0.0.0.0:4318'
exporters:
  awss3:
    s3uploader:
      region: us-east-1
      s3_bucket: my-telemetry-bucket
processors:
  batch:
    timeout: 10s
    send_batch_size: 32768
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [awss3]
```

**After**:

```typescript
import { init } from 'autotel';

init({
  service: 'my-service',
  endpoint: 'http://collector:4318', // Same OTLP endpoint
});
```

### Migrating Custom Instrumentations

**Before**:

```typescript
import { InstrumentationBase } from '@opentelemetry/instrumentation';

class MyCustomInstrumentation extends InstrumentationBase {
  init() {
    // Custom instrumentation logic
  }
}

const sdk = new NodeSDK({
  instrumentations: [
    getNodeAutoInstrumentations(),
    new MyCustomInstrumentation(),
  ],
});
```

**After**:

```typescript
import { init } from 'autotel';
import { registerInstrumentations } from '@opentelemetry/instrumentation';

init({
  service: 'my-service',
  integrations: true,
});

// Register custom instrumentations separately
registerInstrumentations({
  instrumentations: [new MyCustomInstrumentation()],
});
```

### Migrating Context Propagation

**Before**:

```typescript
import { context, trace } from '@opentelemetry/api';

const span = tracer.startSpan('parent');
const ctx = trace.setSpan(context.active(), span);

await context.with(ctx, async () => {
  // Child operations will inherit this context
  await doSomething();
});

span.end();
```

**After**:

```typescript
import { trace } from 'autotel';

const parent = trace(async () => {
  // Context propagation automatic
  await doSomething();
});

await parent();
```

Context propagation works automatically with `trace()`, `span()`, and `instrument()`.

### Testing Your Migration

**Before**:

```typescript
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
provider.register();

// Run tests
await myFunction();

// Assert on spans
const spans = exporter.getFinishedSpans();
expect(spans).toHaveLength(1);
```

**After**:

```typescript
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { init } from 'autotel';

const exporter = new InMemorySpanExporter();

init({
  service: 'test',
  spanExporter: exporter, // Use in-memory exporter for testing
});

await myFunction();

const spans = exporter.getFinishedSpans();
expect(spans).toHaveLength(1);
expect(spans[0].name).toBe('myFunction');
```

## Migration Checklist

Use this checklist for a smooth migration:

### Phase 1: Preparation

- [ ] Review current OpenTelemetry configuration (SDK setup, instrumentations, exporters)
- [ ] Identify custom instrumentations or span processors
- [ ] Note current sampling strategy (head vs. tail)
- [ ] Document custom attributes and context propagation patterns
- [ ] Check if using non-OTLP exporters (Jaeger, Zipkin)

### Phase 2: Installation

- [ ] Install autotel: `npm install autotel`
- [ ] Install adapters if needed: `npm install autotel-subscribers`
- [ ] For edge runtimes: `npm install autotel-edge`
- [ ] Keep/install auto-instrumentations: `npm install @opentelemetry/auto-instrumentations-node`

### Phase 3: Replace SDK Initialization

- [ ] Replace `NODE_OPTIONS` environment variable setup
- [ ] Replace `new NodeSDK({...})` with `init({...})`
- [ ] Migrate configuration options (service name, exporters, resource attributes)
- [ ] Enable auto-instrumentation: `integrations: true` (requires `@opentelemetry/auto-instrumentations-node`)
- [ ] Configure tail sampling (baseline, error, slow request rates)
- [ ] Replace `sdk.shutdown()` with `shutdown()` in process handlers

### Phase 4: Migrate Manual Spans

- [ ] Find all `tracer.startSpan()` + `span.end()` patterns
- [ ] Replace with `trace(fn)` functional wrapper
- [ ] Convert `span.setAttribute()` to `ctx.setAttribute()`
- [ ] Remove manual error handling for telemetry (keep business error handling)
- [ ] Test that span hierarchy is preserved

### Phase 5: Migrate Logging

- [ ] Replace manual trace context injection
- [ ] Use `createLogger()` from `autotel/logger`
- [ ] Verify trace/span IDs appear in log output
- [ ] Update log parsing/indexing if format changed

### Phase 6: Migrate Testing

- [ ] Replace test span exporters with `InMemorySpanExporter` from `@opentelemetry/sdk-trace-base`
- [ ] Update test assertions (span names, attributes)
- [ ] Verify context propagation in tests

### Phase 7: Validation

- [ ] Run full test suite
- [ ] Verify spans appear in your observability backend (Honeycomb, Datadog, etc.)
- [ ] Check span attributes match expectations
- [ ] Verify error spans are captured (trigger an error and check)
- [ ] Verify slow requests are captured (check tail sampling)
- [ ] Monitor for any missing instrumentations

### Phase 8: Deployment

- [ ] Deploy to staging environment first
- [ ] Monitor for increased/decreased span volume (tail sampling may change volume)
- [ ] Verify no performance regressions (rate limiting should prevent issues)
- [ ] Check error rates and success rates
- [ ] Gradually roll out to production (canary, blue/green, etc.)

### Phase 9: Optimization (Optional)

- [ ] Tune sampling rates based on actual traffic
- [ ] Configure rate limiting thresholds if needed
- [ ] Add custom samplers for specific use cases
- [ ] Enable PII redaction if handling sensitive data
- [ ] Configure circuit breaker thresholds

---

## Need Help?

- **Documentation**: [Main README](../README.md)
- **Examples**: See `apps/example-basic`, `apps/example-http`, `apps/cloudflare-example`
- **Issues**: [GitHub Issues](https://github.com/jagreehal/autotel/issues)
- **Questions**: Open a discussion on GitHub

---

## Appendix: Side-by-Side Comparison

### Full Stack Comparison

**Before** (vanilla OpenTelemetry):

```typescript
// File: instrumentation.ts (30+ lines)
const opentelemetry = require('@opentelemetry/sdk-node');
const {
  getNodeAutoInstrumentations,
} = require('@opentelemetry/auto-instrumentations-node');
const {
  OTLPTraceExporter,
} = require('@opentelemetry/exporter-trace-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

const resource = Resource.default().merge(
  new Resource({
    [ATTR_SERVICE_NAME]: 'my-service',
  }),
);

const sdk = new opentelemetry.NodeSDK({
  resource,
  traceExporter: new OTLPTraceExporter({
    url: 'http://collector:4318/v1/traces',
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

// File: user-service.ts (25+ lines for a single function)
import { trace } from '@opentelemetry/api';
import { SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('user-service');

async function createUser(data) {
  const span = tracer.startSpan('createUser');

  try {
    span.setAttribute('user.email', data.email);

    const user = await db.users.create(data);

    span.setStatus({ code: SpanStatusCode.OK });
    return user;
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}
```

**After** (autotel):

```typescript
// File: instrumentation.ts (5 lines)
import { init } from 'autotel';

init({
  service: 'my-service',
  endpoint: 'http://collector:4318',
  integrations: true,
});

// File: user-service.ts (7 lines)
import { trace } from 'autotel';

const createUser = trace((ctx) => async (data) => {
  ctx.setAttribute('user.email', data.email);
  return await db.users.create(data);
});
```
