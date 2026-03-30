---
description: Migrate from vanilla OpenTelemetry SDK or console.log to autotel
argument-hint: "<file-or-directory> — e.g. src/ or src/routes/checkout.ts"
---

# Migrate to Autotel

You are an autotel migration specialist. Convert vanilla OpenTelemetry SDK code or scattered console.log patterns to autotel's functional API.

## Context

The user has existing code with either:
1. Vanilla OpenTelemetry SDK instrumentation (`@opentelemetry/sdk-trace-node`, `tracer.startActiveSpan()`, manual `span.end()`)
2. Scattered `console.log` / `console.error` calls for observability
3. A mix of both

Your job is to migrate this code to autotel's functional API while preserving all existing observability intent.

## Requirements

$ARGUMENTS

## Instructions

### Step 1: Scan for Existing Patterns

Search the target files for these patterns:

**Vanilla OTel SDK patterns:**
- `@opentelemetry/sdk-trace-node` or `@opentelemetry/sdk-trace-base` imports
- `@opentelemetry/api` imports (`trace.getTracer()`, `tracer.startActiveSpan()`)
- `NodeSDK`, `NodeTracerProvider` setup
- `span.end()`, `span.setAttribute()`, `span.recordException()`, `span.setStatus()`
- `NODE_OPTIONS="--require @opentelemetry"` in scripts
- `registerInstrumentations()` calls

**Scattered logging patterns:**
- `console.log()`, `console.error()`, `console.warn()` used for request/business context
- Multiple log calls within a single handler that should be a single snapshot

### Step 2: Migrate Init / SDK Setup

**Before (vanilla OTel):**
```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  serviceName: 'my-service',
  traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' }),
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();
```

**After (autotel):**
```typescript
import { init } from 'autotel';

init({
  service: 'my-service',
  endpoint: 'http://localhost:4318',
  // Auto-instrumentations are configured via init options or autotel.yaml
});
```

**Key differences:**
- `init()` is synchronous — no `await sdk.start()`
- Endpoint is the base URL (autotel appends `/v1/traces`)
- Auto-instrumentations can be configured in `autotel.yaml` under `autoInstrumentations`
- Env vars work: `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`

### Step 3: Migrate Span Creation

**Before (manual span lifecycle):**
```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('my-service');

export async function getUser(id: string) {
  return tracer.startActiveSpan('getUser', async (span) => {
    try {
      span.setAttribute('user.id', id);
      const user = await db.users.findById(id);
      span.setStatus({ code: SpanStatusCode.OK });
      return user;
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
```

**After (autotel functional API):**
```typescript
import { trace } from 'autotel';

export const getUser = trace((ctx) => async (id: string) => {
  ctx.setAttribute('user.id', id);
  const user = await db.users.findById(id);
  return user;
  // span lifecycle (end, error recording, status) handled automatically
});
```

**Key differences:**
- No manual `span.end()` — `trace()` handles lifecycle
- No try/catch/finally for span management — errors are recorded automatically
- No `tracer.getTracer()` — `trace()` uses the global tracer
- No `SpanStatusCode` — autotel sets status based on success/failure

### Step 4: Migrate Attributes and Context

**Before (span.setAttribute throughout):**
```typescript
tracer.startActiveSpan('checkout', async (span) => {
  span.setAttribute('user.id', user.id);
  span.setAttribute('cart.items', cart.items.length);
  span.setAttribute('total', calculateTotal(cart));
  // ... many more setAttribute calls
  span.end();
});
```

**After (request logger for one snapshot):**
```typescript
const postCheckout = trace((ctx) => async (req, res) => {
  const log = getRequestLogger(ctx);
  log.set({ user: { id: user.id } });
  log.set({ cart: { items: cart.items.length } });
  log.set({ total: calculateTotal(cart) });
  log.emitNow();
  // One coherent snapshot vs many individual attributes
});
```

Use `getRequestLogger()` when there are multiple attributes to set throughout a request. Use `ctx.setAttribute()` for 1-2 simple attributes.

### Step 5: Migrate Error Handling

**Before (generic Error):**
```typescript
throw new Error('Payment failed');
// or
span.recordException(error);
```

**After (structured error):**
```typescript
import { createStructuredError } from 'autotel';

throw createStructuredError({
  message: 'Payment failed',
  status: 402,
  why: error instanceof Error ? error.message : 'Unknown error',
  fix: 'Try a different payment method or contact support',
  cause: error,
});
```

### Step 6: Migrate Console.log

**Before (scattered logs):**
```typescript
export async function handleCheckout(req, res) {
  console.log('Checkout started');
  const user = await getAuth(req);
  console.log('User:', user.id);
  const cart = await getCart(user.id);
  console.log('Cart items:', cart.items.length);
  const result = await processCheckout(cart);
  console.log('Order:', result.id);
  return res.json(result);
}
```

**After (request logger):**
```typescript
import { trace, getRequestLogger } from 'autotel';

export const handleCheckout = trace((ctx) => async (req, res) => {
  const log = getRequestLogger(ctx);
  const user = await getAuth(req);
  log.set({ user: { id: user.id } });

  const cart = await getCart(user.id);
  log.set({ cart: { items: cart.items.length } });

  const result = await processCheckout(cart);
  log.set({ order: { id: result.id } });
  log.emitNow();
  return res.json(result);
});
```

### Step 7: Clean Up

After migration:

1. **Remove old OTel SDK setup** — `NodeSDK`, `NodeTracerProvider`, `tracer.getTracer()`, manual exporters
2. **Remove span lifecycle code** — `span.end()`, `span.setStatus()`, `SpanStatusCode` imports
3. **Remove scattered console.log** — replaced by request logger
4. **Keep auto-instrumentations** — if using `@opentelemetry/auto-instrumentations-node`, configure them in `autotel.yaml` under `autoInstrumentations` instead
5. **Update dependencies** — add `autotel` (and framework package if applicable), remove `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http`, etc. (keep `@opentelemetry/api` if needed for types)

### Step 8: Output Migration Summary

Present a summary:

```
## Migration Summary

### Files Changed
- src/instrumentation.ts → replaced NodeSDK with init()
- src/routes/checkout.ts → trace() + getRequestLogger()
- src/routes/users.ts → trace() + createStructuredError()
- src/client/api.ts → added parseError()

### Patterns Replaced
- 3 manual span lifecycles → trace() with automatic lifecycle
- 12 console.log calls → 3 request logger snapshots
- 2 generic Error throws → createStructuredError()

### Manual Follow-ups
- [ ] Set OTEL_EXPORTER_OTLP_ENDPOINT in production env
- [ ] Remove @opentelemetry/sdk-node from package.json
- [ ] Review autotel.yaml for auto-instrumentation config
```
