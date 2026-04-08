# Fastify + autotel Example

This example shows how to use [Fastify](https://fastify.dev) with autotel for HTTP and Fastify automatic instrumentation, plus manual tracing in route handlers.

## What This Example Shows

- Fastify app with autotel initialized before the app loads
- `autoInstrumentations: ['http', 'fastify']` for automatic server spans
- Manual `trace()` in handlers for custom spans (e.g. DB calls)
- Error handling and status codes

## Setup

1. From repo root: `pnpm install`
2. Recommended: run `autotel-devtools` locally, or set `AUTOTEL_DEVTOOLS=embedded` if you have `autotel-devtools` installed
3. Optional: set `OTLP_ENDPOINT` or `PORT` in `.env` when you want to bypass local devtools
3. Run: `pnpm start` (or from root: `pnpm --filter @jagreehal/example-fastify start`)

## How It Works

Autotel is initialized in `instrumentation.ts` (loaded via `--import`) with Fastify and HTTP auto-instrumentation. By default it uses `devtools: true`, so traces, metrics, and logs go to local `autotel-devtools`. Set `AUTOTEL_DEVTOOLS=off` to fall back to the explicit `OTLP_ENDPOINT` environment variables. Use `trace()` from autotel in handlers for additional spans.

```typescript
import Fastify from 'fastify';
import { init } from 'autotel';
// init in instrumentation.ts with autoInstrumentations: ['http', 'fastify']

const app = Fastify();
app.get('/users/:id', async (request, reply) => {
  const user = await fetchUser(request.params.id);
  return user;
});
await app.listen({ port: 3000 });
```

## See Also

- [autotel](../../packages/autotel)
- [Fastify](https://fastify.dev)
- [OpenTelemetry Fastify Instrumentation](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/plugins/node/opentelemetry-instrumentation-fastify)
