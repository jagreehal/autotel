# autotel-adapters

Composable framework adapters and DX helpers for `autotel`.

`autotel-adapters` gives easy to use ergonomics (`with...`, `useLogger(...)`,
`parseError`) while keeping one trace-native stack under the hood.

## Included adapters

- `autotel-adapters/hono`
- `autotel-adapters/tanstack`
- `autotel-adapters/next`
- `autotel-adapters/nitro`
- `autotel-adapters/cloudflare`
- `autotel-adapters/express`
- `autotel-adapters/fastify`
- `autotel-adapters/nestjs`
- `autotel-adapters/sveltekit`
- `autotel-adapters/elysia`
- `autotel-adapters/toolkit` (custom framework integrations)
- `autotel-adapters/toolkit/storage` (edge-safe ALS helper)
- `autotel-adapters/core` (build your own adapter)

## Custom frameworks

Use `defineFrameworkIntegration()` from `autotel-adapters/toolkit` to wire a new HTTP framework. See `examples/community-framework-skeleton/` for a minimal skeleton.

Toolkit options include route `include` / `exclude`, per-route `service`, serverless `waitUntil`, streaming `finishResponse`, and request-level `keep` callbacks.

## When to use `withAutotel` vs `useLogger` alone

Each adapter exports two patterns. Choose based on whether you already have
autotel tracing middleware:

**`withAutotel()` - use when you have NO existing autotel middleware.**
It creates a span and injects a request logger automatically:

```ts
import { withAutotel, useLogger } from 'autotel-adapters/next';

export const POST = withAutotel(async (request) => {
  const log = useLogger(request);
  log.set({ feature: 'checkout' });
  return Response.json({ ok: true });
});
```

**`useLogger()` alone - use when middleware already creates the span.**
For example, `autotel-hono` middleware (`otel()`) already creates a span per
request. Wrapping with `withAutotel` too would create a **duplicate span**:

```ts
import { otel } from 'autotel-hono';
import { useLogger } from 'autotel-adapters/hono';

app.use('*', otel());
app.get('/orders/:id', (c) => {
  const log = useLogger(c);
  log.set({ route: c.req.path });
  return c.json({ ok: true });
});
```

## Core usage

```ts
import { createUseLogger } from 'autotel-adapters/core';

const useLogger = createUseLogger<{ requestId?: string }>({
  adapterName: 'custom-framework',
  enrich: (ctx) => ({ request_id: ctx.requestId }),
});
```

## Next.js

```ts
import { withAutotel, useLogger, parseError } from 'autotel-adapters/next';

export const POST = withAutotel(async (request: Request) => {
  const log = useLogger(request);
  log.set({ feature: 'checkout' });

  try {
    return Response.json({ ok: true });
  } catch (error) {
    const parsed = parseError(error);
    log.set({ error_status: parsed.status, error_why: parsed.why });
    throw error;
  }
});
```

Navigation helpers such as `redirect()` and `notFound()` remain framework
control flow: `withAutotel()` rethrows their signals without recording a
phantom request error, including when a signal is wrapped in `cause`.

## Nitro

```ts
import { withAutotelEventHandler, useLogger } from 'autotel-adapters/nitro';

export default withAutotelEventHandler(async (event) => {
  const log = useLogger(event, 'api-service');
  log.set({ route: event.path });
  return { ok: true };
});
```

## Hono

```ts
import { otel } from 'autotel-hono';
import { useLogger } from 'autotel-adapters/hono';

app.use('*', otel());
app.get('/orders/:id', (c) => {
  const log = useLogger(c);
  log.set({ route: c.req.path });
  return c.json({ ok: true });
});
```

`autotelMiddleware()` also observes SSE, NDJSON, and AI response streams. The
request snapshot is emitted once when the body closes, errors, or is cancelled,
so context added during streaming is retained.

## Cloudflare Workers

```ts
import { withAutotelFetch, useLogger } from 'autotel-adapters/cloudflare';

export default {
  fetch: withAutotelFetch(async (request, env, ctx) => {
    const log = useLogger(request);
    log.set({ route: new URL(request.url).pathname });
    return Response.json({ ok: true });
  }),
};
```
