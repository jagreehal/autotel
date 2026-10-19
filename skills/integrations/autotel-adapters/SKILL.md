---
name: autotel-adapters
description: >
  Wires request-scoped logging and tracing into Next.js, Nitro, Cloudflare Workers,
  Hono, TanStack Start, Express, Fastify, NestJS, SvelteKit, and Elysia through
  autotel's uniform adapter shape: a handler wrapper (or middleware/interceptor/hook)
  plus useLogger() reachable anywhere in the call stack. Use this
  skill when adding autotel to a framework handler or debugging a useLogger() call
  that returns no context. Do not use for the Hono otel() HTTP-metrics middleware —
  use skill autotel-hono — or for a framework with no packaged adapter, which skill
  autotel-custom-framework covers.
---

# autotel-adapters

Framework-specific wrappers around autotel's core tracing primitives. Each adapter provides:

- A handler wrapper that opens a span and binds a request-scoped `RequestLogger`
- A `useLogger()` function that retrieves the logger from within the handler
- Direct re-exports of the utilities `parseError`, `createStructuredError`, and `createDrainPipeline` (every framework subpath except `tanstack`)

Options are passed per call site (e.g. `withAutotel(handler, options)`). There are no
`create*Adapter` factories. Building an adapter for another framework? `autotel-adapters/toolkit` exports the building blocks the packaged adapters use (`defineFrameworkIntegration`, `createLoggerStorage`, `createMiddlewareLogger`, ...).

All adapters use `AsyncLocalStorage` (or a `WeakMap` for Cloudflare) internally so logger access is implicit. You never pass a logger through call chains manually.

## Setup

Install the package and the relevant peer dependency for your framework:

```bash
pnpm add autotel-adapters autotel
# peer deps (install only the ones you use)
pnpm add next          # Next.js
pnpm add nitropack h3  # Nitro
pnpm add hono          # Hono
pnpm add rxjs          # NestJS (AutotelInterceptor returns an Observable)
```

Express, Fastify, SvelteKit, and Elysia have no peer dependency: the adapters type against structural `*Like` interfaces.

## Configuration / Core Patterns

### Next.js

Import from the subpath `autotel-adapters/next` (or from the barrel `autotel-adapters`).

**Option A, per-handler wrap:**

```typescript
import { withAutotel, useLogger } from 'autotel-adapters/next';

export const GET = withAutotel(async (request) => {
  const log = useLogger(request);
  log.info('handling GET');
  return Response.json({ ok: true });
});
```

**Option B, share defaults by passing options at each wrap:**

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

`redirect()` and `notFound()` work by throwing. `withAutotel` asks Next itself to classify each throw and rethrows navigation signals untouched, so they leave no phantom error on the span. This covers signals wrapped in `cause`. Do not add your own `NEXT_REDIRECT` message matching.

### Nitro

```typescript
import { withAutotelEventHandler, useLogger } from 'autotel-adapters/nitro';
import { defineEventHandler } from 'h3';

export default defineEventHandler(
  withAutotelEventHandler(async (event) => {
    const log = useLogger(event);
    log.info('handling event');
    return { ok: true };
  }),
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

Cloudflare stores the logger in a `WeakMap` keyed on the request object (no `AsyncLocalStorage` available in Workers). Auto-enrichment also sets `cloudflare.country`, `cloudflare.colo`, and `cloudflare.city` from `request.cf`, and falls back to `cf-ray` for the request id. The `enrichRequest` option receives `(request, env, ctx)` for access to environment bindings; `spanName` can be a function of `(request, env)`.

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

For SSE, NDJSON, and AI response streams the handler returns before the work
finishes. `autotelMiddleware()` holds the snapshot until the body closes, errors,
or is cancelled, so `log.set()` calls made during streaming still land. The
response is wrapped without locking the original body. Pass `autoEmit: false` to
call `.emitNow()` yourself.

### TanStack Start

```typescript
import { useLogger } from 'autotel-adapters/tanstack';

// Inside a server function or API route already running in an autotel trace:
const log = useLogger({ pathname: '/api/data', method: 'GET' });
log.info('handling request');
```

### Express

```typescript
import { withAutotel, useLogger } from 'autotel-adapters/express';

app.get(
  '/users/:id',
  withAutotel(async (req, res) => {
    useLogger(req).info('loading user');
    res.json({ ok: true });
  }),
);
```

Wraps one route handler `(req, res, next?)`. Default span name `express.<METHOD>`. Options: `spanName`, `enrichRequest`, `requestLoggerOptions`, `autoEmit`, plus route filtering.

### Fastify

```typescript
import { withAutotel, useLogger } from 'autotel-adapters/fastify';

fastify.get(
  '/users/:id',
  withAutotel(async (request, reply) => {
    useLogger(request).info('loading user');
    return { ok: true };
  }),
);
```

Same option shape as Express; default span name `fastify.<METHOD>`. Uses `request.id` as the request id when present.

### NestJS

```typescript
// main.ts
import { AutotelInterceptor } from 'autotel-adapters/nestjs';

app.useGlobalInterceptors(new AutotelInterceptor());

// any service called from a controller
import { useLogger } from 'autotel-adapters/nestjs';
useLogger().info('loading user');
```

`useLogger()` takes no argument and throws outside a request handled by the interceptor. Options go to the constructor: `new AutotelInterceptor({ enrichRequest })`.

### SvelteKit

```typescript
// src/hooks.server.ts
import { autotelHandle } from 'autotel-adapters/sveltekit';

export const handle = autotelHandle();
```

Then `useLogger()` (no argument) from `autotel-adapters/sveltekit` in load functions, actions, and endpoints. The route is `event.route.id`.

### Elysia

```typescript
import { Elysia } from 'elysia';
import { withAutotelHandler, useLogger } from 'autotel-adapters/elysia';

new Elysia().get(
  '/',
  withAutotelHandler(() => {
    useLogger().info('hello elysia');
    return { ok: true };
  }),
);
```

`autotel` is an alias of `withAutotelHandler`. `useLogger()` takes no argument.

### Barrel exports

`autotel-adapters` re-exports everything from `core` plus: `withAutotel` (Next), `withAutotelEventHandler`, `withAutotelFetch`, `withAutotelExpress`, `withAutotelFastify`, `autotelHandle`, `autotel` / `withAutotelHandler` (Elysia), `autotelMiddleware`, `useLoggerFromContext`, and these `useLogger` aliases: `useLogger` (Hono), `useSvelteKitLogger`, `useElysiaLogger`, `useTanstackLogger`. NestJS is subpath-only.

### Utilities

Each framework subpath except `tanstack` re-exports `parseError`, `createStructuredError`, and
`createDrainPipeline` directly (they also live in `autotel`):

| Export                         | Description                                               |
| ------------------------------ | --------------------------------------------------------- |
| `useLogger(ctx?, opts?)`       | Get the request-scoped `RequestLogger`                    |
| `parseError(error)`            | Normalise any thrown value into `ParsedError`             |
| `createStructuredError(input)` | Build a `StructuredError` for consistent API error shapes |
| `createDrainPipeline(opts?)`   | Create a batching drain pipeline                          |

### Custom adapter (createUseLogger)

```typescript
import { createUseLogger } from 'autotel-adapters/core';

const useLogger = createUseLogger<MyContext>({
  adapterName: 'my-framework',
  enrich: (ctx) => ({ 'tenant.id': ctx.tenantId }),
});
```

## Common Mistakes

### HIGH: Calling useLogger outside a traced handler

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
  await myFunction(log); // pass the logger down if needed
});
```

`useLogger` looks up an `AsyncLocalStorage` store populated by the handler wrapper. Calling it outside that wrapper throws (`No active trace context` for the request-arg adapters; `useLogger() was called outside of an autotel request context` for NestJS, SvelteKit, Elysia).

### HIGH: Importing from wrong subpath

```typescript
// WRONG
import { useLogger } from 'autotel-adapters'; // the barrel's useLogger is Hono's, not Next's
```

```typescript
// CORRECT: use framework-specific subpaths
import { autotelMiddleware, useLogger } from 'autotel-adapters/hono';
import { useLogger } from 'autotel-adapters/next';
import { withAutotelEventHandler } from 'autotel-adapters/nitro';
```

### MEDIUM: Not passing request to useLogger on Cloudflare

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

Targets autotel-adapters v2.0.29. Dependencies: `autotel`, `autotel-edge`. Peers (install the ones you use): `next` >=16.4.0, `hono` >=4.13.13, `h3` ^2.0.2, `nitropack` ^2.13.4, `@tanstack/react-start` ^1.168.61, `@tanstack/solid-start` ^1.168.58, `rxjs` >=7.8.2. See also: `autotel` (core), `autotel-backends` (vendor configs).
