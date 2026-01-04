# autotel-tanstack

OpenTelemetry instrumentation for TanStack Start applications. Automatic tracing for server functions, middleware, and route loaders using TanStack's native patterns.

## Features

- **TanStack-Native** - Uses `createMiddleware().server()` builder pattern
- **Zero Boilerplate** - Global middleware traces all server functions automatically
- **Full Coverage** - Server functions, loaders, beforeLoad, HTTP requests
- **Tree-Shakeable** - Only bundle what you use
- **Type-Safe** - Full TypeScript support
- **Vendor-Agnostic** - Works with any OTLP-compatible backend (Honeycomb, Datadog, Jaeger, etc.)

## Installation

```bash
npm install autotel-tanstack autotel
# or
pnpm add autotel-tanstack autotel
```

## Quick Start

### TanStack-Native Setup (Recommended)

Configure global middleware in `start.ts` using TanStack's native patterns:

```typescript
// src/start.ts
import { createStart, createMiddleware } from '@tanstack/react-start';
import { createTracingServerHandler } from 'autotel-tanstack/middleware';
import './instrumentation'; // Initialize autotel

// Global request tracing middleware
const requestTracingMiddleware = createMiddleware().server(
  createTracingServerHandler({
    captureHeaders: ['x-request-id', 'user-agent'],
    excludePaths: ['/health', '/metrics'],
  }),
);

// Global server function tracing middleware
const functionTracingMiddleware = createMiddleware({ type: 'function' }).server(
  createTracingServerHandler({
    type: 'function',
    captureArgs: true,
  }),
);

export const startInstance = createStart(() => ({
  requestMiddleware: [requestTracingMiddleware],
  functionMiddleware: [functionTracingMiddleware],
}));
```

```typescript
// src/instrumentation.ts
import { init } from 'autotel';

init({
  service: 'my-app',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
```

That's it! All server functions and requests are now automatically traced.

### Zero-Config Alternative

For quick setup using environment variables:

```typescript
// src/start.ts
import 'autotel-tanstack/auto';
import { createStart } from '@tanstack/react-start';

// Set env vars: OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT
export const startInstance = createStart(() => ({}));
```

## Usage

### Server Functions (Auto-Traced)

With global `functionMiddleware` configured in `start.ts`, server functions are automatically traced:

```typescript
import { createServerFn } from '@tanstack/react-start';

// Automatically traced - no middleware needed per-function!
export const getUser = createServerFn({ method: 'GET' }).handler(
  async ({ data: id }) => {
    return await db.users.findUnique({ where: { id } });
  },
);

export const createUser = createServerFn({ method: 'POST' })
  .inputValidator((d: UserInput) => d)
  .handler(async ({ data }) => {
    return await db.users.create({ data });
  });
```

### Per-Function Middleware (When Needed)

For function-specific middleware, use TanStack's `.middleware()` chaining:

```typescript
import { createServerFn, createMiddleware } from '@tanstack/react-start';
import { createTracingServerHandler } from 'autotel-tanstack/middleware';

// Custom middleware for this function only
const customTracing = createMiddleware({ type: 'function' }).server(
  createTracingServerHandler({
    type: 'function',
    captureArgs: true,
    captureResults: true, // Capture results for this specific function
  }),
);

export const sensitiveOperation = createServerFn({ method: 'POST' })
  .middleware([customTracing])
  .handler(async ({ data }) => {
    // ...
  });
```

### Route Loaders

Use `traceLoader` and `traceBeforeLoad` for route-level tracing:

```typescript
import { createFileRoute, redirect } from '@tanstack/react-router';
import { traceLoader, traceBeforeLoad } from 'autotel-tanstack/loaders';

export const Route = createFileRoute('/users/$userId')({
  beforeLoad: traceBeforeLoad(async ({ context }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: '/login' });
    }
  }),
  loader: traceLoader(async ({ params }) => {
    return await getUser(params.userId);
  }),
});
```

## Configuration

### createTracingServerHandler Options

```typescript
import { createTracingServerHandler } from 'autotel-tanstack/middleware';

const handler = createTracingServerHandler({
  // Type: 'request' for global middleware, 'function' for server functions
  type: 'request',

  // Headers to capture as span attributes
  captureHeaders: ['x-request-id', 'user-agent'],

  // Whether to capture function arguments (default: true)
  captureArgs: true,

  // Whether to capture function results (default: false - PII concern)
  captureResults: false,

  // Paths to exclude from tracing
  excludePaths: ['/health', '/metrics', '/api/internal/*'],

  // Sampling strategy: 'always' | 'adaptive' | 'never'
  sampling: 'adaptive',

  // Custom attributes function
  customAttributes: ({ type, name, request }) => ({
    'custom.attribute': 'value',
  }),
});
```

## Environment Variables

| Variable                      | Description                        | Example                     |
| ----------------------------- | ---------------------------------- | --------------------------- |
| `OTEL_SERVICE_NAME`           | Service name for spans             | `my-app`                    |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP collector URL                 | `https://api.honeycomb.io`  |
| `OTEL_EXPORTER_OTLP_HEADERS`  | Auth headers (key=value,key=value) | `x-honeycomb-team=YOUR_KEY` |
| `AUTOTEL_DEBUG`               | Enable debug logging               | `true`                      |

## Span Attributes

### HTTP Request Spans

- `http.request.method` - GET, POST, etc.
- `url.path` - Request path
- `url.query` - Query string
- `http.response.status_code` - Response status
- `tanstack.request.duration_ms` - Request duration

### Server Function Spans

- `rpc.system` - "tanstack-start"
- `rpc.method` - Function name
- `tanstack.server_function.name` - Function name
- `tanstack.server_function.method` - HTTP method
- `tanstack.server_function.args` - Serialized arguments (if enabled)

### Loader Spans

- `tanstack.loader.route_id` - Route identifier
- `tanstack.loader.type` - "loader" or "beforeLoad"
- `tanstack.loader.params` - Route params (if enabled)

## Context Propagation

For distributed tracing across services:

```typescript
import {
  createTracedHeaders,
  extractContextFromRequest,
} from 'autotel-tanstack/context';

// Outgoing requests - inject trace context
const headers = createTracedHeaders({ 'Content-Type': 'application/json' });
await fetch('https://api.example.com', { headers, method: 'POST', body });

// Incoming requests - extract parent context
const parentContext = extractContextFromRequest(request);
```

## Testing

```typescript
import { describe, it, expect } from 'vitest';
import { createTestCollector } from 'autotel-tanstack/testing';

describe('MyServerFunction', () => {
  it('should trace the server function', async () => {
    const collector = createTestCollector();

    await myServerFunction({ id: '123' });

    const spans = collector.getSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toContain('myServerFunction');
  });
});
```

## Supported Frameworks

- **@tanstack/react-start** ^1.139.14
- **@tanstack/solid-start** ^1.139.14

## License

MIT
