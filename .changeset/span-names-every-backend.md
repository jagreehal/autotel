---
'autotel': minor
'autotel-adapters': patch
'autotel-backends': patch
'autotel-datadog': minor
'autotel-devtools': patch
'autotel-mongoose': major
'autotel-tanstack': minor
'autotel-web': minor
---

Span and route names that group in every backend.

- **autotel**: `setHttpServerRoute(route, { keepExisting: true })` keeps a route already recorded, and `captureHttpServerRoute()` in `autotel/testing` tests the handoff. `httpClientUrlTemplate` names outbound `http` and `fetch` spans `{method} {url.template}`. `spanEnrichers` receive `onEnding`. A hand-built `ExpressInstrumentation` gets the default `ignoreLayersType`. The `default` and `strict` redactor presets cover bank details and date of birth.
- **autotel-adapters**: a fuller route already on the server span, such as Express instrumentation's template across nested routers, stays.
- **autotel-backends**: `otlpRelay` forwards the browser's `user-agent`.
- **autotel-datadog**: `datadogNames()` from `autotel-datadog/names` sets Datadog's `resource.name` on outbound HTTP and MCP spans and `operation.name` on internal spans.
- **autotel-devtools**: the logo and favicon are 🔭.
- **autotel-mongoose**: `instrumentHooks: true` traces every hook except `init`, which fires once per hydrated document. Pass `{ exclude: [] }` to trace it.
- **autotel-tanstack**: server functions are named `METHOD /_serverFn` with the function id as an attribute. With `router: getRouter()`, requests take their matched route, `basepath` and `rewrite` included, and request spans run under the HTTP server span.
- **autotel-web**: full-mode fetch and XHR spans with an id in the path are named `METHOD /clients/:id` with `url.template`, lean-mode spans `browser /clients/:id`, and `urlIdPatterns` adds id formats. `captureException()` records an `exception` span, failed chunk loads group as `chunk_load_error`, lean-mode spans carry the response status, and web-vital targets stay under 100 characters.
