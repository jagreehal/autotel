---
name: autotel-tanstack
description: >
  Use this skill when instrumenting TanStack Start with OpenTelemetry — tracing server functions, route loaders, middleware, and request handlers via the zero-config, middleware, or explicit-wrapper patterns, plus W3C trace-context propagation to downstream services.
---

# autotel-tanstack

OpenTelemetry instrumentation for TanStack Start (React Start and Solid Start).

## Quick Start: pick one approach

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

## Init: `instrument()`

`instrument(options)` wraps autotel's `init` with the TanStack defaults. Import the module that calls it from `start.ts` so it runs before the first request:

```typescript
// src/instrumentation.ts (server only)
import { instrument } from 'autotel-tanstack';
instrument({
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  subscribers: [],
  logs: true,
  canonicalLogLines: { enabled: true, rootSpansOnly: true },
});

// src/start.ts
import './instrumentation';
```

- **Idempotent.** A second call is a no-op, and Vite HMR does not re-run the first one. A change to `instrument()` options (a new subscriber, `baggage`) needs the dev server restarted, not the file saved.
- **`E2E=1`** swaps the OTLP exporter for an `InMemorySpanExporter` on `globalThis.__testSpanExporter`, which `createTestSpansHandlers()` from `autotel-tanstack/testing` serves as a `GET`/`DELETE /api/test-spans` route. Playwright's `webServer` must start the app with `E2E=1`; with `reuseExistingServer`, a plain dev server already on that port is reused and the route falls through.
- Service name defaults to `OTEL_SERVICE_NAME`; `debug` to `AUTOTEL_DEBUG`, pretty-printing in development when there is no endpoint.

## Bundling: externalize `autotel` for the server only

```typescript
// vite.config.ts
export default defineConfig({
  environments: {
    ssr: {
      build: {
        rollupOptions: {
          external: (id) => id === 'autotel' || id.startsWith('autotel/'),
        },
      },
    },
  },
});
```

A top-level `build.rollupOptions.external` applies to the client build too, where an external is left as a bare specifier the browser cannot resolve, so hydration fails only in the production build. Browser-safe subpaths (`autotel/feature-flags`, which `autotel-posthog` imports) must be bundled on the client.

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

- Do NOT use `tracingMiddleware()` in browser: it no-ops. Server functions run server-side only.
- Do NOT forget to wrap the start handler: without it, there's no root span for requests.
- Use `captureArgs: true` carefully: it serializes function arguments into span attributes. Avoid for large payloads.
- Prefer middleware over explicit wrappers: middleware composes with TanStack's built-in patterns.
- Do NOT externalize `autotel` at the top level of `build.rollupOptions`: scope it to `environments.ssr`, or the client bundle ships bare `autotel/*` specifiers.
- Do NOT expect an `instrument()` change to apply on HMR: `init` runs once per process; restart the dev server.
- Do NOT run Playwright against an already-running dev server when specs read `/api/test-spans`: only a server started with `E2E=1` has the in-memory exporter.
