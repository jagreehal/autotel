---
name: autotel-anti-patterns
description: >
  Common autotel mistakes and how to fix them. Wrong init patterns, manual span lifecycle, scattered console.log,
  generic Error throws, missing emitNow(), wrong import paths, secrets in attributes, barrel re-exports.
  Use when reviewing code or debugging instrumentation issues.
---

# Autotel Anti-Patterns

Common mistakes when using autotel, why they're wrong, and how to fix them.

## Purpose

Quick reference for catching and fixing incorrect autotel usage. Each anti-pattern includes the bad code, why it's wrong, the correct code, and a one-line rationale.

## When to Use

- Reviewing code that uses autotel
- Debugging instrumentation issues
- Teaching correct autotel patterns
- Auditing an existing codebase

## Anti-Patterns

### 1. Async Init / await import()

**Bad:**
```typescript
async function setup() {
  const { init } = await import('autotel');
  init({ service: 'my-api' });
}
await setup();
```

**Good:**
```typescript
import { init } from 'autotel';
init({ service: 'my-api' });
```

**Why:** `init()` must be synchronous. `await import()` delays SDK registration, causing spans to be lost before init completes. Use static imports or `safeRequire`/`requireModule` for optional dependencies.

---

### 2. Manual Span Lifecycle

**Bad:**
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

**Good:**
```typescript
import { trace } from 'autotel';

export const getUser = trace((ctx) => async (id: string) => {
  ctx.setAttribute('user.id', id);
  return await db.users.findById(id);
});
```

**Why:** `trace()` handles the entire span lifecycle automatically — start, end, error recording, and status. Manual lifecycle is verbose and error-prone (forgetting `span.end()`, incorrect error handling). Use `trace()`, `span()`, or `instrument()` instead.

---

### 3. Scattered console.log

**Bad:**
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

**Good:**
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

**Why:** Scattered console.log produces N disconnected log lines per request. `getRequestLogger()` produces one coherent snapshot with all attributes, correlated to the trace. Much easier to query in any observability backend.

---

### 4. Generic Error Throws

**Bad:**
```typescript
if (!user) throw new Error('User not found');

try {
  await processPayment(data);
} catch (e) {
  throw new Error('Payment failed');
}
```

**Good:**
```typescript
import { createStructuredError } from 'autotel';

if (!user) {
  throw createStructuredError({
    message: 'User not found',
    status: 404,
    why: `No user with ID "${userId}"`,
    fix: 'Check the user ID and try again',
  });
}

try {
  await processPayment(data);
} catch (e) {
  throw createStructuredError({
    message: 'Payment failed',
    status: 502,
    why: e instanceof Error ? e.message : 'Unknown error',
    fix: 'Try a different payment method or contact support',
    cause: e,
  });
}
```

**Why:** `new Error()` gives only a message string. `createStructuredError()` adds `why`, `fix`, `link`, and `status` — making errors machine-parseable and actionable for both users and AI agents. On the client, `parseError()` extracts these fields.

---

### 5. Missing emitNow()

**Bad:**
```typescript
export const handler = trace((ctx) => async (req, res) => {
  const log = getRequestLogger(ctx);
  log.set({ user: { id: user.id } });
  log.set({ cart: { items: cart.items.length } });
  // Forgot to call log.emitNow()!
  return res.json(result);
});
```

**Good:**
```typescript
export const handler = trace((ctx) => async (req, res) => {
  const log = getRequestLogger(ctx);
  log.set({ user: { id: user.id } });
  log.set({ cart: { items: cart.items.length } });
  log.emitNow(); // Flush the snapshot
  return res.json(result);
});
```

**Why:** `.set()` accumulates attributes but doesn't emit them. Without `.emitNow()` (and no middleware to do it), the request-scoped snapshot is never flushed to the span. Framework middleware (like Hono `otel()`) may call `.emitNow()` automatically, but if you're using `trace()` directly, call it explicitly.

---

### 6. Request Logger Without Active Span

**Bad:**
```typescript
// No trace() wrapper or middleware
export async function getUser(id: string) {
  const log = getRequestLogger(); // ERROR: no active span
  log.set({ user: { id } });
}
```

**Good:**
```typescript
import { trace, getRequestLogger } from 'autotel';

export const getUser = trace((ctx) => async (id: string) => {
  const log = getRequestLogger(ctx); // Works: trace() created a span
  log.set({ user: { id } });
  log.emitNow();
});
```

**Why:** `getRequestLogger()` reads from the active span context. Without a span (created by `trace()` or framework middleware), there's nothing to attach attributes to. Always ensure a span exists before calling `getRequestLogger()`.

---

### 7. Wrong Import Paths

**Bad:**
```typescript
import { trace } from 'autotel/src/functional';
import { init } from 'autotel/dist/init';
import { createStructuredError } from 'autotel/src/errors/structured';
```

**Good:**
```typescript
import { trace, init, createStructuredError } from 'autotel';
```

**Why:** Internal paths (`autotel/src/...`, `autotel/dist/...`) are not public API. They can change without notice and break tree-shaking. Use only the documented export paths: `autotel`, `autotel/event`, `autotel/testing`, `autotel/exporters`, `autotel/logger`, etc.

---

### 8. Secrets in Attributes

**Bad:**
```typescript
log.set({
  user: {
    id: user.id,
    email: user.email,
    authToken: req.headers.authorization, // SECRET
    creditCard: payment.cardNumber,       // PII
  },
});
```

**Good:**
```typescript
log.set({
  user: {
    id: user.id,
    // email, authToken, creditCard omitted
  },
});
```

**Why:** Span attributes and request logger data are exported to observability backends. Secrets, tokens, and full PII should never be included. Log user IDs and non-sensitive identifiers. Use autotel's PII redaction config if needed.

---

### 9. Using Generic autotel for Framework-Specific Apps

**Bad:**
```typescript
// In a Hono app
import { trace } from 'autotel';

app.post('/api/checkout', async (c) => {
  return trace(async () => {
    // Manually creating spans in a Hono app
  })();
});
```

**Good:**
```typescript
// In a Hono app
import { otel } from 'autotel-hono';
import { getRequestLogger } from 'autotel';

app.use(otel({ serviceName: 'my-api' }));

app.post('/api/checkout', async (c) => {
  const log = getRequestLogger(); // uses span from otel() middleware
  // ...
});
```

**Why:** Framework-specific packages (autotel-hono, autotel-tanstack, autotel-cloudflare, autotel-mcp-instrumentation) provide middleware that creates spans correctly for that framework, with proper attribute naming and context propagation. Using generic `trace()` misses these features.

---

### 10. Barrel Re-exports Breaking Tree-Shaking

**Bad:**
```typescript
// utils/index.ts
export * from 'autotel';
export * from 'autotel/event';
export * from 'autotel/testing';
export * from 'autotel/messaging';
```

**Good:**
```typescript
// Import directly where needed
import { trace, getRequestLogger } from 'autotel';
import { track } from 'autotel';
import { createTraceCollector } from 'autotel/testing';
```

**Why:** Barrel re-exports pull in all modules from every subpath, defeating tree-shaking. This can dramatically increase bundle size, especially with `autotel/messaging` (Kafka, SQS, RabbitMQ helpers). Import directly from the specific subpath in each file.

---

### 11. Client Not Using parseError()

**Bad:**
```typescript
try {
  await fetch('/api/checkout', { method: 'POST', body: JSON.stringify(data) });
} catch (err) {
  toast.error('Something went wrong'); // Ignores structured error fields
}
```

**Good:**
```typescript
import { parseError } from 'autotel';

try {
  const res = await fetch('/api/checkout', { method: 'POST', body: JSON.stringify(data) });
  if (!res.ok) throw await res.json().catch(() => ({}));
} catch (err) {
  const error = parseError(err);
  toast.error(error.message, {
    description: error.why,
    action: error.fix ? { label: 'Fix', onClick: () => showHelp(error.fix) } : undefined,
  });
}
```

**Why:** If the server sends `createStructuredError()` responses, the client should use `parseError()` to extract `message`, `why`, `fix`, and `link`. Showing "Something went wrong" wastes the structured context the server provided.

---

## Quick Detection Checklist

When scanning code, look for these signals:

| Signal | Anti-Pattern |
|--------|-------------|
| `await import('autotel')` | Async init (#1) |
| `tracer.startActiveSpan`, `span.end()` | Manual lifecycle (#2) |
| Multiple `console.log` in a handler | Scattered logging (#3) |
| `throw new Error(` in API routes | Generic error (#4) |
| `getRequestLogger()` without `emitNow()` | Missing emitNow (#5) |
| `getRequestLogger()` outside `trace()` | No active span (#6) |
| `from 'autotel/src/` or `autotel/dist/` | Wrong import (#7) |
| `.authorization`, `.token`, `.password` in `.set()` | Secrets (#8) |
| `from 'autotel'` in a Hono/TanStack/CF app | Wrong package (#9) |
| `export * from 'autotel` | Barrel re-export (#10) |
| `toast.error('Something went wrong')` after API call | Missing parseError (#11) |
