---
'autotel': minor
'autotel-adapters': minor
'autotel-cli': minor
'autotel-hono': minor
'autotel-mcp': minor
'autotel-subscribers': minor
'autotel-eventcatalog': minor
---

Next.js, Prisma and Hono support, measured event consumers, and devtools logs in autotel-mcp.

**autotel**

- New `ignoreRoutes` option drops whole requests by route: the resolved `http.route` or `next.route` when the span has one, else `url.path` or `http.target` with dot segments resolved.
- Under Next.js, `init()` drops the `AppRender.fetch` span when an undici span traced the same call, drops Next's telemetry call, and strips query strings from fetch span names.
- Prisma spans export under Next.js: `init()` republishes `@prisma/instrumentation`'s provider once its own exists.
- `init()` names any instrumentation running on a second copy of `@opentelemetry/api`.
- **The `attributeRedactor` presets, including `'default'` in production, replace URL query and fragment values with `REDACTED`** in `url.full`, `url.query`, `http.url` and `http.target`, keeping parameter names. They also replace literals in MongoDB query text with `?`, keeping field paths inside `$expr` and expression stages such as `$group`. Custom configs opt in with `urlQueryValues: true` and `mongoQueryLiterals: true`.
- `trace()` warns once when handed a `ctx => async () => …` factory, and points to `withTracing()` or `trace.run()`.
- A status set through `getActiveSpan().setStatus()` inside `trace()` stays on the span.
- `createTraceCollector()` spans start UNSET and expose `status`.
- The resource keeps `host.name` and drops `datadog.host.name`.
- README: span filtering, Next.js and Prisma setup.

**autotel-adapters**

- New `autotel-adapters/next-config`: `withAutotelConfig(nextConfig, { externals })` adds `@opentelemetry/api` and your instrumentations to `serverExternalPackages`, so every bundle shares one API copy. It throws when a package is missing from the app's dependencies.

**autotel-cli**

- `autotel map` reads Hono apps built with `@hono/zod-openapi` (`.openapi(createRoute(...))`) and `hono-openapi`, and follows `.route()` and `.basePath()` across files, default exports, factory functions and tsconfig `paths` aliases. Paths built from constants resolve.
- On a Next.js app, `autotel map` reports the routes of a Hono app served from a `hono/vercel` catch-all in place of the catch-all.

**autotel-hono**

- New `getRoute(c)` option sets the route reported for `http.route`, the span name and the duration metric.
- A failed request sets `error.type` on the span and the duration metric: the exception class, or the status for a 5xx.
- Both instruments use `DOUBLE`, so the middleware runs on Deno's built-in meter.
- A request built by a second copy of Hono reports the request's own `routePath`.

**autotel-mcp**

- The devtools backend reads devtools' stores: `search_logs` and `correlate` query its logs, and `get_trace`, listings and the service map read retained traces.
- New `get_metric_series` tool returns a metric's data points over a time window.
- Metrics endpoint errors surface as errors; a 404 marks an older devtools.

**autotel-subscribers and autotel-eventcatalog**

- `ArchitectureSnapshotSubscriber` gains a `spanProcessor` that records which consumers received each event, from `traceConsumer` spans linked to the producer span, under `observedConsumers`. A new `onConsumerObserved` option reports each receipt.
- `autotel-eventcatalog map` reads measured snapshots: a declared consumer nobody received on shows as `declared-only`, and an undeclared one as `undocumented`. Live mode takes `liveConsumeEventName` for `{ event, consumer }` frames.
