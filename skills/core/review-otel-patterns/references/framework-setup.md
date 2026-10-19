# Framework setup

Where `init()` goes and how request context reaches a handler, per framework.
For deeper per-framework material see `skills/core/autotel-frameworks/SKILL.md`
and `skills/integrations/autotel-adapters/SKILL.md`.

Inside any active span, `getRequestLogger()` from `autotel` returns the request
logger. Adapter subpaths (`autotel-adapters/<framework>`) also export their own
`useLogger()`; use that one in adapter-wrapped handlers.

## Install

```bash
npm install autotel
```

Framework-specific helpers alongside core:

```bash
npm install autotel-cloudflare    # Workers + Durable Objects + Workflows
npm install autotel-edge          # Vendor-agnostic edge runtime base
npm install autotel-hono          # Hono middleware (otel())
npm install autotel-tanstack      # TanStack Start
npm install autotel-nuxt          # Nuxt module
npm install autotel-aws           # Lambda + AWS SDK
npm install autotel-adapters      # Next.js / Nitro / Express / Fastify / NestJS / SvelteKit / Elysia
npm install autotel-web           # Browser → server trace propagation
npm install autotel-vitest        # A span per test
npm install autotel-playwright    # Span per Playwright test + traceparent on API requests
npm install autotel-drizzle       # Drizzle ORM instrumentation
npm install autotel-mongoose      # Mongoose instrumentation
npm install autotel-sentry        # Sentry OTLP endpoint + headers from a DSN
```

## Next.js (App Router)

Step 1: Initialise once in `instrumentation.ts`:

```typescript
// instrumentation.ts
import { init } from 'autotel';

export function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    init({
      service: 'my-app',
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT, // base URL
      attributeRedactor: 'default',
    });
  }
}
```

Step 2: Wrap route handlers:

```typescript
// app/api/checkout/route.ts
import { withAutotel, useLogger } from 'autotel-adapters/next';

export const POST = withAutotel(async (request: Request) => {
  const log = useLogger(request);
  log.set({ user: { id: 'usr_123', plan: 'enterprise' } });
  log.set({ cart: { items: 3, total: 14_999 } });
  return Response.json({ ok: true });
});
```

Step 3: Server Actions take the same wrapper: `withAutotel(action, { spanName: 'action.checkout' })`.

Step 4: Browser to server trace propagation: call `init({ service: 'my-frontend' })` from `autotel-web` once in client code; it patches `fetch` / XHR to send the W3C `traceparent` header.

## Nuxt + Nitro

Nuxt: add the module, configure with `OTEL_SERVICE_NAME` / `OTEL_EXPORTER_OTLP_ENDPOINT`:

```typescript
// nuxt.config.ts
export default defineNuxtConfig({ modules: ['autotel-nuxt'] });
```

Plain Nitro: call `init()` once in a Nitro plugin. Either way, wrap handlers:

```typescript
// server/api/checkout.post.ts
import { withAutotelEventHandler, useLogger } from 'autotel-adapters/nitro'; // Nuxt: 'autotel-nuxt/runtime/nitro'

export default withAutotelEventHandler(async (event) => {
  const log = useLogger(event);
  log.set({ action: 'checkout', user: { id: event.context.user?.id } });
  return { ok: true };
});
```

## TanStack Start

```typescript
// src/instrumentation.ts
import { init } from 'autotel';
init({ service: 'my-app', endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT });
```

```typescript
// src/start.ts
import { createStart, createMiddleware } from '@tanstack/react-start';
import { createTracingServerHandler } from 'autotel-tanstack/middleware';
import './instrumentation';

const requestTracing = createMiddleware().server(
  createTracingServerHandler({ excludePaths: ['/health'] }),
);

export const startInstance = createStart(() => ({
  requestMiddleware: [requestTracing],
}));
```

`tracingMiddleware()` / `createTracingMiddleware()` from the same subpath are the non-`createMiddleware` forms.

## Hono

```typescript
import { Hono } from 'hono';
import { init, getRequestLogger } from 'autotel';
import { otel } from 'autotel-hono';

init({ service: 'my-api' });

const app = new Hono();
app.use('*', otel()); // register before routes

app.get('/api/users', (c) => {
  const log = getRequestLogger();
  log.set({ users: { count: 42 } });
  return c.json({ users: [] });
});
```

`otel()` already opens the request span: don't also wrap routes in an adapter `withAutotel`, or you get duplicate spans.

## Express / Fastify / Elysia / NestJS / SvelteKit

Each has an `autotel-adapters` subpath with its own `useLogger()`: `withAutotel` (`/express`, `/fastify`), `withAutotelHandler` (`/elysia`), `AutotelInterceptor` (`/nestjs`), `autotelHandle()` (`/sveltekit`, in `hooks.server.ts`). Call `init()` once at startup first. See `skills/integrations/autotel-adapters/SKILL.md`.

## Cloudflare Workers (with auto `waitUntil`)

`defineWorkerFetch` instruments the handler **and** wires `ctx.waitUntil` for span exports. Without it, async exports silently drop:

```typescript
import { defineWorkerFetch } from 'autotel-cloudflare';

export default defineWorkerFetch(
  {
    service: { name: 'edge-api' },
    exporter: {
      url: 'https://api.honeycomb.io/v1/traces',
      headers: { 'x-honeycomb-team': '<key>' },
    },
  },
  async (request, env, ctx, log) => {
    log.set({ route: '/health' });
    return new Response('ok');
  },
);
```

For broader use cases (`scheduled`, `queue`, `email` handlers, Durable Objects, Workflows), use `wrapModule` / `wrapDurableObject` / `instrumentWorkflow`. Same auto-`waitUntil` semantics.

## AWS Lambda

```typescript
import { init, getRequestLogger } from 'autotel';
import { wrapHandler } from 'autotel-aws/lambda';

init({
  service: 'my-lambda',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});

export const handler = wrapHandler(async (event) => {
  const log = getRequestLogger();
  log.set({ event: { source: event.source } });
  return { statusCode: 200 };
});
```

`traceLambda` is the alternative wrapper; `import 'autotel-aws/lambda/auto'` is zero-config from env vars.

## Standalone Node / scripts

```typescript
import { init, trace, getRequestLogger } from 'autotel';

init({
  service: 'my-worker',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});

const processJob = trace('processJob', async (job: Job) => {
  const log = getRequestLogger();
  log.set({ job: { id: job.id, source: job.source } });
});
```

A one-shot script that emits a handful of spans should not set `sampling: 'production'`, which keeps only ~10% of normal traces. Leave it unset or use `'development'`.
