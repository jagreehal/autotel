# Framework setup

Where `init()` goes and how request context reaches a handler, per framework.
For deeper per-framework material see `skills/core/autotel-frameworks/SKILL.md`
and `skills/integrations/autotel-adapters/SKILL.md`.

## Install

```bash
npm install autotel
```

Framework-specific helpers alongside core:

```bash
npm install autotel-cloudflare    # Workers + Durable Objects + Workflows
npm install autotel-edge          # Vendor-agnostic edge runtime base
npm install autotel-hono          # Hono middleware
npm install autotel-tanstack      # TanStack Start
npm install autotel-adapters      # Next.js / Nitro / Hono / Cloudflare adapter toolkit
npm install autotel-vitest        # Span assertions in tests
npm install autotel-playwright    # Browser → server trace propagation
npm install autotel-drizzle       # Drizzle ORM auto-instrumentation
npm install autotel-mongoose      # Mongoose auto-instrumentation
npm install autotel-sentry        # Sentry exporter via OTLP
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
      endpoint: process.env.OTLP_ENDPOINT!,
      sampling: { rates: { server: 25, client: 5 } },
      attributeRedactor: 'default',
    });
  }
}
```

Step 2: Wrap route handlers:

```typescript
// app/api/checkout/route.ts
import { withAutotel } from 'autotel-adapters';

export const POST = withAutotel(async (request: Request) => {
  const log = useLogger();
  log.set({ user: { id: 'usr_123', plan: 'enterprise' } });
  log.set({ cart: { items: 3, total: 14_999 } });
  return Response.json({ ok: true });
});
```

Step 3: Tag Server Actions the same way (`withAutotel`).

Step 4: Browser to server trace propagation: drop in `<TraceProvider />` from `autotel-web` so the W3C `traceparent` header is forwarded automatically.

## Nuxt + Nitro v3

```typescript
// nitro.config.ts
import { defineConfig } from 'nitro';
import autotel from 'autotel-adapters/nitro';

export default defineConfig({
  modules: [
    autotel({ service: 'my-api', sampling: { rates: { server: 25 } } }),
  ],
});
```

```typescript
// routes/api/checkout.post.ts
import { useLogger } from 'autotel-adapters/nitro';

export default defineEventHandler(async (event) => {
  const log = useLogger(event);
  log.set({ action: 'checkout', user: { id: event.context.user?.id } });
  return { ok: true };
});
```

## TanStack Start

```typescript
// nitro.config.ts
import autotel from 'autotel-adapters/nitro';
export default defineConfig({
  modules: [autotel({ service: 'my-app' })],
});
```

```typescript
// src/routes/__root.tsx
import { createMiddleware } from '@tanstack/react-start';
import { autotelMiddleware } from 'autotel-tanstack';

export const Route = createRootRoute({
  server: { middleware: [createMiddleware().server(autotelMiddleware())] },
});
```

## Hono

```typescript
import { Hono } from 'hono';
import { autotelMiddleware, useLogger } from 'autotel-adapters/hono';

const app = new Hono();
app.use('*', autotelMiddleware());

app.get('/api/users', (c) => {
  const log = useLogger();
  log.set({ users: { count: 42 } });
  return c.json({ users: [] });
});
```

## Express / Fastify / Elysia / NestJS

The `autotel-adapters` toolkit ships a uniform shape for these: `withAutotel` middleware + `useLogger()` from anywhere in the call stack. See per-framework docs in `skills/integrations/autotel-adapters/SKILL.md`.

## Cloudflare Workers (with auto `waitUntil`)

`defineWorkerFetch` instruments the handler **and** wires `ctx.waitUntil` for span exports. Without it, async exports silently drop:

```typescript
import { defineWorkerFetch } from 'autotel-cloudflare';

export default defineWorkerFetch(
  { service: { name: 'edge-api' } },
  async (request, env, ctx, log) => {
    log.set({ route: '/health', user: { id: env.userId } });
    return new Response('ok');
  },
);
```

For broader use cases (`scheduled`, `queue`, `email` handlers, Durable Objects, Workflows), use `wrapModule` / `wrapDurableObject` / `instrumentWorkflow`. Same auto-`waitUntil` semantics.

## AWS Lambda

```typescript
import { withLambda } from 'autotel-aws';

export const handler = withLambda(async (event) => {
  const log = useLogger();
  log.set({ event: { source: event.source } });
  return { statusCode: 200 };
});
```

## Standalone Node / scripts

```typescript
import { init, trace } from 'autotel';

init({ service: 'my-worker', endpoint: process.env.OTLP_ENDPOINT! });

const processJob = trace(async (job: Job) => {
  // span auto-named after the function
  const log = useLogger();
  log.set({ job: { id: job.id, source: job.source } });
});
```
