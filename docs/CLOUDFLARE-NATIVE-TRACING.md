# Cloudflare native tracing

Cloudflare Workers ship **native tracing** (beta): enable it in `wrangler` and
Cloudflare automatically instruments fetch / KV / R2 / D1 / Durable Objects /
handlers, lets you add **custom spans** via `tracing.enterSpan()`, and exports
OTLP to any backend (Honeycomb, Grafana, Axiom, Sentry, …). All configured in
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

2. Keep using your handler wrapper as-is: `instrument`, `wrapModule`,
   `defineWorkerFetch`, or `wrapDurableObject`. On each request the wrapper
   detects `ctx.tracing`, wraps it as a `NativeTracer`, and installs it into the
   active context. Your `trace()` / `span()` / `enterSpan()` calls, even deep
   inside utility functions and libraries, then route to Cloudflare's native
   tracer and nest in the platform waterfall.

3. Code outside any wrapper (Durable Object RPC methods, `WorkerEntrypoint`s,
   module helpers) uses the module-level `tracing` export of
   `cloudflare:workers`, so its spans nest too. `wrapDurableObject` /
   `instrumentDO` return the object untouched under native tracing (Cloudflare
   traces DO fetch, alarm, RPC and storage), and `instrumentWorkflow` only adds
   a named span per `step.do()` (Cloudflare records the step RPC, not its name).

When native tracing is active autotel **defers to the platform**:

- **No duplicate spans.** autotel does **not** proxy-instrument bindings
  (KV/R2/D1/…). Cloudflare already traces them natively.
- **No second pipeline.** autotel does not register its own provider/exporter or
  flush spans; Cloudflare exports everything.
- **Handler body = root span.** Outside any `trace()`, the ambient ctx,
  `getRequestLogger()` and `createWorkersLogger()` write to Cloudflare's root
  invocation span. That is the span [Workers Issues](https://developers.cloudflare.com/workers/observability/issues/)
  shows with each occurrence, so `user.id` / `account.id` / the logger's wide
  event (route, colo, country, plan, …) arrive with every grouped error.

### No SDK at all

Workers that cannot or should not carry the SDK can still be observed: list a
Tail Worker built with `autotel-cloudflare/tail` in `tail_consumers`, and every
invocation reaches autotel-devtools / autotel-mcp as OTLP, issues included.
See the package README.

### What autotel still adds on top of native

- One `trace()` / `span()` API that runs on Workers, Node, Deno, Bun and in
  tests, choosing native or OTLP per invocation.
- The request logger / wide events, typed attributes, sampling, subscribers
  (product events), and `correlation.id` (`cf-ray`) on every custom span.
- **Distributed traces.** Native tracing does not propagate `traceparent`
  (verified: outbound `fetch()` carries none and Cloudflare exposes no span ids).
  Set `nativeTracing: 'off'` when a Worker must join traces with non-Cloudflare
  services.
- Named Workflow steps (see above).
- **Issue signals Cloudflare records from logs, as span exceptions** (both
  modes; in native mode they land on the platform span):
  - `console.error(...)` inside an invocation records an exception on the
    active span without setting error status (it was handled). Opt out with
    `captureConsoleErrors: false`.
  - One log template (digits, UUIDs, hex ids collapsed) written more than
    `logFloodThreshold` times (default `100`, `0` disables) in one invocation
    records a single `autotel.LogFlood` exception.
  - A Durable Object whose `alarm()` runs more than `maxRuns` times within
    `windowMs` records one `autotel.RunawayAlarm` exception per window.
    `runawayAlarm: { maxRuns: 10, windowMs: 60_000 }` by default; `false`
    disables.

## Configuration: `nativeTracing`

Set on your config (default `'auto'`):

| Value    | Behaviour                                                          |
| -------- | ------------------------------------------------------------------ |
| `'auto'` | Use native tracing when `ctx.tracing` is detected; otherwise OTLP. |
| `'on'`   | Always prefer native; warns once and falls back to OTLP if absent. |
| `'off'`  | Always use autotel's OTLP exporter (even on Workers).              |

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

`wrangler dev` now exposes `ctx.tracing` too, so in `'auto'` mode local spans go
to Cloudflare's Local Explorer (`/cdn-cgi/explorer`), not to your exporter.
autotel prints a one-time hint when that happens. To stream to autotel-devtools
instead, switch native off in `.dev.vars`, which only `wrangler dev` reads, so
production stays native:

```bash
npx autotel-devtools          # OTLP receiver + UI on :4318
echo 'NATIVE_TRACING=off' >> .dev.vars
```

```toml
# wrangler.toml [vars]
OTLP_ENDPOINT = "http://localhost:4318/v1/traces"
```

and pass `nativeTracing: env.NATIVE_TRACING` in your config.

For a remote shared devtools instance, point `exporter` at the
`DevtoolsRemoteExporter` endpoint (`{endpoint}/ingest/traces`) or any OTLP URL.

## Graceful degradation

The bridge calls each span method only when the runtime has it.
Cloudflare documents `setAttribute`, `setAttributes`, `recordException`,
`isTraced` and `end`; some runtimes also expose `setStatus` and `updateName`.
Anything missing degrades to attributes, so a span never throws for lack of
a method:

| autotel API                | Native behaviour                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `setAttribute`             | native `setAttribute`                                                                                                                      |
| `setAttributes` (bulk)     | native `setAttributes` (objects JSON-stringified); looped `setAttribute` when absent                                                       |
| `isRecording()`            | native `isTraced`                                                                                                                          |
| `setStatus` / thrown error | native `setStatus` when present, else `otel.status_code` / `error` attributes; the original error rethrows                                 |
| `recordException(e)`       | native `recordException` (name, message, stack as a span event), else `exception.*` attributes                                             |
| `updateName`               | native `updateName` when present, else a no-op                                                                                             |
| `addEvent(name, attrs)`    | `console.log(name, attrs)` (Cloudflare attributes console output to the span)                                                              |
| `correlationId`            | the `cf-ray` id (fallback uuid for non-fetch triggers), also written as a `correlation.id` span attribute: a real, queryable key **today** |
| `traceId` / `spanId`       | `''` until Cloudflare exposes `spanContext()`; **auto-upgrades** to real ids with no API change once it does                               |
| `addLink` / `addLinks`     | no-op                                                                                                                                      |

> **Correlation today, real ids tomorrow.** Cloudflare's actual trace/span ids
> aren't readable in-code yet, so `ctx.traceId`/`spanId` are `''` under native.
> But autotel surfaces `ctx.correlationId` from the `cf-ray` id and writes it as
> a `correlation.id` attribute on every custom span: the same id the Workers
> logger and the Cloudflare dashboard use: so you get queryable log↔trace
> correlation right now. The bridge also reads `span.spanContext()` if the
> platform ever provides it, so `traceId`/`spanId` light up automatically the
> day Cloudflare ships span identifiers: no code change on your side.

## Architecture

The integration is split across two packages by dependency direction:

- **autotel-edge** (`src/core/native-bridge.ts`): the runtime-agnostic _seam_:
  the `NativeTracer` / `NativeSpanHandle` contracts, context get/set
  (`withNativeTracer` / `getActiveNativeTracer`), and the degradation adapters.
  Imports only `@opentelemetry/api`; never references Cloudflare. `span()` /
  `trace()` consult the seam.
- **autotel-cloudflare** (`src/native/native-tracing.ts`): the concrete
  Cloudflare adapter that reads `ctx.tracing`, plus the handler-wrapper wiring
  that installs it and defers to the platform.
