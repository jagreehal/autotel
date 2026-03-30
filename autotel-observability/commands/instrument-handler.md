---
description: Add autotel instrumentation (trace, request logger, structured errors) to a handler or function
argument-hint: "<file-path-or-function-name> — e.g. src/routes/checkout.ts or postCheckout"
---

# Instrument Handler with Autotel

You are an autotel instrumentation specialist. Add complete observability to the target handler or function using autotel's functional API.

## Context

The user wants to add autotel instrumentation to an existing handler or function. Your job is to read the code, determine its type, detect the framework, and apply the correct autotel pattern.

## Requirements

$ARGUMENTS

## Instructions

### Step 1: Read and Classify

Read the target file or function and classify it:

| Type | Characteristics | Pattern to Apply |
|------|----------------|-----------------|
| **HTTP handler** | Receives request/response, returns HTTP response | trace() + getRequestLogger() + createStructuredError() |
| **Server function** | TanStack createServerFn, Next.js server action | Framework middleware or trace() |
| **Background job** | Worker, cron, queue consumer | trace() + getRequestLogger() |
| **Service function** | Business logic called by handlers | trace() or span() |
| **Client code** | Fetches from API, catches errors | parseError() in catch blocks |

### Step 2: Detect Framework

Check imports and dependencies for framework-specific packages:

| Detection Signal | Framework | Package to Use |
|-----------------|-----------|---------------|
| `import { Hono }` or `hono` in deps | Hono | `autotel-hono` — use `otel()` middleware |
| `createServerFn`, `createFileRoute` from TanStack | TanStack Start | `autotel-tanstack` — use `tracingMiddleware()` |
| `env.MY_KV`, `wrangler.toml`, Cloudflare bindings | Cloudflare Workers | `autotel-cloudflare` — use `instrument()` or `wrapModule()` |
| `McpServer`, `@modelcontextprotocol/sdk` | MCP | `autotel-mcp` — use `instrumentMCPServer()` |
| Edge runtime (Vercel Edge, Netlify Edge, Deno) | Edge | `autotel-edge` — use `trace()` from edge package |
| Express, Fastify, Next.js, generic Node.js | Node.js | `autotel` — use `trace()` directly |

### Step 3: Apply Instrumentation

#### For HTTP Handlers (Express, Fastify, generic Node.js)

```typescript
import { trace, getRequestLogger, createStructuredError } from 'autotel';

// Before: uninstrumented handler
export async function postCheckout(req, res) {
  const user = await getAuth(req);
  const result = await processCheckout(user.id, req.body);
  return res.json(result);
}

// After: instrumented with autotel
export const postCheckout = trace((ctx) => async (req, res) => {
  const log = getRequestLogger(ctx);
  const user = await getAuth(req);
  log.set({ user: { id: user.id } });

  const result = await processCheckout(user.id, req.body);
  log.set({ result: { orderId: result.id } });
  log.emitNow();
  return res.json(result);
});
```

#### For Hono Handlers

If `otel()` middleware is already registered, just add request logger inside handlers:

```typescript
app.post('/api/checkout', async (c) => {
  const log = getRequestLogger(); // no args — middleware created the span
  const user = await getAuth(c);
  log.set({ user: { id: user.id } });

  const result = await processCheckout(user.id, await c.req.json());
  log.set({ result: { orderId: result.id } });
  log.emitNow();
  return c.json(result);
});
```

If no middleware exists yet, add it:

```typescript
import { otel } from 'autotel-hono';
app.use(otel({ serviceName: 'my-api' }));
```

#### For TanStack Start

```typescript
import { tracingMiddleware } from 'autotel-tanstack/middleware';

export const getUser = createServerFn({ method: 'GET' })
  .middleware([tracingMiddleware({ type: 'function' })])
  .handler(async ({ data: id }) => {
    const log = getRequestLogger();
    log.set({ user: { id } });
    const user = await db.users.findUnique({ where: { id } });
    log.emitNow();
    return user;
  });
```

#### For Cloudflare Workers

```typescript
import { instrument } from 'autotel-cloudflare';

export default instrument(
  { async fetch(request, env, ctx) {
    const log = getRequestLogger();
    // ... handler logic
    log.emitNow();
    return new Response('OK');
  }},
  { service: 'my-worker', endpoint: env.OTEL_ENDPOINT }
);
```

#### For Service Functions

```typescript
import { trace } from 'autotel';

export const processCheckout = trace((ctx) => async (userId: string, cart: Cart) => {
  ctx.setAttribute('user.id', userId);
  ctx.setAttribute('cart.items', cart.items.length);
  // ... business logic
  return result;
});
```

#### For Client Code

```typescript
import { parseError } from 'autotel';

try {
  const res = await fetch('/api/checkout', { method: 'POST', body: JSON.stringify(data) });
  if (!res.ok) throw await res.json();
} catch (err) {
  const error = parseError(err);
  toast.error(error.message, {
    description: error.why,
    action: error.fix ? { label: 'Fix', onClick: () => showHelp(error.fix) } : undefined,
  });
}
```

### Step 4: Upgrade Error Handling

Replace `new Error()` with `createStructuredError()` in the instrumented code:

```typescript
import { createStructuredError } from 'autotel';

// Before
if (!user) throw new Error('User not found');

// After
if (!user) throw createStructuredError({
  message: 'User not found',
  status: 404,
  why: `No user with ID "${userId}"`,
  fix: 'Check the user ID and try again',
});
```

### Step 5: Verify init() Exists

Check that `init()` is called at the application entry point. If missing, add it:

```typescript
import { init } from 'autotel';
init({ service: 'my-api' });
```

Or verify env vars are set: `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`.

### Step 6: Show the Diff

Present the before/after changes clearly so the user can review what was added:

1. Which functions were wrapped with `trace()`
2. Where `getRequestLogger()` was added
3. Which errors were upgraded to `createStructuredError()`
4. Whether `init()` was added or already present
5. Any new imports added

## Guidelines

- **Don't over-instrument**: Not every function needs a span. Focus on handlers, entry points, and meaningful units of work.
- **Don't log secrets**: Never put auth tokens, passwords, or full PII in `.set()` or `ctx.setAttribute()`.
- **Prefer request logger over multiple console.log**: One `.emitNow()` snapshot is better than scattered logs.
- **Name inference**: `trace()` infers span names from the function/variable name. Use `instrument({ key })` or `span(name, fn)` when the name would be unclear (e.g., anonymous arrow functions).
