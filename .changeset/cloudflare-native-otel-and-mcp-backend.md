---
'autotel-edge': minor
'autotel-cloudflare': minor
'autotel-mcp': minor
'autotel-cli': minor
---

Cloudflare: OpenTelemetry API spans join the native trace waterfall, and autotel-mcp reads what Cloudflare stores.

- `autotel-edge` / `autotel-cloudflare`: under native tracing, spans from libraries that call `@opentelemetry/api` (AI SDK telemetry, `autotel-genai`, instrumentation packages) route to Cloudflare's `tracing.startActiveSpan()` and `tracing.startSpan()`, with `enterSpan()` on older runtimes. `NativeTracer` gains optional `startSpan` and `startActiveSpan`; `NativeSpanHandle` gains optional `end`. A second `WorkerTracerProvider.register()` reconfigures the installed tracer.
- `autotel-mcp`: new `cloudflare` backend over Cloudflare's SQL API, serving traces (`logs.traces`) and Workers logs (`logs.workersLogs`). Set `AUTOTEL_BACKEND=cloudflare`, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (Account Analytics Read). `HttpError` carries the response body.
- `autotel-cli`: `autotel investigate --backend cloudflare --cloudflare-account <id>`.
