# Hono + autotel-hono Example

This example shows how to use [Hono](https://hono.dev) with [autotel-hono](https://github.com/jagreehal/autotel/tree/main/packages/autotel-hono) for HTTP tracing and metrics.

## What This Example Shows

- Hono app on Node.js via `@hono/node-server`
- `otel()` from `autotel-hono` and `useLogger()` from `autotel-adapters/hono` for request-scoped DX
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
import { useLogger } from 'autotel-adapters/hono';

const app = new Hono();
app.use('*', otel({ serviceName: 'my-service' }));
app.get('/users/:id', (c) => {
  const log = useLogger(c);
  log.set({ userId: c.req.param('id') });
  return c.json({ ok: true });
});

app.get('/users/:id', async (c) => {
  const user = await fetchUser(c.req.param('id'));
  return c.json(user);
});

serve(app);
```

## What am I not seeing?

A backend can only describe the spans it received, so it can never name a
handler that emitted nothing. `autotel map` reads the source instead: it walks
the project, scores every entry point, and writes `autotel.map.json`, which is
committed here.

```bash
pnpm map        # score every entry point, write autotel.map.json
pnpm map:check  # fail on a regression against the committed map (CI)
pnpm coverage   # join the map against what actually arrived
```

`pnpm coverage` starts a devtools in-process, calls two of the five entry
points, and asserts that Coverage reports the two as seen and the rest as dark:

```
Coverage: 2 of 5 entry points seen

  DARK  ANY *                        0 spans
  DARK  GET /health                  0 spans
  DARK  GET /error                   0 spans
  seen  GET /users/:userId           1 spans
  seen  GET /users/:userId/orders    1 spans
```

It also asserts that a project with no map gets a 404 rather than an empty
report, because "0 of 0" would read as a clean bill of health. The script exits
non-zero when either claim stops holding.

`src/app.ts` holds the routes and `src/index.ts` serves them, so the coverage
check can drive the same app through `app.request()` without a port.

## See Also

- [autotel-hono](../../packages/autotel-hono)
- [Hono](https://hono.dev)
- [@hono/node-server](https://github.com/honojs/node-server)
