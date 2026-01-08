# autotel-tanstack (TanStack Start)

OpenTelemetry instrumentation for TanStack Start applications.

## Your Role

You are working on the TanStack Start instrumentation package. You understand TanStack Start middleware patterns, server functions, route loaders, and W3C Trace Context propagation via headers.

## Tech Stack

- **Framework**: TanStack Start (React Start and Solid Start)
- **Runtime**: Node.js (server functions, loaders)
- **Bundle Size**: ~25KB total
- **Build**: tsup
- **Testing**: vitest (unit + integration)

## Key Concepts

- **Middleware-Based API**: Aligns with TanStack's middleware pattern for seamless integration
- **Server Function Tracing**: Automatic spans for `createServerFn()` calls with argument/result capture
- **Route Loader Tracing**: Trace `loader()` and `beforeLoad()` functions with route context
- **Handler Wrapper**: Wrap `createStartHandler()` for complete request tracing
- **Distributed Tracing**: W3C Trace Context propagation via headers (traceparent, tracestate, baggage)
- **Zero-Config Mode**: Just `import 'autotel-tanstack/auto'` to enable tracing

## Entry Points

- `autotel-tanstack` - Everything (convenience re-exports)
- `autotel-tanstack/auto` - Zero-config auto-instrumentation
- `autotel-tanstack/middleware` - Middleware integration
- `autotel-tanstack/server-functions` - Server function wrappers
- `autotel-tanstack/loaders` - Route loader instrumentation
- `autotel-tanstack/handlers` - Handler wrappers
- `autotel-tanstack/context` - Context propagation utilities
- `autotel-tanstack/testing` - Test utilities

## Commands

```bash
# In packages/autotel-tanstack directory
pnpm test               # Unit tests
pnpm test:integration   # Integration tests (requires TanStack Start)
pnpm build              # Build package
pnpm lint               # Lint package
```

## File Structure

- `src/index.ts` - Main exports
- `src/middleware.ts` - Middleware integration (tracingMiddleware)
- `src/server-functions.ts` - Server function wrappers (traceServerFn)
- `src/loaders.ts` - Route loader instrumentation (traceLoader)
- `src/handlers.ts` - Handler wrappers (wrapStartHandler)
- `src/context.ts` - Context propagation utilities (extract/inject from headers)
- `src/auto.ts` - Zero-config auto-instrumentation

## Code Patterns

### Middleware Approach (Recommended)

```typescript
import { tracingMiddleware } from 'autotel-tanstack/middleware';

export const startInstance = createStart(() => ({
  requestMiddleware: [tracingMiddleware()],
}));

// Server function middleware
export const getUser = createServerFn({ method: 'GET' })
  .middleware([tracingMiddleware({ type: 'function' })])
  .handler(async ({ data: id }) => {
    return await db.users.findUnique({ where: { id } });
  });
```

### Explicit Wrappers

```typescript
import { traceServerFn } from 'autotel-tanstack/server-functions';
import { traceLoader } from 'autotel-tanstack/loaders';

export const getUser = traceServerFn(
  createServerFn({ method: 'GET' }).handler(async ({ data }) => { ... }),
  { name: 'getUser' }
);

export const Route = createFileRoute('/users/$userId')({
  loader: traceLoader(async ({ params }) => { ... }),
});
```

### Handler Wrapper

```typescript
import { wrapStartHandler } from 'autotel-tanstack/handlers';

export default wrapStartHandler({
  service: 'my-app',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
})(createStartHandler(defaultStreamHandler));
```

### Zero-Config

```typescript
import 'autotel-tanstack/auto';
// Set OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS
```

## Span Attributes

- HTTP: `http.request.method`, `url.path`, `http.response.status_code`
- Server Functions: `rpc.method`, `tanstack.server_function.name`
- Loaders: `tanstack.loader.route_id`, `tanstack.loader.type`

## Boundaries

- ✅ **Always do**: Use middleware pattern, maintain framework compatibility, support both React and Solid Start
- ⚠️ **Ask first**: Changing middleware API, modifying context propagation
- 🚫 **Never do**: Break TanStack Start compatibility, use non-header context propagation

## Testing

- Unit tests: Mock TanStack Start APIs
- Integration tests: Use real TanStack Start (React Start and Solid Start)
- Test middleware, server functions, loaders, and handlers
- Test context propagation via headers

## Framework Support

Both TanStack React Start and Solid Start
