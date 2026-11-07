---
name: autotel-custom-framework
description: >
  Use this skill when instrumenting a web framework or runtime that autotel has no packaged adapter for — build your own request middleware from the primitives: trace()/span() for the request span, getActiveTraceContext()/getRequestLogger() to attach attributes, and W3C context propagation to continue an incoming trace and forward it downstream.
---

# autotel-custom-framework

Autotel ships adapters for TanStack Start, Hono, Cloudflare, Nuxt, and the Next.js/Nitro toolkit. For anything else, you assemble the same behavior from the core primitives in about a dozen lines. The pattern: extract the incoming trace context, open a request span, expose a request logger to your handler, and record the response.

## When to use

- A framework with no `autotel-*` adapter (Koa, Express variants, a custom HTTP server, a queue consumer).
- A non-HTTP entry point (cron, worker loop) that should start a trace.

## The middleware pattern

```ts
import { context, propagation } from '@opentelemetry/api';
import { trace, getRequestLogger } from 'autotel';

export async function withAutotel(
  req: MyRequest,
  handler: () => Promise<MyResponse>,
) {
  // 1. Continue an incoming distributed trace from request headers.
  const parent = propagation.extract(
    context.active(),
    headersToObject(req.headers),
  );

  return context.with(parent, () =>
    trace({ name: `${req.method} ${req.route}` }, async (ctx) => {
      ctx.setAttributes({
        'http.request.method': req.method,
        'url.path': req.path,
      });

      // 2. Request-scoped logger: one wide event per request.
      const log = getRequestLogger();
      log.set({ route: req.route });

      // 3. Run the handler, record the outcome.
      const res = await handler();
      ctx.setAttribute('http.response.status_code', res.status);
      return res;
    }),
  );
}
```

`getRequestLogger()` requires an active span, so call it inside the `trace()` callback. It emits one correlated event when the request span ends.

## Hand the route to the HTTP server span

Under `@opentelemetry/instrumentation-http`, the span a backend groups by is the HTTP server span, opened before your middleware runs. Once the framework has matched a route, hand it the template:

```ts
import { setHttpServerRoute } from 'autotel';

// Fills in `http.route` and renames the server span `GET /users/:id` when
// the response ends. keepExisting leaves a fuller template another
// instrumentation recorded, such as Express's across nested routers.
setHttpServerRoute(req.routeTemplate, { keepExisting: true });
```

Pass the template, never the concrete path: `/users/42` puts every user in its own group. Call it from the request's own context. A context built from `ROOT_CONTEXT` drops the server span, and the route goes nowhere.

Test the handoff with `captureHttpServerRoute()` from `autotel/testing`, which runs your handler as a request served under the HTTP instrumentation and returns the route it handed over.

## Forward the trace downstream

When your handler calls another service, inject the active context so the trace continues across the hop.

```ts
import { context, propagation } from '@opentelemetry/api';

const headers: Record<string, string> = {};
propagation.inject(context.active(), headers);
await fetch(url, { headers }); // downstream service joins this trace
```

If you use the official undici/http instrumentation, this injection happens for you; do it by hand only for a transport that isn't instrumented.

## Non-HTTP entry points

The same shape works without a request. Wrap the unit of work in `trace()`, set attributes, and let the span carry the operation.

```ts
import { trace, getActiveTraceContext } from 'autotel';

const processJob = trace(async (job: Job) => {
  getActiveTraceContext()?.setAttribute('job.id', job.id);
  await handle(job);
});
```

## Common mistakes

### HIGH: Calling `getRequestLogger()` or `getActiveTraceContext()` outside a span

Both need an active span. Call them inside the `trace()` / `span()` callback, not before it opens.

### HIGH: Skipping `propagation.extract` on the way in

Without it, every request starts a fresh trace and you lose the link to the calling service. Extract from the incoming headers and run the handler under that context.

### MEDIUM: Rebuilding span export or transport in the adapter

The adapter only opens spans and sets attributes. Export, sampling, and batching belong to `init()`. Don't add an exporter here.

## Related

- `autotel-core` — `trace()`, `span()`, `getRequestLogger()`, and context helpers.
- `autotel-adapters` — the uniform shape the official adapters use; a good template if you later package yours.
- `autotel-custom-exporter` — where span transport actually belongs.
