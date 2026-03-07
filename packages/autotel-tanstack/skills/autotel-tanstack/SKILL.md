---
name: autotel-tanstack
description: >
  OpenTelemetry for TanStack Start. Trace server functions, route loaders, middleware, and request handlers. Supports zero-config, middleware-based, and explicit wrapper patterns.
type: integration
library: autotel-tanstack
library_version: '1.12.0'
sources:
  - jagreehal/autotel:packages/autotel-tanstack/CLAUDE.md
---

# autotel-tanstack

OpenTelemetry instrumentation for TanStack Start (React Start and Solid Start).

## Quick Start — pick one approach

### Zero-config

```typescript
import 'autotel-tanstack/auto';
// Set env: OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS
```

### Middleware (recommended)

```typescript
import { tracingMiddleware } from 'autotel-tanstack/middleware';

// Request-level tracing
export const startInstance = createStart(() => ({
  requestMiddleware: [tracingMiddleware()],
}));

// Server function tracing
export const getUser = createServerFn({ method: 'GET' })
  .middleware([tracingMiddleware({ type: 'function' })])
  .handler(async ({ data: id }) => db.users.findUnique({ where: { id } }));
```

### Explicit wrappers

```typescript
import { traceServerFn } from 'autotel-tanstack/server-functions';
import { traceLoader } from 'autotel-tanstack/loaders';
import { wrapStartHandler } from 'autotel-tanstack/handlers';

// Server function
export const getUser = traceServerFn(
  createServerFn({ method: 'GET' }).handler(async ({ data }) => { ... }),
  { name: 'getUser', captureArgs: true },
);

// Route loader
export const Route = createFileRoute('/users/$userId')({
  loader: traceLoader(async ({ params }) => {
    return db.users.findUnique({ where: { id: params.userId } });
  }),
});

// Request handler
export default wrapStartHandler({
  service: 'my-app',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
})(createStartHandler(defaultStreamHandler));
```

## Configuration Options

```typescript
tracingMiddleware({
  captureHeaders: ['x-request-id'], // Request headers to capture
  captureArgs: true, // Capture server function arguments
  captureResults: false, // Capture return values
  captureParams: true, // Capture route params
  excludePaths: ['/health', /^\/api\/internal/],
  sampling: 'adaptive', // 'adaptive' | 'always' | 'never'
  customAttributes: (ctx) => ({ 'app.tenant': ctx.tenant }),
});
```

## Entry Points (tree-shaking)

| Import                              | What                      |
| ----------------------------------- | ------------------------- |
| `autotel-tanstack`                  | Everything                |
| `autotel-tanstack/auto`             | Zero-config               |
| `autotel-tanstack/middleware`       | Middleware only           |
| `autotel-tanstack/server-functions` | Server function wrappers  |
| `autotel-tanstack/loaders`          | Loader wrappers           |
| `autotel-tanstack/handlers`         | Handler wrappers          |
| `autotel-tanstack/context`          | Trace context propagation |

## Common Mistakes

- Do NOT use `tracingMiddleware()` in browser — it no-ops. Server functions run server-side only.
- Do NOT forget to wrap the start handler — without it, there's no root span for requests.
- Use `captureArgs: true` carefully — it serializes function arguments into span attributes. Avoid for large payloads.
- Prefer middleware over explicit wrappers — middleware composes with TanStack's built-in patterns.
