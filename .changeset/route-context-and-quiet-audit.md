---
'autotel': minor
'autotel-adapters': patch
'autotel-audit': minor
'autotel-aws': patch
'autotel-backends': patch
'autotel-cli': patch
'autotel-cloudflare': patch
'autotel-devtools': patch
'autotel-drizzle': patch
'autotel-eventcatalog': patch
'autotel-hono': patch
'autotel-mcp': patch
'autotel-mcp-instrumentation': patch
'autotel-playwright': patch
'autotel-plugins': patch
'autotel-tanstack': major
'autotel-terminal': patch
'autotel-web': patch
---

**autotel-tanstack:** `traceLoader` and `traceBeforeLoad` take the route context first and run your function inside their span:

```ts
beforeLoad: (ctx) => traceBeforeLoad(ctx, async ({ search }) => { ... }),
loader: (ctx) => traceLoader(ctx, async ({ params }) => { ... }),
```

TanStack Router keeps typing `params`, `search` and the context `beforeLoad` returns, and spans you start inside a loader nest under it. `createTracedRoute(id).loader` and `.beforeLoad` take the context the same way.

**autotel-audit:** `withAudit` and `securityEvent` default `onMissingContext` to `skip` when telemetry is off (no `init()` and no tracer provider) and to `warn` otherwise. `configureAudit({ onMissingContext })` sets a process-wide default; a per-call option overrides it.

**autotel:** `hasTracerProvider()` reports whether an isolated or global tracer provider can record spans.

**autotel-aws:** `autoInstrumentAWS()` loads the Smithy client in the ESM build as well as CJS.

**autotel-mcp:** invalid CLI arguments set exit code 2.

Dependencies are refreshed across the packages.
