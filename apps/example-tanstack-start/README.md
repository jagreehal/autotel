# TanStack Start + Autotel Example

Interactive demo of OpenTelemetry observability for TanStack Start.

## Try It

```bash
pnpm install
pnpm dev
# Open http://localhost:3000
# Click "Try It Live" → Playground
# Spans appear in the server terminal (pretty-printed in dev when no OTLP endpoint is set)
```

Optional: copy `.env.example` to `.env` and set `OTEL_*` or `AUTOTEL_DEBUG` as needed.

## Quick Start

### Initialize autotel and add tracing middleware (TanStack Start entry point)

```typescript
// start.ts
import { createMiddleware, createStart } from '@tanstack/react-start'
import { createTracingServerHandler } from 'autotel-tanstack/middleware'

import './instrumentation'

const requestTracingMiddleware = createMiddleware().server(
  createTracingServerHandler({
    captureHeaders: ['x-request-id', 'user-agent'],
    excludePaths: ['/health', '/healthz', '/ready', '/metrics', '/_ping'],
  }),
)

const functionTracingMiddleware = createMiddleware({ type: 'function' }).server(
  createTracingServerHandler({
    type: 'function',
    captureArgs: true,
  }),
)

export const startInstance = createStart(() => ({
  requestMiddleware: [requestTracingMiddleware],
  functionMiddleware: [functionTracingMiddleware],
}))
```

The `instrumentation.ts` file pulls in `autotel-tanstack/auto`, which in turn
calls `autotel.init()` using the standard `OTEL_*` env vars. **In development
with no OTLP endpoint, spans are logged to the server console by default**
(colorized). Set `AUTOTEL_DEBUG=pretty` or `AUTOTEL_DEBUG=true` to force console
output; set `AUTOTEL_DEBUG=false` to disable it.

That's it for basic request and server-function tracing. The middleware works with autotel-tanstack's browser stubs, so no build issues.

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
