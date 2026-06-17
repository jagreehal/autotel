# Cloudflare native tracing

Cloudflare Workers ship **native tracing** (beta): enable it in `wrangler` and
Cloudflare automatically instruments fetch / KV / R2 / D1 / Durable Objects /
handlers, lets you add **custom spans** via `tracing.enterSpan()`, and exports
OTLP to any backend (Honeycomb, Grafana, Axiom, Sentry, …) — all configured in
`wrangler` + the dashboard, with **zero exporter code** in your Worker.

autotel integrates with this **automatically**. The same `trace()` / `span()` /
`enterSpan()` code you already write nests inside Cloudflare's native waterfall
when native tracing is on, and falls back to autotel's own OTLP pipeline
everywhere else (other edge runtimes, native off, local `wrangler dev`).

## How it works

1. Enable native tracing in `wrangler` (recent `compatibility_date` required):

   ```toml
   [observability.traces]
   enabled = true
   # head_sampling_rate = 0.1
   # destinations = ["honeycomb-traces"]   # named destination from the dashboard
   ```

2. Keep using your handler wrapper as-is — `instrument`, `wrapModule`,
   `defineWorkerFetch`, or `wrapDurableObject`. On each request the wrapper
   detects `ctx.tracing`, wraps it as a `NativeTracer`, and installs it into the
   active context. Your `trace()` / `span()` / `enterSpan()` calls — even deep
   inside utility functions and libraries — then route to Cloudflare's native
   tracer and nest in the platform waterfall.

When native tracing is active autotel **defers to the platform**:

- **No duplicate spans.** autotel does **not** proxy-instrument bindings
  (KV/R2/D1/…) — Cloudflare already traces them natively.
- **No second pipeline.** autotel does not register its own provider/exporter or
  flush spans; Cloudflare exports everything.

## Configuration: `nativeTracing`

Set on your config (default `'auto'`):

| Value    | Behaviour |
| -------- | --------- |
| `'auto'` | Use native tracing when `ctx.tracing` is detected; otherwise OTLP. |
| `'on'`   | Always prefer native; warns once and falls back to OTLP if absent. |
| `'off'`  | Always use autotel's OTLP exporter (even on Workers). |

```ts
export default wrapModule(
  { service: { name: 'my-worker' }, nativeTracing: 'auto' },
  handler,
);
```

## Backends are fully configurable

- **Native on** → backend is whatever you configure in `wrangler`
  `destinations` + the Cloudflare dashboard (Honeycomb, Grafana, Axiom, Sentry).
- **Native off / non-Workers / local dev** → backend is autotel's `exporter`
  (OTLP to any collector), including **autotel-devtools**.

### Local development with autotel-devtools

`wrangler dev` typically does not export native traces to a local receiver, so
use the OTLP fallback to stream to autotel-devtools:

```bash
npx autotel-devtools          # OTLP receiver + UI on :4318
```

```toml
# wrangler.toml [vars]
OTLP_ENDPOINT = "http://localhost:4318/v1/traces"
NATIVE_TRACING = "off"        # force autotel's OTLP exporter locally
```

For a remote shared devtools instance, point `exporter` at the
`DevtoolsRemoteExporter` endpoint (`{endpoint}/ingest/traces`) or any OTLP URL.

## Graceful degradation

Cloudflare's custom-span `Span` is intentionally minimal — only
`setAttribute(key, value)` and a readonly `isTraced`. autotel's `TraceContext`
is richer, so the bridge degrades gracefully when running natively:

| autotel API                       | Native behaviour |
| --------------------------------- | --------------- |
| `setAttribute`                    | native `setAttribute` |
| `setAttributes` (bulk)            | looped `setAttribute` (primitives; objects JSON-stringified) |
| `isRecording()`                   | native `isTraced` |
| `setStatus(ERROR)` / thrown error | `otel.status_code` + `error` attributes; error rethrows (CF marks the outcome) |
| `recordException(e)`              | `exception.type` / `exception.message` attributes + `console.error(e)` |
| `addEvent(name, attrs)`           | `console.log(name, attrs)` (Cloudflare attributes console output to the span) |
| `correlationId`                   | the `cf-ray` id (fallback uuid for non-fetch triggers), also written as a `correlation.id` span attribute — a real, queryable key **today** |
| `traceId` / `spanId`              | `''` until Cloudflare exposes `spanContext()`; **auto-upgrades** to real ids with no API change once it does |
| `addLink` / `addLinks` / `updateName` | no-op |

> **Correlation today, real ids tomorrow.** Cloudflare's actual trace/span ids
> aren't readable in-code yet, so `ctx.traceId`/`spanId` are `''` under native.
> But autotel surfaces `ctx.correlationId` from the `cf-ray` id and writes it as
> a `correlation.id` attribute on every custom span — the same id the Workers
> logger and the Cloudflare dashboard use — so you get queryable log↔trace
> correlation right now. The bridge also reads `span.spanContext()` if the
> platform ever provides it, so `traceId`/`spanId` light up automatically the
> day Cloudflare ships span identifiers — no code change on your side.

## Architecture

The integration is split across two packages by dependency direction:

- **autotel-edge** (`src/core/native-bridge.ts`) — the runtime-agnostic *seam*:
  the `NativeTracer` / `NativeSpanHandle` contracts, context get/set
  (`withNativeTracer` / `getActiveNativeTracer`), and the degradation adapters.
  Imports only `@opentelemetry/api`; never references Cloudflare. `span()` /
  `trace()` consult the seam.
- **autotel-cloudflare** (`src/native/native-tracing.ts`) — the concrete
  Cloudflare adapter that reads `ctx.tracing`, plus the handler-wrapper wiring
  that installs it and defers to the platform.
