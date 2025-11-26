# OpenTelemetry tracing with Autotel for Drizzle ORM

Autotel provides a simplified approach to setting up OpenTelemetry tracing for Drizzle ORM. This page shows you how to use autotel to reduce OpenTelemetry setup code while maintaining full control over instrumentation.

> **Note**: Autotel is a third-party package that wraps the standard OpenTelemetry SDK. It simplifies the setup process and produces the same trace output as manual OpenTelemetry setup.

## About autotel

> Write once, observe everywhere.

When you enable OpenTelemetry tracing for Drizzle following the standard approach, you need to configure multiple components: trace providers, exporters, span processors, and resource attributes. This can require a significant amount of setup code before you can start tracing Drizzle operations.

Autotel reduces this setup to a single `init()` function call while maintaining compatibility with the OpenTelemetry standard. You still get the same powerful tracing capabilities, but with less configuration code.

## Considerations and prerequisites

To use autotel with Drizzle, you must:

- Install the `autotel` package
- Install the `autotel-plugins` package
- Install `drizzle-orm` and the appropriate database driver (e.g., `pg`, `mysql2`, `@libsql/client`)
- Initialize autotel before creating your Drizzle client

> **Important**: The order in which you set up tracing matters. You must initialize autotel before creating the Drizzle client instance.

## Get started with autotel

This section explains how to install and configure autotel for Drizzle tracing.

### Step 1: Install dependencies

Install the required packages:

```bash
npm install autotel autotel-plugins drizzle-orm pg
npm install -D @types/pg
```

### Step 2: Initialize autotel and instrument the client

Initialize autotel and then use `instrumentDrizzleClient` to wrap your Drizzle instance:

```typescript
import { init } from 'autotel';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { instrumentDrizzleClient } from 'autotel-plugins/drizzle';

// Initialize autotel
init({
  service: 'my-app',
  endpoint: process.env.OTLP_ENDPOINT || 'http://localhost:4318',
});

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Create and instrument the Drizzle client
const db = instrumentDrizzleClient(
  drizzle({ client: pool }),
  {
    dbSystem: 'postgresql',
    dbName: 'myapp',
  }
);

// Your application code...
```

That's it. Drizzle operations are now traced and sent to your configured OTLP endpoint.

## What autotel configures

When you call `init()`, autotel automatically configures:

| Component | Manual Setup | Autotel Configuration |
|-----------|--------------|---------------------------|
| Resource attributes | `resourceFromAttributes()` with `ATTR_SERVICE_NAME`, `ATTR_SERVICE_VERSION` | Automatically configured from `service`, `version`, and `environment` options |
| Span processor | `SimpleSpanProcessor` or `BatchSpanProcessor` | `BatchSpanProcessor` in production, `SimpleSpanProcessor` in development |
| Trace exporter | `OTLPTraceExporter` | Configured from `endpoint` option |
| Sampling | Head sampling (sample before execution) | Tail sampling (sample after execution, 10% baseline, 100% errors) |
| Provider registration | `provider.register()` | Automatic |

All of these defaults can be overridden by passing custom configuration to `init()`.

## Comparison: Manual setup vs. autotel

The following examples show the difference in setup code between manual OpenTelemetry configuration and autotel.

### Manual OpenTelemetry setup

Following a standard OpenTelemetry approach, you would need to set up tracing manually:

```typescript
// Imports
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { Resource } from '@opentelemetry/resources'
import { trace } from '@opentelemetry/api'

// Configure the trace exporter
const otlpTraceExporter = new OTLPTraceExporter({
  url: process.env.OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
});

// Configure the trace provider
const provider = new NodeTracerProvider({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: 'my-app',
    [ATTR_SERVICE_VERSION]: '1.0.0',
  }),
});

// Add span processor
provider.addSpanProcessor(new BatchSpanProcessor(otlpTraceExporter));

// Register the provider globally
provider.register();

// Get tracer and manually instrument Drizzle
const tracer = trace.getTracer('drizzle-instrumentation');

// Then you'd need to manually wrap all Drizzle operations with spans...
// (This would require significant custom instrumentation code)
```

This approach requires approximately 30+ lines of setup code, plus custom instrumentation logic to wrap Drizzle operations.

### Autotel setup

The same configuration using autotel:

```typescript
import { init } from 'autotel';
import { instrumentDrizzleClient } from 'autotel-plugins/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

init({
  service: 'my-app',
  version: '1.0.0',
  endpoint: process.env.OTLP_ENDPOINT || 'http://localhost:4318',
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const db = instrumentDrizzleClient(
  drizzle({ client: pool }),
  { dbSystem: 'postgresql' }
);
```

This reduces the setup significantly while providing the same tracing functionality.

## Trace output

Autotel produces detailed trace output for Drizzle operations. For each query, a span is created with:

- **Span name**: `drizzle.{operation}` (e.g., `drizzle.select`, `drizzle.insert`, `drizzle.update`, `drizzle.delete`)
- **Attributes**:
  - `db.system`: Database type (e.g., "postgresql", "mysql", "sqlite")
  - `db.operation`: SQL operation (e.g., "SELECT", "INSERT")
  - `db.statement`: The full SQL query text
  - `db.name`: Database name (if configured)

For example, a `select` operation creates this span:

```
Span: drizzle.select
Attributes:
  - db.system: postgresql
  - db.operation: SELECT
  - db.statement: SELECT "id", "email", "name" FROM "users" WHERE "id" = $1
```

## How-tos

### Add manual tracing to your code

Autotel includes a `trace()` function for wrapping your application logic with tracing:

```typescript
import { trace } from 'autotel';
import { eq } from 'drizzle-orm';
import { users } from './schema';

export const getUser = trace(ctx => async (id: number) => {
  // Set custom attributes
  ctx.setAttribute('user.id', id);

  const user = await db.select().from(users).where(eq(users.id, id));

  // Access trace ID for log correlation
  console.log(`Trace ID: ${ctx.traceId}`);

  return user;
});
```

The `trace()` function automatically creates a span, manages its lifecycle, and provides access to the span context through `ctx`.

### Create nested spans

Nested `trace()` calls automatically create child spans:

```typescript
export const createUserAndPost = trace(ctx => async (
  email: string,
  name: string,
  postTitle: string
) => {
  ctx.setAttribute('user.email', email);

  // Child spans created automatically
  const user = await createUser(email, name);
  const post = await createPost(user.id, postTitle);

  return { user, post };
});
```

This creates a hierarchical trace structure:

```
createUserAndPost
  └─ createUser
      └─ drizzle.insert (INSERT INTO "users" ...)
  └─ createPost
      └─ drizzle.insert (INSERT INTO "posts" ...)
```

### Customize span processing

You can override the default span processor for environment-specific behavior:

```typescript
import { SimpleSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { init } from 'autotel';

init({
  service: 'my-app',
  // Use console exporter in development, OTLP in production
  spanProcessor: process.env.NODE_ENV === 'production'
    ? undefined  // Use default BatchSpanProcessor
    : new SimpleSpanProcessor(new ConsoleSpanExporter()),
});
```

### Configure sampling

Autotel uses tail sampling by default, which makes sampling decisions after operations complete. This ensures you capture 100% of errors and slow requests while sampling only a percentage of successful operations.

To customize sampling behavior:

```typescript
import { init, AdaptiveSampler } from 'autotel';

init({
  service: 'my-app',
  sampler: new AdaptiveSampler({
    baselineSampleRate: 0.1,    // Sample 10% of normal requests
    slowThresholdMs: 1000,       // Requests >1s are "slow"
    alwaysSampleErrors: true,    // Sample 100% of errors
    alwaysSampleSlow: true,      // Sample 100% of slow requests
  }),
});
```

This configuration samples:
- 10% of normal requests (baseline)
- 100% of requests that fail with an error
- 100% of requests that take longer than 1 second

## When to use autotel vs. manual setup

Choose **autotel** if:

- You want production-ready defaults without manual configuration
- You prefer concise setup code
- You want consistent tracing configuration across multiple services
- You want tail sampling for cost-effective observability

## What stays the same

Using autotel doesn't change:

- The Drizzle ORM you use
- The spans and trace structure Drizzle produces
- Your ability to add custom attributes and context
- Your choice of observability backend (Jaeger, Honeycomb, Datadog, etc.)
- Your ability to override any default configuration

Autotel is a convenience wrapper that reduces boilerplate while maintaining full OpenTelemetry compatibility.

## Troubleshooting

### My traces aren't showing up

Ensure you import your tracing configuration before creating the Drizzle client:

```typescript
// ✅ Correct order
import './tracing';  // First
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool });

// ❌ Incorrect order
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import './tracing';  // Too late - Pool already imported
```

Also verify that you're instrumenting the Drizzle instance:

```typescript
import { instrumentDrizzleClient } from 'autotel-plugins/drizzle';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool });
instrumentDrizzleClient(db, { dbSystem: 'postgresql' });  // Don't forget this!
```

### Traces work locally but not in production

Check that your `OTLP_ENDPOINT` environment variable is set correctly in your production environment:

```typescript
init({
  service: 'my-app',
  endpoint: process.env.OTLP_ENDPOINT || 'http://localhost:4318',
});
```

If `OTLP_ENDPOINT` is not set, traces will be sent to `localhost`, which won't work in production.

### Some queries aren't being traced

Make sure you're using the instrumented database instance consistently throughout your application. If you create multiple instances, each one needs to be instrumented:

```typescript
// ❌ Creating new uninstrumented instance
function someFunction() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const newDb = drizzle({ client: pool });  // Not instrumented!
  return newDb.select().from(users);
}

// ✅ Use the instrumented instance
import { db } from './db';  // Instrumented instance exported from centralized location

function someFunction() {
  return db.select().from(users);
}
```

### I see duplicate spans

This can happen if you instrument the same instance multiple times. The `instrumentDrizzleClient()` function is idempotent, but make sure you're not calling it on different references to the same underlying client:

```typescript
// ❌ Instrumenting multiple times
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool });
instrumentDrizzleClient(db);
instrumentDrizzleClient(db);  // Safe but unnecessary

// ✅ Instrument once
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool });
instrumentDrizzleClient(db, { dbSystem: 'postgresql' });
```

## Learn more

- [Full autotel documentation](https://github.com/jagreehal/autotel)
- [Migration guide from manual OpenTelemetry setup](https://github.com/jagreehal/autotel/blob/main/docs/MIGRATION.md)
- [Working Drizzle + autotel example](https://github.com/jagreehal/autotel/tree/main/apps/example-drizzle)
- [OpenTelemetry JavaScript documentation](https://opentelemetry.io/docs/languages/js/)
