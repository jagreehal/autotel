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

The request handle also exposes `markOutcome({ status, error })`, which records the status code and error on the span without emitting the snapshot, and `finishResponse(response, { error })` for an error the framework caught on the way to the response.

## Span names and attributes

Request spans follow the OpenTelemetry HTTP conventions:

- `http.route` holds the matched route template (`/users/:id`), and the span is named `{METHOD} {route}`, or `{METHOD}` when no route matched.
- `url.path` holds the raw request path.
- A 5xx response ends the span with status ERROR. A 4xx leaves the status unset.

Next.js and Cloudflare Workers have no matched route to read, so they set only `url.path`. Pass `http.route` through `enrichRequest` and a name through `spanName`:

```ts
export const GET = withAutotel(handler, {
  spanName: 'GET /api/orders/[id]',
  enrichRequest: () => ({ 'http.route': '/api/orders/[id]' }),
});
```

Hono reads the last matched route after routing and records the error it caught on `c.error` for a 5xx. NestJS records `Controller.handler` as `code.function.name`.

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

`withAutotel()` is for route handlers: it reads its first argument as the
request. A server action has no request (its first argument is its form data
or its own argument), so wrap it with `withAutotelAction()` instead. The span
is `action.<name>`, the wide event carries no HTTP fields, and `useLogger()`
works inside:

```ts
'use server';
import { withAutotelAction, useLogger } from 'autotel-adapters/next';

export const save = withAutotelAction('save', async (formData: FormData) => {
  useLogger().set({ 'item.id': formData.get('id') });
});
```

Navigation helpers such as `redirect()` and `notFound()` remain framework
control flow: both wrappers rethrow their signals without recording a
phantom error, including when a signal is wrapped in `cause`.

### `next.config`: one `@opentelemetry/api`

```ts
// next.config.ts
import { withAutotelConfig } from 'autotel-adapters/next-config';

export default withAutotelConfig(
  { reactCompiler: true },
  { externals: ['@prisma/instrumentation'] }, // optional
);
```

Next bundles every server package it is not told to keep external. When autotel
and an instrumentation land on different sides of that line they run on two
copies of `@opentelemetry/api`. `withAutotelConfig` adds `@opentelemetry/api` (and `externals`) to
`serverExternalPackages`, so every bundle loads the app's one copy.

Each of them must be a dependency of the app: Next bundles a listed
package it cannot resolve from the app directory, which is what happens to a
workspace package's dependency in a monorepo. `withAutotelConfig` fails the
build instead. `autotel-adapters/next-config` has no runtime dependency, so
`next.config.ts` can import it.

Hono inside Next follows the same rule: keep `autotel-adapters` and `hono` on
the same side of that line. Bundle both with the app, or list both in
`serverExternalPackages`. When they resolve different copies, the Hono adapter
names the route through the request instead and warns once.

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
