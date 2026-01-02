# TanStack Start + Autotel Example

Interactive demo of OpenTelemetry observability for TanStack Start.

## Try It

```bash
pnpm install
pnpm dev
# Open http://localhost:3000
# Click "Try It Live" → Playground
```

## Quick Start

### Initialize autotel once

```typescript
// router.tsx
import './instrumentation'
```

The `instrumentation.ts` file pulls in `autotel-tanstack/auto`, which in turn
calls `autotel.init()` using the standard `OTEL_*` env vars. During development,
set `AUTOTEL_DEBUG=true` (or leave `OTEL_EXPORTER_OTLP_ENDPOINT` empty) to log
spans directly to the console.

### Add tracing middleware to router

```typescript
// router.tsx
import { createRouter } from '@tanstack/react-router'
import { tracingMiddleware } from 'autotel-tanstack/middleware'

export const getRouter = () => {
  return createRouter({
    routeTree,
    requestMiddleware: [tracingMiddleware()],
  })
}
```

That's it for basic request tracing. The middleware works with autotel-tanstack's browser stubs, so no build issues.

## Copy-Paste Examples

### Trace a Server Function

```typescript
import { createServerFn } from '@tanstack/react-start'
import { traceServerFn } from 'autotel-tanstack/server-functions'

const getUser = traceServerFn(
  createServerFn({ method: 'GET' }).handler(async ({ data: id }) => {
    return await db.users.findUnique({ where: { id } })
  }),
  { name: 'getUser' },
)
```

### Trace a Route Loader

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { traceLoader } from 'autotel-tanstack/loaders'

export const Route = createFileRoute('/users/$userId')({
  loader: traceLoader(async ({ params }) => {
    return await getUser(params.userId)
  }),
})
```

### Trace beforeLoad (Auth Checks)

```typescript
import { traceBeforeLoad } from 'autotel-tanstack/loaders'
import { redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard')({
  beforeLoad: traceBeforeLoad(async ({ context }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: '/login' })
    }
  }),
})
```

### Distributed Tracing (Context Propagation)

```typescript
import { createTracedHeaders } from 'autotel-tanstack/context'

// When calling external APIs, pass traced headers
const response = await fetch('https://api.example.com/data', {
  headers: createTracedHeaders(),
})
```

### Error Reporting

```typescript
import { withErrorReporting } from 'autotel-tanstack'

const riskyOperation = createServerFn({ method: 'POST' }).handler(
  withErrorReporting(
    async ({ data }) => {
      // If this throws, error is captured and reported
      return await processData(data)
    },
    { operation: 'riskyOperation' },
  ),
)
```

## Interactive Demos

| Route                      | What It Shows                          |
| -------------------------- | -------------------------------------- |
| `/demo/playground`         | Click buttons, see traces in console   |
| `/demo/start/server-funcs` | Todo list with traced server functions |
| `/demo/tanstack-query`     | React Query with traced API calls      |
| `/demo/start/api-request`  | API request with timing metrics        |
| `/demo/before-load`        | Auth checks with tracing               |

## Production Setup

For production with full OTel export, initialize autotel via environment:

```bash
OTEL_SERVICE_NAME=my-app
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=YOUR_KEY
```

Or create an instrumentation file and import it at server startup:

```typescript
// instrumentation.ts
import { init } from 'autotel'

init({
  service: 'my-app',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  headers: {
    'x-honeycomb-team': process.env.HONEYCOMB_API_KEY,
  },
})
```

## Learn More

- [autotel-tanstack docs](https://github.com/jagreehal/autotel/tree/main/packages/autotel-tanstack)
- [TanStack Start docs](https://tanstack.com/start)
- [OpenTelemetry](https://opentelemetry.io)
