---
name: autotel-api-surface
description: >
  Complete autotel API reference: trace(), span(), instrument(), getRequestLogger(), createStructuredError(),
  parseError(), track(), init(). Import paths, function signatures, factory vs direct pattern, name inference.
  Use as the primary reference when writing autotel code.
---

# Autotel API Surface

Complete API reference for autotel's functional instrumentation library.

## Purpose

Canonical reference for all public autotel APIs, their signatures, import paths, and usage patterns. Use this when writing or reviewing code that uses autotel.

## When to Use

- Writing new instrumented code
- Choosing between trace/span/instrument
- Looking up function signatures or import paths
- Understanding configuration options

## Core API

All from `import { ... } from 'autotel'` unless noted.

### trace(fn) / trace(name, fn)

Wraps a function with an automatic span. The span starts when the function is called and ends when it returns (or throws).

**Direct pattern** (no span context needed):
```typescript
import { trace } from 'autotel';

export const getUser = trace(async (id: string) => {
  return await db.users.findById(id);
});
```

**Factory pattern** (access span context to set attributes):
```typescript
export const postCheckout = trace((ctx) => async (req: Request) => {
  ctx.setAttribute('user.id', req.userId);
  return await processCheckout(req.body);
});
```

**Explicit name** (override name inference):
```typescript
export const handler = trace('checkout', async (req: Request) => {
  return await processCheckout(req.body);
});
```

**Name inference rules** (highest to lowest priority):
1. Explicit name passed to `trace('name', fn)` or `instrument({ key: 'name' })`
2. Named function: `trace(async function getUser() { ... })` → `getUser`
3. Const/let/var assignment: `const getUser = trace(async () => { ... })` → `getUser`
4. Factory function name: `trace((ctx) => async function getUser() { ... })` → `getUser`
5. Fallback: `anonymous`

### span(name, fn)

Like `trace()` but always requires an explicit name. Useful for inline spans.

```typescript
import { span } from 'autotel';

const result = await span('validate-cart', async () => {
  return validateCartItems(cart);
});
```

### instrument({ key, fn })

Like `trace()` with an explicit key for naming. Useful when you want the span name decoupled from the variable name.

```typescript
import { instrument } from 'autotel';

export const handler = instrument({
  key: 'checkout.process',
  fn: async (data: CheckoutData) => {
    return await processCheckout(data);
  },
});
```

### getRequestLogger(ctx?)

Returns a request-scoped logger that accumulates attributes and events on the active span. Emits one coherent snapshot per request.

**Requires an active span** — call inside a `trace()` wrapper or after framework middleware creates a span.

```typescript
import { trace, getRequestLogger } from 'autotel';

export const handler = trace((ctx) => async (req) => {
  const log = getRequestLogger(ctx);

  // Set attributes (accumulated, not emitted yet)
  log.set({ user: { id: user.id } });
  log.set({ cart: { items: cart.items.length } });

  // Log events (timestamped)
  log.info('Checkout started');
  log.warn('Inventory low', { sku: item.sku });
  log.error(caughtError);

  // Emit the snapshot (all attributes + events in one go)
  log.emitNow();
});
```

When framework middleware creates the span (Hono `otel()`, TanStack `tracingMiddleware()`), call with no args:
```typescript
const log = getRequestLogger(); // uses active span from AsyncLocalStorage
```

**Methods:**
- `.set(attributes)` — merge attributes into the snapshot (nested objects OK)
- `.info(message, attributes?)` — add an info-level log event
- `.warn(message, attributes?)` — add a warning-level log event
- `.error(error | message, attributes?)` — add an error-level log event
- `.emitNow()` — flush the snapshot (all attributes + events) as a span event

### createStructuredError(options)

Creates an Error with structured fields for machine-parseable diagnostics.

```typescript
import { createStructuredError } from 'autotel';

throw createStructuredError({
  message: 'Payment failed',           // Required — human-readable
  status: 402,                          // HTTP status code
  why: 'Card declined by issuer',       // Why it happened
  fix: 'Try a different payment method', // How to fix
  link: 'https://docs.example.com/pay', // Docs URL
  code: 'PAYMENT_DECLINED',            // Custom error code
  cause: originalError,                 // Error chain
});
```

### parseError(caught)

Extracts structured fields from any caught error (works with autotel errors, plain objects, strings, Errors).

```typescript
import { parseError } from 'autotel';

const error = parseError(caught);
// Returns: { message, status?, why?, fix?, link?, raw }
```

### recordStructuredError(ctx, error)

Records a structured error on the current span without throwing.

```typescript
import { recordStructuredError } from 'autotel';

try {
  await riskyOperation();
} catch (err) {
  recordStructuredError(ctx, err);
  // continue execution
}
```

### track(name, attributes)

Sends a product/analytics event to all registered subscribers. Automatically enriched with traceId and spanId.

```typescript
import { track } from 'autotel';

track('order.completed', {
  orderId: result.id,
  amount: total,
  userId: user.id,
});
```

Events are batched and delivered asynchronously. Call `getEventQueue()?.flush()` before process exit in serverless/scripts.

### init(config)

One-time SDK initialization. Must be called before any tracing. **Synchronous.**

```typescript
import { init } from 'autotel';

init({
  service: 'my-api',
  endpoint: 'http://localhost:4318',
  // ... see Configuration section
});
```

## Configuration

### init() Options

```typescript
init({
  service: string,                    // Service name (or OTEL_SERVICE_NAME)
  endpoint?: string,                  // OTLP endpoint (or OTEL_EXPORTER_OTLP_ENDPOINT)
  protocol?: 'http' | 'grpc',        // Export protocol (or OTEL_EXPORTER_OTLP_PROTOCOL)
  headers?: Record<string, string>,   // Auth headers (or OTEL_EXPORTER_OTLP_HEADERS)
  resourceAttributes?: Record<string, string>, // Custom resource attributes
  debug?: boolean,                    // Enable debug logging
  integrations?: string[],           // Auto-instrumentations to enable
  events?: {
    includeTraceContext?: boolean,    // Add traceId/spanId to events
    traceUrl?: string,               // Template for trace URL in events
  },
});
```

### Configuration Precedence (highest to lowest)

1. **Explicit `init()` parameters** — code config
2. **YAML file** — `autotel.yaml` or `AUTOTEL_CONFIG_FILE` env var
3. **Environment variables** — `OTEL_*`, `AUTOTEL_*`
4. **Built-in defaults** — sensible dev defaults

### YAML Configuration

```yaml
# autotel.yaml
service:
  name: my-service
  version: 1.0.0
  environment: ${env:NODE_ENV:-development}

exporter:
  endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT:-http://localhost:4318}
  protocol: http
  headers:
    x-honeycomb-team: ${env:HONEYCOMB_API_KEY}

autoInstrumentations:
  - express
  - http
  - pino
```

### Environment Variables

- `OTEL_SERVICE_NAME` — service name
- `OTEL_EXPORTER_OTLP_ENDPOINT` — OTLP collector URL
- `OTEL_EXPORTER_OTLP_PROTOCOL` — `http` or `grpc`
- `OTEL_EXPORTER_OTLP_HEADERS` — comma-separated `key=value` pairs
- `OTEL_RESOURCE_ATTRIBUTES` — comma-separated `key=value` resource attributes

## Valid Import Paths

Only import from these public entry points:

| Import Path | What It Contains |
|-------------|-----------------|
| `autotel` | Core: trace, span, instrument, init, getRequestLogger, createStructuredError, parseError, track |
| `autotel/event` | Event class for advanced event creation |
| `autotel/testing` | createTraceCollector() for test assertions |
| `autotel/exporters` | InMemorySpanExporter for low-level testing |
| `autotel/logger` | Pino integration |
| `autotel/metrics` | Metrics helpers |
| `autotel/messaging` | Kafka, SQS, RabbitMQ producer/consumer helpers |
| `autotel/business-baggage` | Safe cross-service context propagation |
| `autotel/workflow` | Workflow and saga tracing |
| `autotel/yaml` | loadYamlConfigFromFile() |
| `autotel/correlation-id` | Correlation ID utilities |
| `autotel/auto` | Zero-config auto-instrumentation |
| `autotel-hono` | Hono middleware (otel()) |
| `autotel-tanstack` | TanStack Start middleware and wrappers |
| `autotel-tanstack/middleware` | tracingMiddleware() |
| `autotel-tanstack/server-functions` | traceServerFn() |
| `autotel-tanstack/loaders` | traceLoader() |
| `autotel-tanstack/handlers` | wrapStartHandler() |
| `autotel-tanstack/auto` | Zero-config TanStack Start |
| `autotel-cloudflare` | Cloudflare Workers wrappers |
| `autotel-cloudflare/bindings` | Bindings instrumentation |
| `autotel-mcp` | MCP instrumentation |
| `autotel-mcp/server` | instrumentMCPServer() |
| `autotel-mcp/client` | Client instrumentation |
| `autotel-mcp/context` | MCP context propagation |
| `autotel-edge` | Edge runtime core |
| `autotel-edge/sampling` | Sampling strategies |
| `autotel-edge/events` | Edge events system |
| `autotel-edge/testing` | Edge testing utilities |

Never import from `autotel/src/...` or internal paths.

## Production Features

- **Adaptive Sampling**: 10% baseline, 100% for errors and slow operations
- **Rate Limiting**: Built-in rate limiters prevent telemetry floods
- **Circuit Breakers**: Stop exporting when the backend is down
- **PII Redaction**: Configure redaction patterns in init or YAML
- **Event Batching**: Events are batched (100/batch, 10s flush interval) with retry
