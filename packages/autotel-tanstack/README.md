# autotel-tanstack

OpenTelemetry instrumentation for TanStack Start applications. Automatic tracing for server functions, middleware, and route loaders.

## Features

- **Zero-Config Option** - Just import `autotel-tanstack/auto` and you're done
- **Framework-Aligned API** - Uses TanStack's middleware patterns
- **Full Coverage** - Server functions, loaders, beforeLoad, HTTP requests
- **Tree-Shakeable** - Only bundle what you use
- **Type-Safe** - Full TypeScript support
- **Vendor-Agnostic** - Works with any OTLP-compatible backend (Honeycomb, Datadog, Jaeger, etc.)

## Installation

```bash
npm install autotel-tanstack autotel
# or
pnpm add autotel-tanstack autotel
# or
yarn add autotel-tanstack autotel
```

## Quick Start

### Option 1: Zero-Config (Recommended)

```typescript
// app/start.ts (React) or app/start.ts (Solid)
import 'autotel-tanstack/auto';
import { createStart } from '@tanstack/react-start';

// Set env vars: OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT
export const startInstance = createStart(() => ({}));
```

### Option 2: Middleware-Based

```typescript
// app/start.ts
import { createStart } from '@tanstack/react-start';
import { tracingMiddleware } from 'autotel-tanstack/middleware';
import { init } from 'autotel';

// Initialize autotel
init({
  service: 'my-app',
  endpoint: 'https://api.honeycomb.io',
  headers: { 'x-honeycomb-team': process.env.HONEYCOMB_API_KEY },
});

export const startInstance = createStart(() => ({
  requestMiddleware: [tracingMiddleware()],
}));
```

### Option 3: Handler Wrapper (Full Control)

```typescript
// server.ts
import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server';
import { wrapStartHandler } from 'autotel-tanstack/handlers';

export default wrapStartHandler({
  service: 'my-app',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  headers: { 'x-honeycomb-team': process.env.HONEYCOMB_API_KEY },
})(createStartHandler(defaultStreamHandler));
```

## Usage

### Tracing Server Functions

```typescript
import { createServerFn } from '@tanstack/react-start';
import { functionTracingMiddleware } from 'autotel-tanstack/middleware';

// Using middleware (recommended)
export const getUser = createServerFn({ method: 'GET' })
  .middleware([functionTracingMiddleware()])
  .handler(async ({ data: id }) => {
    return await db.users.findUnique({ where: { id } });
  });

// Or using explicit wrapper
import { traceServerFn } from 'autotel-tanstack/server-functions';

const getUserBase = createServerFn({ method: 'GET' }).handler(
  async ({ data: id }) => {
    return await db.users.findUnique({ where: { id } });
  },
);

export const getUser = traceServerFn(getUserBase, { name: 'getUser' });
```

### Tracing Route Loaders

```typescript
import { createFileRoute } from '@tanstack/react-router';
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

### Using createTracedRoute Helper

```typescript
import { createFileRoute } from '@tanstack/react-router';
import { createTracedRoute } from 'autotel-tanstack/loaders';

const traced = createTracedRoute('/users/$userId');

export const Route = createFileRoute('/users/$userId')({
  beforeLoad: traced.beforeLoad(async ({ context }) => {
    // Auth check
  }),
  loader: traced.loader(async ({ params }) => {
    return await getUser(params.userId);
  }),
});
```

## Configuration

### Middleware Configuration

```typescript
import { createTracingMiddleware } from 'autotel-tanstack/middleware';

const middleware = createTracingMiddleware({
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

### Handler Configuration

```typescript
import { wrapStartHandler } from 'autotel-tanstack/handlers';

const handler = wrapStartHandler({
  // Service name (default: OTEL_SERVICE_NAME or 'tanstack-start')
  service: 'my-app',

  // OTLP endpoint (default: OTEL_EXPORTER_OTLP_ENDPOINT)
  endpoint: 'https://api.honeycomb.io',

  // OTLP headers (default: parsed from OTEL_EXPORTER_OTLP_HEADERS)
  headers: { 'x-honeycomb-team': 'YOUR_API_KEY' },

  // All middleware config options also available
  captureHeaders: ['x-request-id'],
  excludePaths: ['/health'],
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

## Testing

```typescript
import { describe, it, beforeEach, afterEach } from 'vitest';
import { createTestHarness } from 'autotel-tanstack/testing';

describe('MyServerFunction', () => {
  let harness: ReturnType<typeof createTestHarness>;

  beforeEach(() => {
    harness = createTestHarness();
  });

  afterEach(() => {
    harness.reset();
  });

  it('should trace the server function', async () => {
    await myServerFunction({ id: '123' });

    harness.assertServerFnTraced('myServerFunction');
    harness.assertSpanHasAttribute(
      /tanstack\.serverFn/,
      'tanstack.server_function.name',
      'myServerFunction',
    );
  });
});
```

### Mock Utilities

```typescript
import {
  createMockRequest,
  generateTraceparent,
} from 'autotel-tanstack/testing';

// Create mock request
const request = createMockRequest('GET', '/api/users', {
  headers: { 'x-request-id': 'test-123' },
  traceparent: generateTraceparent(),
});
```

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

## Supported Frameworks

- **@tanstack/react-start** ^1.139.14
- **@tanstack/solid-start** ^1.139.14

## License

MIT
