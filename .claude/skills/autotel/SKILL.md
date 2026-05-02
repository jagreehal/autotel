---
name: autotel
description: Use when instrumenting with trace/span/track, reviewing code for logging and observability patterns, converting console.log to wide events, adding structured errors, setting up canonical log lines, configuring init(), adding subscribers, or working in the autotel monorepo.
---

# Autotel

Philosophy: "Write once, observe everywhere" - instrument once, stream to any OTLP-compatible backend.

`trace()` wraps functions. `getRequestLogger()` accumulates context. `createStructuredError()` adds why/fix/link to errors. Canonical log lines emit one wide event per request automatically.

## When to Use

- Instrumenting functions with tracing
- Code uses `console.log` / `console.error` for observability
- Error handling lacks structured context (no why, fix, or link)
- Adding tracing to any Node.js or edge runtime handler
- Reviewing code for observability anti-patterns
- Setting up observability in Cloudflare Workers, Hono, or Next.js
- Working in the autotel monorepo

## Quick Reference

| Task | Reference |
|------|-----------|
| Convert console.log to wide events | [wide-events.md](references/wide-events.md) |
| Add structured errors | [structured-errors.md](references/structured-errors.md) |
| Accumulate request context | [request-logger.md](references/request-logger.md) |
| Review code for anti-patterns | [code-review.md](references/code-review.md) |
| Add attribute redaction | (use `init({ attributeRedactor: 'default' | 'strict' | 'pci-dss' })` or custom config) |
| Lock init from re-initialization | (use `lockLogger()` in framework plugins) | |

## Tracing API

```typescript
import { trace, span } from 'autotel';

// Factory pattern (receives ctx for attributes)
export const createUser = trace((ctx) => async (data) => {
  ctx.setAttribute('user.id', data.id);
  return await db.users.create(data);
});

// Direct pattern (no ctx needed)
export const getUser = trace(async (id) => {
  return await db.users.findById(id);
});

// Nested span
span('db.insert', async () => {
  await db.insert(record);
});
```

### Recording Errors

**Default: throw, don't catch.** `trace()` records status, exception, and structured attributes when the wrapped function rejects.

```typescript
import { trace, createStructuredError } from 'autotel';

export const charge = trace((ctx) => async (cart) => {
  if (!cart.items.length) {
    throw createStructuredError({
      message: 'Cart is empty',
      why: 'User submitted checkout with no items',
      fix: 'Validate cart on the client before submit',
      link: 'https://docs.example.com/errors/empty-cart',
    });
  }
  return await processCart(cart);
});
```

Fallbacks, in order:

1. **Attach call-site context, then rethrow** — `getRequestLogger(ctx).error(err, { step })`. Use when the rethrown error needs context only known at the catch site.
2. **Writing instrumentation/middleware that wraps user handlers** — `ctx.recordError(err)` from inside a `trace((ctx) => ...)` callback. Sets ERROR status, structured `error.*` attributes, and (during the back-compat window) records the exception. Accepts `unknown` so no `as Error` cast is needed in catch blocks. For code that doesn't have a `ctx` handle, use the standalone form `recordStructuredError(ctx, err)`.

```typescript
// Inside a trace() callback — instrumentation wrapping a user handler:
return trace({ name }, async (ctx) => {
  try {
    return await userHandler(args);
  } catch (err) {
    ctx.recordError(err); // ergonomic replacement for ctx.recordException
    throw err;
  }
});
```

`ctx.recordException(...)` and `ctx.addEvent(...)` are intentionally hidden from the `TraceContext` type per OTEP 4430 (March 2026 — Span Event API deprecation). The runtime methods exist for back-compat only; new code MUST go through `createStructuredError`, `ctx.recordError(err)` / `recordStructuredError(ctx, err)`, or the request logger.

### Request Logger

```typescript
import { trace, getRequestLogger } from 'autotel';

export const handleOrder = trace((ctx) => async (req) => {
  const log = getRequestLogger(ctx);
  log.set({ feature: 'checkout', tier: req.user.tier });

  const cart = await loadCart(req.cartId);
  log.set({ cart_items: cart.items.length, cart_total: cart.total });

  try {
    const payment = await processPayment(cart);
    log.set({ payment_method: payment.method });
  } catch (error) {
    // Fallback pattern: attach call-site context, then rethrow.
    // Default is to let the error propagate and let trace() record it.
    log.error(error, { step: 'payment' });
    throw error;
  }
});
```

### Event Tracking

```typescript
import { trace, getEventQueue } from 'autotel';

// Inside trace() — use ctx.track for ergonomic, ctx-bound emission:
export const signup = trace((ctx) => async (data) => {
  ctx.track('user.signup', { userId: data.id, plan: data.plan });
  return await db.users.create(data);
});

// Outside trace() — use the standalone track():
import { track } from 'autotel';
track('user.signup', { userId: '123', plan: 'pro' });

// MUST flush before assertions or shutdown
await getEventQueue()?.flush();
```

### Correlation ID

```typescript
import { getOrCreateCorrelationId, runWithCorrelationId } from 'autotel';

const correlationId = getOrCreateCorrelationId();
runWithCorrelationId(incomingId, () => handleRequest());
```

## Framework Adapters

```typescript
// Cloudflare Workers (via autotel/workers)
import { init, wrapModule, trace } from 'autotel/workers';

const processOrder = trace(async (orderId: string, kv: KVNamespace) => {
  return await kv.get(orderId);
});

export default wrapModule(
  { service: { name: 'my-worker' } },
  {
    async fetch(_req, env) {
      return Response.json(await processOrder('123', env.ORDERS_KV));
    },
  },
);
```

```typescript
// Next.js
import { withAutotel, useLogger } from 'autotel-adapters/next';

export const POST = withAutotel(async (request) => {
  const log = useLogger(request);
  log.set({ feature: 'checkout' });
  return Response.json({ ok: true });
});
```

```typescript
// Hono (with autotel-hono middleware already creating spans)
import { useLogger } from 'autotel-adapters/hono';

app.get('/orders/:id', (c) => {
  const log = useLogger(c);
  log.set({ route: c.req.path });
  return c.json({ ok: true });
});
```

## Anti-Patterns to Detect

| Anti-Pattern | Fix |
|---|---|
| `console.log('user created', userId)` | `log.set({ user_id: userId })` inside `trace()` |
| `catch (e) { throw e }` | Delete the catch — `trace()` records errors automatically. Or `log.error(e, { step }); throw e` to attach call-site context |
| `catch (e) { res.json({ error: e.message }) }` | `parseError(e)` for consistent shape |
| `throw new Error('Payment failed')` | `createStructuredError({ message, why, fix, link })` |
| `ctx.recordException(err)` / `span.recordException(err)` | App code: throw `createStructuredError(...)`. Instrumentation: `ctx.recordError(err)` (or `recordStructuredError(ctx, err)` if you don't have a `ctx` handle). Span Event API is deprecated (OTEP 4430) and type-gated out of `TraceContext` |
| `ctx.addEvent('name', { ... })` / `span.addEvent(...)` | Discrete event inside `trace()`: `ctx.track('event.name', { ... })` (or standalone `track('event.name', { ... })` when there's no `ctx` handle). Wide-event attribute: `getRequestLogger(ctx).set({ ... })` |
| `(ctx as any).recordException(err)` / `as unknown as { recordException }` | Don't bypass the type gate — use `recordStructuredError(ctx, err)` instead |
| Manual `console.log` at start/end of function | `trace()` wrapper handles lifecycle |
| Separate request ID generation | `ctx.correlationId` provides automatic correlation |

## init() Configuration

### Signals: Traces, Metrics, Logs

When `endpoint` is set, traces and metrics are auto-configured by default. Logs are opt-in to avoid unexpected export and preserve OTel SDK `OTEL_LOGS_EXPORTER` handling:

```typescript
init({
  service: 'my-app',
  endpoint: 'http://localhost:4318',
  // traces: always on when endpoint is set
  // metrics: true by default (AUTOTEL_METRICS env var override)
  // logs: false by default — opt-in with logs: true (AUTOTEL_LOGS env var override)
  logs: true,  // enable auto OTLP log export
});
```

Disable any signal explicitly:

```typescript
init({
  service: 'my-app',
  endpoint: 'http://localhost:4318',
  metrics: false,  // disable auto OTLP metrics
  logs: false,     // disable auto OTLP logs (already the default)
});
```

Custom `logRecordProcessors` are additive — they work alongside the auto-configured exporter:

```typescript
init({
  service: 'my-app',
  endpoint: 'http://localhost:4318',
  logRecordProcessors: [customProcessor], // added alongside auto-configured OTLP exporter
});
```

Protocol selection (`http` default, `grpc` optional) applies to all signals. gRPC exporters are optional peer deps.

### Logger Locking

Framework plugins can lock `init()` to prevent re-initialization:

```typescript
import { lockLogger, isLoggerLocked } from 'autotel';

lockLogger(); // After framework sets up instrumentation
isLoggerLocked(); // true
```

### Silent Mode

Suppress internal autotel logs while keeping exporters running:

```typescript
init({
  service: 'my-app',
  silent: true,        // Suppress console output
  minLevel: 'warn',    // Only log warnings/errors
});
```

### Attribute Redaction

Automatically redact PII from span attributes:

```typescript
init({
  service: 'my-app',
  attributeRedactor: 'default', // 'default' | 'strict' | 'pci-dss'
});
```

- `default` — Emails, phones, SSNs, credit cards (last 4), sensitive keys
- `strict` — Plus JWTs, Bearer tokens, IBANs, API keys
- `pci-dss` — Focused on payment card data

Custom:

```typescript
init({
  attributeRedactor: {
    keyPatterns: [/password/i, /secret/i],
    valuePatterns: [{ name: 'customerId', pattern: /CUST-\d{8}/g, replacement: 'CUST-***' }],
    builtins: ['email', 'creditCard'],
  },
});
```

### Sampling

Default: `AdaptiveSampler` with 10% baseline, 100% for errors and slow requests (>1s). Tail sampling via `TailSamplingSpanProcessor` defers the decision until span ends.

```typescript
import { AdaptiveSampler } from 'autotel';

init({
  service: 'my-app',
  endpoint: 'http://localhost:4318',
  sampler: new AdaptiveSampler({
    baselineSampleRate: 0.1,    // 10% of normal requests (default)
    slowThresholdMs: 1000,       // Requests > 1s are "slow" (default)
    alwaysSampleErrors: true,    // Always trace errors (default)
    alwaysSampleSlow: true,      // Always trace slow requests (default)
    linksBased: false,           // Enable for event-driven architectures
  }),
});
```

The `Sampler` interface is simple — return `true` to trace, `false` to skip:

```typescript
const sampler: Sampler = {
  shouldSample({ operationName, args, links }) {
    return operationName.startsWith('critical.');
  },
};
```

### Canonical Log Lines

```typescript
init({
  service: 'my-app',
  canonicalLogLines: {
    enabled: true,
    rootSpansOnly: true,
    keep: [{ status: 500 }, { durationMs: 1000 }],
    pretty: true,
    drain: (event) => sendToAnalytics(event),
  },
});
```

## MUST / SHOULD / NEVER

### Init & Module Loading

- MUST: Keep `init()` synchronous
- MUST: Use `safeRequire`/`requireModule` from `./node-require` for dynamic deps
- NEVER: Use `await import()` for optional/lazy dependencies

### Tracing

- MUST: Use `trace()`, `span()`, `instrument()` to wrap business logic
- MUST: Use factory pattern `trace((ctx) => ...)` when setting attributes
- SHOULD: Let trace names infer from const/function names
- NEVER: Manually start/end spans for app logic (SDK glue only)

### Errors & Events

- MUST: Throw `createStructuredError({ message, why, fix, link })` instead of `new Error(...)` in app code — let `trace()` record it on span exit
- MUST: Use `ctx.recordError(err)` from instrumentation/middleware code that wraps user handlers (or `recordStructuredError(ctx, err)` if you don't have a `ctx` handle)
- SHOULD: Only catch errors when you need to attach call-site context, then `getRequestLogger(ctx).error(err, { step })` and rethrow
- SHOULD: Emit discrete events inside `trace()` with `ctx.track('event.name', { ... })` (or standalone `track('event.name', { ... })` outside `trace()`); emit wide-event attributes with `getRequestLogger(ctx).set({ ... })`
- NEVER: Call `ctx.recordException(err)` or `ctx.addEvent(...)` — Span Event API is deprecated (OTEP 4430, March 2026) and intentionally type-gated out of `TraceContext`
- NEVER: Cast `ctx as any` or `as unknown as { recordException }` to bypass the type gate

### Event Queue

- MUST: Call `getEventQueue()?.flush()` before assertions or shutdown
- MUST: Forward `options.autotel` in subscriber payloads (contains trace context)
- NEVER: Assert on event delivery without flush

### Tree-Shaking & Repository

- MUST: Use explicit `exports` in `package.json` for new entry points
- MUST: Ask before adding new dependencies or modifying build configs
- MUST: Create changeset for any package changes (`pnpm changeset`)
- NEVER: Add barrel re-exports that pull in unused code

## Package Layout

| Package | Role |
|---------|------|
| `autotel` | Node.js core: init, trace, span, track, event-queue, correlation-id. Also provides `autotel/workers` and `autotel/cloudflare` for Cloudflare Workers |
| `autotel-edge` | Edge runtime foundation (alternative to workers for vendor-agnostic edge) |
| `autotel-cloudflare` | Cloudflare Workers implementation (re-exported via `autotel/workers`) |
| `autotel-adapters` | Framework adapters (Next.js, Hono, Nitro) |
| `autotel-mcp-instrumentation` | MCP instrumentation |
| `autotel-tanstack` | TanStack Start |
| `autotel-subscribers` | Event subscribers (PostHog, Mixpanel, Webhook) |

Each package has a `CLAUDE.md` for local conventions.

## Semantic Helpers

```typescript
import { traceLLM, traceDB, traceHTTP, traceMessaging } from 'autotel/semantic-helpers';

export const generateText = traceLLM({
  model: 'gpt-4-turbo', operation: 'chat', provider: 'openai',
})((ctx) => async (prompt) => { /* ... */ });

export const getUser = traceDB({
  system: 'postgresql', operation: 'SELECT', collection: 'users',
})((ctx) => async (userId) => { /* ... */ });
```

## Type-Safe Attributes

```typescript
import { attrs, setUser, safeSetAttributes } from 'autotel/attributes';

ctx.setAttributes(attrs.user.id('user-123'));
setUser(ctx, { id: '123', email: 'user@example.com' });
safeSetAttributes(ctx, attrs.user.data({ email: 'pii@example.com' }), {
  guardrails: { pii: 'hash' },
});
```

## Producer/Consumer Pattern

```typescript
import { traceProducer, traceConsumer } from 'autotel/messaging';

export const publish = traceProducer({
  system: 'kafka', destination: 'user-events',
  messageIdFrom: (args) => args[0].id,
})((ctx) => async (event) => {
  const headers = ctx.getTraceHeaders();
  await producer.send({ messages: [{ value: event, headers }] });
});
```

## Quick Commands

```bash
pnpm build      # Build all packages
pnpm test       # Run all tests
pnpm lint       # Lint
pnpm quality    # build + lint + format + type-check + test
pnpm changeset  # Create changeset for release
```

## Testing

- Unit tests: `*.test.ts` / Integration tests: `*.integration.test.ts`
- MUST flush before assertions: `await getEventQueue()?.flush();`
- Use `SubscriberTestHarness` for subscriber tests

## Loading Reference Files

- Building error handling? Load [structured-errors.md](references/structured-errors.md)
- Adding request logging? Load [request-logger.md](references/request-logger.md)
- Setting up wide events or querying? Load [wide-events.md](references/wide-events.md)
- Reviewing existing code? Load [code-review.md](references/code-review.md)

## Advanced Features

See `docs/ADVANCED.md` for deterministic trace IDs, metadata flattening, isolated tracer providers, safe baggage propagation, and workflow/saga tracing.
