# Hono + autotel-hono Example

This example shows how to use [Hono](https://hono.dev) with [autotel-hono](https://github.com/jagreehal/autotel/tree/main/packages/autotel-hono) for HTTP tracing and metrics.

## What This Example Shows

- Hono app on Node.js via `@hono/node-server`
- `otel()` middleware from autotel-hono for automatic HTTP server spans and metrics
- Manual tracing in route handlers with `trace()` from autotel
- Optional capture of request/response headers

## Setup

1. From repo root: `pnpm install`
2. Optional: set `OTLP_ENDPOINT` or `PORT` in `.env`
3. Run: `pnpm start` (or from root: `pnpm --filter @jagreehal/example-hono start`)

## How It Works

Autotel is initialized in `instrumentation.ts` (loaded via `--import`). The Hono app uses `otel()` middleware so every request gets a server span and request-duration/active-requests metrics. Handlers can use `trace()` for custom spans (e.g. DB calls).

```typescript
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { otel } from 'autotel-hono';

const app = new Hono();
app.use('*', otel({ serviceName: 'my-service' }));

app.get('/users/:id', async (c) => {
  const user = await fetchUser(c.req.param('id'));
  return c.json(user);
});

serve(app);
```

## See Also

- [autotel-hono](../../packages/autotel-hono)
- [Hono](https://hono.dev)
- [@hono/node-server](https://github.com/honojs/node-server)
