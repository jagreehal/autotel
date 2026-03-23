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
- Working in the autotel monorepo

## Quick Reference

| Task | Reference |
|------|-----------|
| Convert console.log to wide events | [wide-events.md](references/wide-events.md) |
| Add structured errors | [structured-errors.md](references/structured-errors.md) |
| Accumulate request context | [request-logger.md](references/request-logger.md) |
| Review code for anti-patterns | [code-review.md](references/code-review.md) |

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
    log.error(error, { step: 'payment' });
    throw error;
  }
});
```

### Event Tracking

```typescript
import { track, getEventQueue } from 'autotel';

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
| `catch (e) { throw e }` | `catch (e) { log.error(e); throw e }` or `recordStructuredError()` |
| `catch (e) { res.json({ error: e.message }) }` | `parseError(e)` for consistent shape |
| `throw new Error('Payment failed')` | `createStructuredError({ message, why, fix, link })` |
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

### Events

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
| `autotel` | Node.js core: init, trace, span, track, event-queue, correlation-id |
| `autotel-edge` | Edge runtime foundation |
| `autotel-cloudflare` | Cloudflare Workers |
| `autotel-adapters` | Framework adapters (Next.js, Hono, Nitro, Cloudflare) |
| `autotel-mcp` | MCP instrumentation |
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
