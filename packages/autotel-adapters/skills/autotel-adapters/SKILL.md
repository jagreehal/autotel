---
name: autotel-adapters
description: >
  Framework adapters for autotel that add request-scoped logging, tracing, and utility helpers for Next.js, Nitro, Cloudflare Workers, Hono, and TanStack Start.
---

# autotel-adapters

Framework-specific wrappers around autotel's core tracing primitives. Each adapter provides:

- A handler wrapper that opens a span and binds a request-scoped `RequestLogger`
- A `useLogger()` function that retrieves the logger from within the handler
- Direct re-exports of the utilities `parseError`, `createStructuredError`, and `createDrainPipeline`

Options are passed per call site (e.g. `withAutotel(handler, options)`) — there are no
`create*Adapter` factories or `*Toolkit` bundles.

All adapters use `AsyncLocalStorage` (or a `WeakMap` for Cloudflare) internally so logger access is implicit — you never pass a logger through call chains manually.

## Setup

Install the package and the relevant peer dependency for your framework:

```bash
pnpm add autotel-adapters autotel
# peer deps (install only the ones you use)
pnpm add next          # Next.js
pnpm add nitropack h3  # Nitro
pnpm add hono          # Hono
```

## Configuration / Core Patterns

### Next.js

Import from the subpath `autotel-adapters/next` (or from the barrel `autotel-adapters`).

**Option A — per-handler wrap:**

```typescript
import { withAutotel, useLogger } from 'autotel-adapters/next';

export const GET = withAutotel(async (request) => {
  const log = useLogger(request);
  log.info('handling GET');
  return Response.json({ ok: true });
});
```

**Option B — share defaults by passing options at each wrap:**

```typescript
// lib/autotel.ts
import { withAutotel } from 'autotel-adapters/next';

const autotelOptions = {
  spanName: (req) => `api ${new URL(req?.url ?? '/').pathname}`,
  enrichRequest: (req) => ({ 'tenant.id': req?.headers?.get('x-tenant-id') }),
};

export const withTracing = (handler) => withAutotel(handler, autotelOptions);
```

`withAutotel` accepts any function whose first argument is `NextRequestLike`. The `spanName` option can be a static string or a function receiving the request. The auto-enrichment sets `http.request.method`, `url.full`, `http.route`, and `http.request.header.x-request-id`.

### Nitro

```typescript
import { withAutotelEventHandler, useLogger } from 'autotel-adapters/nitro';
import { defineEventHandler } from 'h3';

export default defineEventHandler(
  withAutotelEventHandler(async (event) => {
    const log = useLogger(event);
    log.info('handling event');
    return { ok: true };
  })
);
```

`withAutotelEventHandler` reads `event.method`, `event.path`, and `event.context.requestId` automatically. Pass options as the second argument to share config across handlers.

### Cloudflare Workers

```typescript
import { withAutotelFetch, useLogger } from 'autotel-adapters/cloudflare';

export default {
  fetch: withAutotelFetch(async (request, env, ctx) => {
    const log = useLogger(request);
    log.info('handling fetch');
    return new Response('ok');
  }),
};
```

Cloudflare stores the logger in a `WeakMap` keyed on the request object (no `AsyncLocalStorage` available in Workers). Auto-enrichment also reads `cf.country`, `cf.colo`, and `cf.city`. The `enrich` callback receives `(request, env, ctx)` for access to environment bindings.

### Hono

```typescript
import { Hono } from 'hono';
import { autotelMiddleware, useLogger } from 'autotel-adapters/hono';

const app = new Hono();
app.use('*', autotelMiddleware());

app.get('/', (c) => {
  const log = useLogger();
  log.info('hello hono');
  return c.json({ ok: true });
});
```

Register `autotelMiddleware()` before your routes; it opens a span per request and
binds the logger to `AsyncLocalStorage`, so `useLogger()` (no argument) resolves
inside any downstream handler.

### TanStack Start

```typescript
import { useLogger } from 'autotel-adapters/tanstack';

// Inside a server function or API route already running in an autotel trace:
const log = useLogger({ pathname: '/api/data', method: 'GET' });
log.info('handling request');
```

### Utilities

Each subpath re-exports `parseError`, `createStructuredError`, and
`createDrainPipeline` directly (they also live in `autotel`):

| Export | Description |
|---|---|
| `useLogger(ctx?, opts?)` | Get the request-scoped `RequestLogger` |
| `parseError(error)` | Normalise any thrown value into `ParsedError` |
| `createStructuredError(input)` | Build a `StructuredError` for consistent API error shapes |
| `createDrainPipeline(opts?)` | Create a batching drain pipeline |

### Custom adapter (createUseLogger)

```typescript
import { createUseLogger } from 'autotel-adapters/core';

const useLogger = createUseLogger<MyContext>({
  adapterName: 'my-framework',
  enrich: (ctx) => ({ 'tenant.id': ctx.tenantId }),
});
```

## Common Mistakes

### HIGH — Calling useLogger outside a traced handler

```typescript
// WRONG: no active trace context
export async function myFunction() {
  const log = useLogger(); // throws: "No active trace context"
}
```

```typescript
// CORRECT: always call useLogger inside a handler wrapped with withAutotel / withAutotelEventHandler
export const GET = withAutotel(async (request) => {
  const log = useLogger(request); // ok — trace context is active
  await myFunction(log);          // pass the logger down if needed
});
```

`useLogger` looks up an `AsyncLocalStorage` store populated by the handler wrapper. Calling it outside that wrapper throws.

### HIGH — Importing from wrong subpath

```typescript
// WRONG
import { useLogger } from 'autotel-adapters'; // this is Hono's useLogger from the barrel, not Next's
```

```typescript
// CORRECT: use framework-specific subpaths
import { autotelMiddleware, useLogger } from 'autotel-adapters/hono';
import { useLogger } from 'autotel-adapters/next';
import { withAutotelEventHandler } from 'autotel-adapters/nitro';
```

### MEDIUM — Skipping the request argument in Next.js useLogger

```typescript
// WRONG: loses auto-enrichment (method, url, route, requestId)
const log = useLogger();
```

```typescript
// CORRECT: pass the request so auto-enrichment runs
const log = useLogger(request);
```

The request argument is optional only when you are certain the `AsyncLocalStorage` store is already populated (i.e., called from code deeply nested inside a `withAutotel`-wrapped handler).

### MEDIUM — Not passing request to useLogger on Cloudflare

In Cloudflare Workers, the logger is stored per-request in a `WeakMap`. If you call `useLogger()` without the request object, you always get a new logger with no stored enrichment.

```typescript
// WRONG
const log = useLogger(); // new logger, not the one from withAutotelFetch
```

```typescript
// CORRECT
const log = useLogger(request); // retrieves from WeakMap
```

## Version

Targets autotel-adapters v0.2.4. Peer frameworks: Next.js >=16.2.1, Hono >=4.12.9, Nitro/h3 ^2.0.0. See also: `autotel` (core), `autotel-backends` (vendor configs).
