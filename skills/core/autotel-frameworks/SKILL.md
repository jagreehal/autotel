---
name: autotel-frameworks
description: >
  Hono, Fastify, TanStack Start, Cloudflare Workers, NestJS, SvelteKit, Elysia, Nuxt. Middleware and init; getRequestLogger() in handlers. Load when adding Autotel to a web framework.
---

# Autotel: Framework Integration

This skill builds on autotel-instrumentation. Read it first for init() and span creation.

Use framework-specific middleware or wrappers to create a span per request; then call `getRequestLogger()` inside handlers. Most frameworks use `autotel-adapters` subpaths (or a thin wrapper package like `autotel-hono`, `autotel-tanstack`, `autotel-cloudflare`, `autotel-nuxt`).

When adding new request/exception events in framework handlers, prefer correlated logs (`getRequestLogger().info/warn/error`) instead of introducing new `span.addEvent()` usage.

For custom HTTP frameworks, start from `autotel-adapters/toolkit` (`defineFrameworkIntegration`, `createMiddlewareLogger`, `finishResponse` for streaming, `waitUntil` on edge runtimes).

## Setup

### Hono

```typescript
import { Hono } from 'hono';
import { init, getRequestLogger } from 'autotel';
import { otel } from 'autotel-hono';

init({ service: 'my-api' });

const app = new Hono();
app.use('*', otel({ serviceName: 'my-api' }));

app.post('/api/checkout', async (c) => {
  const log = getRequestLogger();
  log.set({ route: 'checkout' });
  const body = await c.req.json();
  log.set({ cart: { items: body.items?.length } });
  log.emitNow();
  return c.json({ ok: true });
});
```

### Fastify

Wrap each route with `withAutotel()` from `autotel-adapters/fastify`: it opens a span, gives the request a logger, and emits one wide event when the handler settles. Read the logger with that adapter's `useLogger(request)` (see apps/example-fastify):

```typescript
import { withAutotel, useLogger } from 'autotel-adapters/fastify';

fastify.get(
  '/api/x',
  withAutotel(async (request) => {
    useLogger(request).set({ route: 'x' });
    return { ok: true };
  }),
);
```

`autotel-adapters/express` has the same `withAutotel` / `useLogger` pair.

### TanStack Start

See packages/autotel-tanstack and apps/example-tanstack-start: middleware and env config. Use `getRequestLogger()` inside server handlers when a span is active.

### Cloudflare Workers

See packages/autotel-cloudflare: init at top level, wrap the fetch handler so each request gets a span. Use `getRequestLogger()` or trace context inside the handler. Pass `ctx.waitUntil` through adapter options so emit/drain completes after the response.

### NestJS

Use `AutotelInterceptor` from `autotel-adapters/nestjs` and `useLogger()` in controllers/services (see apps/example-nestjs):

```typescript
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AutotelInterceptor } from 'autotel-adapters/nestjs';

@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: AutotelInterceptor }],
})
export class AppModule {}
```

### SvelteKit

Add `autotelHandle()` in `hooks.server.ts` from `autotel-adapters/sveltekit`; call `useLogger()` in `+server.ts` / server loads. Use `finishResponse` semantics for streaming routes (see toolkit `stream-response`).

### Elysia

Wrap handlers with `withAutotelHandler()` from `autotel-adapters/elysia` (or the `autotel` alias); use `useLogger()` inside handlers (see apps/example-elysia).

### Nuxt

Add the `autotel-nuxt` module for zero-config Nitro wiring; server code can use `useLogger()` via `autotel-adapters/nitro` re-exports from `autotel-nuxt/runtime/nitro`.

## Core Patterns

**Register middleware before routes:** Middleware creates the span; getRequestLogger() needs that active span.

**Framework-specific packages:** autotel-hono, autotel-tanstack, autotel-cloudflare, autotel-nuxt. Adapter subpaths: autotel-adapters/{express,fastify,next,nitro,nestjs,sveltekit,elysia,...}. Install the package for your framework and follow its README or CLAUDE.md.

**Streaming responses:** defer `emitNow` until the body finishes via adapter `finishResponse` / toolkit `bindStreamingResponseLifecycle`.

**Edge drain:** pass `waitUntil` (Cloudflare `ExecutionContext`, etc.) so async emit/drain does not block the response.

## Common Mistakes

### HIGH Use getRequestLogger() in Hono without registering middleware first

Wrong:

```typescript
const app = new Hono();
app.get('/api/x', (c) => {
  const log = getRequestLogger();
  return c.json({});
});
```

Correct:

```typescript
const app = new Hono();
app.use('*', otel());
app.get('/api/x', (c) => {
  const log = getRequestLogger();
  return c.json({});
});
```

Middleware creates the span per request. Without it, getRequestLogger() has no active span and will throw.

`otel()` from `autotel-hono` only creates the span (plus request metrics); you call `emitNow()`. The alternative, `autotelMiddleware()` from `autotel-adapters/hono`, also emits the wide event for you; read its logger with `useLogger(c)` from the same subpath, not `getRequestLogger()`, which would build a second logger whose fields miss that event. Pick one per app.

Source: packages/autotel-hono/src/index.ts, packages/autotel-adapters/src/hono.ts

## Version

Matches autotel 8.x. Verify package exports when working against an older installed version.

See also:

- `autotel-instrumentation/SKILL.md` for init and spans
- `autotel-request-logging/SKILL.md` for request logger usage
