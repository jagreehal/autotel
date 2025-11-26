# Prisma + Autotel Example

This example demonstrates how to use autotel with Prisma ORM for automatic OpenTelemetry tracing.

## Features

- ✅ **Minimal Setup**: Just 5 lines to configure OpenTelemetry with Prisma
- 🔍 **Automatic Tracing**: Every Prisma query is automatically instrumented
- 📊 **Detailed Spans**: See query execution time, connection time, and more
- 🎯 **Functional API**: Use `trace()` to wrap your database operations
- 🚀 **Production Ready**: Built-in tail sampling, rate limiting, circuit breakers

## Setup

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Generate Prisma Client**:
   ```bash
   pnpm db:generate
   ```

3. **Push database schema** (creates SQLite database):
   ```bash
   pnpm db:push
   ```

4. **Run the example**:
   ```bash
   pnpm start
   ```

## What You Get

### Automatic Prisma Instrumentation

Every Prisma operation automatically creates detailed OpenTelemetry spans:

- `prisma:client:operation` - The full Prisma Client operation
- `prisma:client:serialize` - Query serialization time
- `prisma:engine:query` - Query engine execution time
- `prisma:engine:connection` - Database connection time
- `prisma:engine:db_query` - Actual SQL query execution (with query details!)

### Example Trace Structure

```
createUserWithPosts
  └─ createUser
      └─ prisma:client:operation (User.create)
          ├─ prisma:client:serialize
          └─ prisma:engine:query
              ├─ prisma:engine:connection
              ├─ prisma:engine:db_query (INSERT INTO User ...)
              └─ prisma:engine:serialize
  └─ createPost
      └─ prisma:client:operation (Post.create)
          ├─ prisma:client:serialize
          └─ prisma:engine:query
              ├─ prisma:engine:connection
              ├─ prisma:engine:db_query (INSERT INTO Post ...)
              └─ prisma:engine:serialize
```

## Minimal Code

### Before (Vanilla OpenTelemetry)

```typescript
// 30+ lines of boilerplate
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
// ... many more imports

const traceExporter = new OTLPTraceExporter({
  url: 'http://localhost:4318/v1/traces',
});

const sdk = new NodeSDK({
  traceExporter,
  // ... complex configuration
});

sdk.start();

registerInstrumentations({
  instrumentations: [new PrismaInstrumentation()],
});
```

### After (Autotel)

```typescript
// Just 5 lines!
import { init } from 'autotel';
import { PrismaInstrumentation } from '@prisma/instrumentation';

init({
  service: 'my-app',
  instrumentations: [new PrismaInstrumentation()],
});
```

## Viewing Traces

### Local Development (Jaeger)

Run Jaeger locally:

```bash
docker run --rm --name jaeger -d \
  -e COLLECTOR_OTLP_ENABLED=true \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

Then open http://localhost:16686 to view traces.

### Production (Honeycomb, Datadog, etc.)

Just change the endpoint:

```typescript
init({
  service: 'my-app',
  endpoint: 'https://api.honeycomb.io',
  otlpHeaders: { 'x-honeycomb-team': process.env.HONEYCOMB_API_KEY },
  instrumentations: [new PrismaInstrumentation()],
});
```

## Learn More

- [Autotel Documentation](../../packages/autotel/README.md)
- [Prisma OpenTelemetry Docs](https://www.prisma.io/docs/orm/prisma-client/observability-and-logging/opentelemetry-tracing)
- [Migration Guide](../../docs/MIGRATION.md#migrating-from-vanilla-prisma-opentelemetry)
