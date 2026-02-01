---
name: autotel-patterns
description: "Core patterns for autotel: OpenTelemetry instrumentation for Node.js and edge runtimes. Use when instrumenting with trace/span/track, configuring init(), adding subscribers, or working in the autotel monorepo."
version: 1.0.0
user-invocable: true
---

# Autotel Core Patterns

Philosophy: "Write once, observe everywhere" — instrument once, stream to any OTLP-compatible backend.

---

## Quick Reference

### Tracing API

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

### Event Tracking

```typescript
import { track, getEventQueue } from 'autotel';

track('user.signup', { userId: '123', plan: 'pro' });

// MUST flush before assertions or shutdown
await getEventQueue()?.flush();
```

### Correlation ID

```typescript
import { getOrCreateCorrelationId } from 'autotel';
import { runWithCorrelationId } from 'autotel/correlation-id';

const correlationId = getOrCreateCorrelationId();
runWithCorrelationId(incomingId, () => handleRequest());
```

---

## MUST / SHOULD / NEVER

### Init & Module Loading

- MUST: Keep `init()` synchronous
- MUST: Use `safeRequire`/`requireModule` from `./node-require` for dynamic deps
- NEVER: Use `await import()` for optional/lazy dependencies

```typescript
// CORRECT
import { safeRequire } from './node-require';
const pkg = safeRequire('optional-pkg');
if (pkg) pkg.initialize();

// WRONG - breaks sync init
const pkg = await import('optional-pkg');
```

### Tracing

- MUST: Use `trace()`, `span()`, `instrument()` to wrap business logic
- MUST: Use factory pattern `trace((ctx) => ...)` when setting attributes
- SHOULD: Let trace names infer from const/function names
- NEVER: Manually start/end spans for app logic (SDK glue only)

### Events

- MUST: Call `getEventQueue()?.flush()` before assertions or shutdown
- MUST: Accept `options?: EventTrackingOptions` in subscribers
- MUST: Forward `options.autotel` in subscriber payloads (contains trace context)
- NEVER: Assert on event delivery without flush

### Tree-Shaking

- MUST: Use explicit `exports` in `package.json` for new entry points
- MUST: Build new entry points with tsup
- NEVER: Add barrel re-exports that pull in unused code

### Repository

- MUST: Ask before adding new dependencies
- MUST: Ask before modifying build configs
- MUST: Create changeset for any package changes (`pnpm changeset`)
- NEVER: Commit secrets or modify `node_modules/`

---

## Package Layout

| Package | Entry Point | Role |
|---------|-------------|------|
| `autotel` | `autotel` | Node.js core: init, trace, span, track, event-queue, correlation-id |
| `autotel-edge` | `autotel-edge` | Edge runtime foundation |
| `autotel-cloudflare` | `autotel-cloudflare` | Cloudflare Workers |
| `autotel-mcp` | `autotel-mcp` | MCP instrumentation |
| `autotel-tanstack` | `autotel-tanstack` | TanStack Start |
| `autotel-subscribers` | `autotel-subscribers/*` | Event subscribers (PostHog, Mixpanel, Webhook) |

Each package has a `CLAUDE.md` for local conventions.

---

## Subscriber Pattern

Subscribers receive trace context via third parameter. Forward `options.autotel` in payloads:

```typescript
import { EventSubscriber, EventPayload, EventTrackingOptions } from './base';

export class WebhookSubscriber extends EventSubscriber {
  async sendToDestination(
    payload: EventPayload,
    options?: EventTrackingOptions
  ): Promise<void> {
    await fetch(this.url, {
      body: JSON.stringify({
        ...payload,
        // Forward trace context
        autotel: options?.autotel, // { correlation_id, trace_id, span_id, trace_url }
      }),
    });
  }
}
```

Subscriber entry points (tree-shakeable):
- `autotel-subscribers/posthog`
- `autotel-subscribers/mixpanel`
- `autotel-subscribers/amplitude`
- `autotel-subscribers/segment`
- `autotel-subscribers/webhook`
- `autotel-subscribers/testing`

---

## Type-Safe Attributes

```typescript
import { attrs, setUser, safeSetAttributes } from 'autotel/attributes';

// Key builders
ctx.setAttributes(attrs.user.id('user-123'));
ctx.setAttributes(attrs.http.request.method('GET'));

// Object builders
ctx.setAttributes(attrs.user.data({ id: '123', email: 'user@example.com' }));

// Attachers with guardrails
setUser(ctx, { id: '123', email: 'user@example.com' }); // Auto-redacts PII

// Safe attributes with explicit guardrails
safeSetAttributes(ctx, attrs.user.data({ email: 'pii@example.com' }), {
  guardrails: { pii: 'hash' }, // 'allow' | 'redact' | 'hash' | 'block'
});
```

---

## Semantic Helpers

Pre-configured trace helpers following OTel semantic conventions:

```typescript
import { traceLLM, traceDB, traceHTTP, traceMessaging } from 'autotel/semantic-helpers';

// LLM operations
export const generateText = traceLLM({
  model: 'gpt-4-turbo',
  operation: 'chat',
  provider: 'openai',
})((ctx) => async (prompt) => { /* ... */ });

// Database operations
export const getUser = traceDB({
  system: 'postgresql',
  operation: 'SELECT',
  collection: 'users',
})((ctx) => async (userId) => { /* ... */ });

// HTTP client
export const fetchData = traceHTTP({
  method: 'GET',
  url: 'https://api.example.com/data',
})((ctx) => async () => { /* ... */ });

// Messaging
export const publishEvent = traceMessaging({
  system: 'kafka',
  operation: 'publish',
  destination: 'events',
})((ctx) => async (event) => { /* ... */ });
```

---

## Producer/Consumer Pattern

```typescript
import { traceProducer, traceConsumer } from 'autotel/messaging';

// Producer - sets SpanKind.PRODUCER
export const publish = traceProducer({
  system: 'kafka',
  destination: 'user-events',
  messageIdFrom: (args) => args[0].id,
})((ctx) => async (event) => {
  const headers = ctx.getTraceHeaders(); // { traceparent, tracestate? }
  await producer.send({ messages: [{ value: event, headers }] });
});

// Consumer - sets SpanKind.CONSUMER, creates links
export const process = traceConsumer({
  system: 'kafka',
  destination: 'user-events',
  consumerGroup: 'processor',
  headersFrom: (msg) => msg.headers,
})((ctx) => async (messages) => { /* ... */ });
```

---

## Quick Commands

```bash
pnpm build      # Build all packages
pnpm test       # Run all tests
pnpm lint       # Lint
pnpm quality    # build + lint + format + type-check + test
pnpm changeset  # Create changeset for release
```

---

## Testing

- Unit tests: `*.test.ts`
- Integration tests: `*.integration.test.ts` (require OTel SDK)
- MUST: Flush before assertions: `await getEventQueue()?.flush();`
- Use `SubscriberTestHarness` for subscriber tests

---

## Advanced Features

See `docs/ADVANCED.md` for:
- Deterministic trace IDs (`createDeterministicTraceId`)
- Metadata flattening (`flattenMetadata`)
- Isolated tracer providers (`setAutotelTracerProvider`)
- Safe baggage propagation (`BusinessBaggage`, `createSafeBaggageSchema`)
- Workflow/saga tracing (`traceWorkflow`, `traceStep`)

See `docs/ARCHITECTURE.md` for:
- Trace name inference patterns
- Event queue internals
- Configuration layering
- Tail sampling processor
