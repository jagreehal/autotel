---
name: autotel-framework-setup
description: >
  Set up autotel in Hono, Fastify, TanStack Start, Cloudflare Workers, Next.js, Express, MCP, and edge runtimes.
  Framework-specific middleware, init placement, and handler patterns. Use when integrating autotel into a web framework.
---

# Autotel Framework Setup

Framework-specific setup guides for integrating autotel into your application.

## Purpose

Quick-start guide for wiring autotel into each supported framework. Covers package installation, init placement, middleware setup, and handler patterns.

## When to Use

- Setting up autotel in a new project
- Adding autotel to an existing framework app
- Checking if you're using the right framework-specific package
- Looking up the correct middleware or wrapper API

## Hono

**Package:** `autotel-hono`

**Install:**
```bash
pnpm add autotel autotel-hono
```

**Setup:**
```typescript
import { Hono } from 'hono';
import { init, getRequestLogger } from 'autotel';
import { otel } from 'autotel-hono';

init({ service: 'my-api' });

const app = new Hono();
app.use(otel({ serviceName: 'my-api' }));

app.post('/api/checkout', async (c) => {
  const log = getRequestLogger(); // no args — middleware created the span
  const user = await getAuth(c);
  log.set({ user: { id: user.id } });

  const result = await processCheckout(user.id, await c.req.json());
  log.set({ result: { orderId: result.id } });
  log.emitNow();
  return c.json(result);
});

export default app;
```

**Key points:**
- Register `otel()` middleware once with `app.use()`, not per-route
- `getRequestLogger()` needs no args inside handlers (middleware sets up AsyncLocalStorage)
- Optional config: `captureRequestHeaders`, `captureResponseHeaders`, `spanNameFactory`

---

## TanStack Start

**Package:** `autotel-tanstack`

**Install:**
```bash
pnpm add autotel autotel-tanstack
```

**Setup — Middleware approach (recommended):**
```typescript
// app/ssr.tsx or server entry
import { wrapStartHandler } from 'autotel-tanstack/handlers';

export default wrapStartHandler({
  service: 'my-app',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
})(createStartHandler(defaultStreamHandler));
```

```typescript
// Server functions
import { createServerFn } from '@tanstack/react-start';
import { tracingMiddleware } from 'autotel-tanstack/middleware';
import { getRequestLogger } from 'autotel';

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

```typescript
// Route loaders
import { traceLoader } from 'autotel-tanstack/loaders';

export const Route = createFileRoute('/users/$userId')({
  loader: traceLoader(async ({ params }) => {
    return await getUser({ data: params.userId });
  }),
});
```

**Zero-config alternative:**
```typescript
import 'autotel-tanstack/auto';
// Set OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS
```

**Key points:**
- Use `tracingMiddleware()` for server functions and request middleware
- Use `traceLoader()` for route loaders
- Use `wrapStartHandler()` for the start handler
- Supports both React Start and Solid Start

---

## Cloudflare Workers

**Package:** `autotel-cloudflare`

**Install:**
```bash
pnpm add autotel-cloudflare
```

**Setup — instrument() style:**
```typescript
import { instrument, getRequestLogger } from 'autotel-cloudflare';

export default instrument(
  {
    async fetch(request, env, ctx) {
      const log = getRequestLogger();
      log.set({ method: request.method, url: request.url });

      const result = await handleRequest(request, env);
      log.emitNow();
      return result;
    },
  },
  {
    service: 'my-worker',
    endpoint: 'https://api.honeycomb.io',
  }
);
```

**Setup — wrapModule() style:**
```typescript
import { wrapModule } from 'autotel-cloudflare';

export default wrapModule(
  { service: 'my-worker', endpoint: 'https://api.honeycomb.io' },
  {
    async fetch(request, env, ctx) {
      // handler logic
      return new Response('OK');
    },
  }
);
```

**Bindings instrumentation:**
Cloudflare bindings (KV, R2, D1, Durable Objects, Workers AI, Vectorize, etc.) are automatically instrumented when using `instrument()` or `wrapModule()`. All binding operations get spans.

**Key points:**
- Uses `autotel-cloudflare`, not `autotel` (edge-compatible, ~45KB bundle)
- `instrument()` is compatible with @microlabs/otel-cf-workers API
- `wrapModule()` is compatible with workers-honeycomb-logger API
- Bindings are automatically traced via Proxy pattern
- Bundle size: ~45KB total (autotel-edge 20KB + CF-specific 25KB)

---

## MCP (Model Context Protocol)

**Package:** `autotel-mcp`

**Install:**
```bash
pnpm add autotel-mcp
```

**Server setup:**
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { instrumentMCPServer } from 'autotel-mcp/server';
import { init } from 'autotel';

init({ service: 'my-mcp-server' });

const server = new Server({ name: 'my-server', version: '1.0.0' });
instrumentMCPServer(server, {
  service: 'my-mcp-server',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});

// All registerTool(), registerResource(), registerPrompt() calls are now traced
server.registerTool('my-tool', async (params) => {
  // This handler gets a span automatically
  return { result: 'done' };
});
```

**Client setup:**
```typescript
import { instrumentMCPClient } from 'autotel-mcp/client';

const client = new Client({ name: 'my-client', version: '1.0.0' });
instrumentMCPClient(client);

// All callTool(), getResource(), getPrompt() calls are now traced
```

**Key points:**
- Proxy-based: instruments without modifying the MCP SDK
- Context propagation via `_meta` field (not headers) — works with all transports
- Supports both Node.js and edge runtimes
- Bundle: ~7KB total

---

## Express

**Package:** `autotel` (no framework-specific package needed)

**Install:**
```bash
pnpm add autotel
```

**Setup:**
```typescript
import express from 'express';
import { init, trace, getRequestLogger, createStructuredError } from 'autotel';

init({ service: 'my-api' });

const app = express();

app.post('/api/checkout', (req, res, next) => {
  trace((ctx) => async () => {
    const log = getRequestLogger(ctx);
    const user = await getAuth(req);
    log.set({ user: { id: user.id } });

    const result = await processCheckout(user.id, req.body);
    log.set({ result: { orderId: result.id } });
    log.emitNow();
    res.json(result);
  })().catch(next);
});

app.listen(3000);
```

**Key points:**
- Wrap each handler with `trace()` (no middleware package yet)
- Pass `ctx` to `getRequestLogger(ctx)` since there's no middleware to set up AsyncLocalStorage
- Call `init()` before `app.listen()`
- Use `trace()` factory pattern for access to span context

---

## Fastify

**Package:** `autotel` (no framework-specific package needed)

**Install:**
```bash
pnpm add autotel
```

**Setup:**
```typescript
import Fastify from 'fastify';
import { init, trace, getRequestLogger } from 'autotel';

init({ service: 'my-api' });

const app = Fastify();

app.post('/api/checkout', async (request, reply) => {
  return trace((ctx) => async () => {
    const log = getRequestLogger(ctx);
    log.set({ route: 'checkout' });
    const result = await handleCheckout(request);
    log.emitNow();
    return result;
  })();
});

await app.listen({ port: 3000 });
```

---

## Next.js

**Package:** `autotel` (no framework-specific package needed)

**Install:**
```bash
pnpm add autotel
```

**Setup — API Routes:**
```typescript
// app/api/checkout/route.ts
import { trace, getRequestLogger, createStructuredError } from 'autotel';

export const POST = trace((ctx) => async (request: Request) => {
  const log = getRequestLogger(ctx);
  const body = await request.json();
  log.set({ route: 'checkout', items: body.items?.length });

  const result = await processCheckout(body);
  log.set({ orderId: result.id });
  log.emitNow();
  return Response.json(result);
});
```

**Setup — Init (instrumentation.ts):**
```typescript
// instrumentation.ts (Next.js instrumentation hook)
export async function register() {
  const { init } = await import('autotel');
  init({ service: 'my-nextjs-app' });
}
```

**Key points:**
- Use `instrumentation.ts` for init in Next.js 13.4+
- Wrap API route handlers with `trace()`
- For Server Components, use `trace()` around data fetching functions

---

## Edge Runtimes (Vercel Edge, Netlify Edge, Deno Deploy)

**Package:** `autotel-edge`

**Install:**
```bash
pnpm add autotel-edge
```

**Setup:**
```typescript
import { trace, getRequestLogger } from 'autotel-edge';

export default trace(async (request: Request) => {
  const log = getRequestLogger();
  log.set({ method: request.method, url: request.url });
  // ... handler logic
  log.emitNow();
  return new Response('OK');
});
```

**Key points:**
- No Node.js APIs — uses Web APIs (fetch, crypto.subtle)
- Bundle optimized: ~20KB vs ~700KB for Node.js autotel
- Same `trace()`, `span()`, `getRequestLogger()` API
- Use `autotel-edge/sampling` for custom sampling strategies
- Supports AsyncLocalStorage where available

---

## Cross-Cutting Setup Rules

1. **Always call `init()` once** at the application entry point, before any middleware or handler
2. **Use the framework-specific package** when one exists (Hono, TanStack, Cloudflare, MCP, edge)
3. **Use `getRequestLogger()` with no args** when framework middleware creates the span; pass `ctx` otherwise
4. **Use `createStructuredError()`** for all API errors — it works across all frameworks
5. **Use env vars for production config**: `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`
6. **Never use `await import()` for init** — `init()` must be synchronous
