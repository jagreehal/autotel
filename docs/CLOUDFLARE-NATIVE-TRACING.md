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
- **One pipeline.** Cloudflare exports and flushes every span. autotel
  registers its tracer so OpenTelemetry API spans reach the platform.
- **OpenTelemetry API spans join the waterfall.** Libraries that call
  `@opentelemetry/api` directly (AI SDK `experimental_telemetry`,
  `autotel-genai`, `@opentelemetry/instrumentation-*`) emit native spans.
  `tracer.startActiveSpan()` maps to `tracing.startActiveSpan()`, and the
  platform nests `fetch` and child spans under it. `tracer.startSpan()` maps to
  `tracing.startSpan()`, a child of the active span. Cloudflare takes a name
  only, so autotel applies `attributes` after start; parent context, `root`,
  `kind` and links have no native equivalent. To parent children, use
  `startActiveSpan()`. On older runtimes autotel uses `enterSpan()`.
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
  (product events), and `correlation.id` on every custom span.
- **Distributed traces.** Set `nativeTracing: 'off'` when a Worker joins
  traces with services outside Cloudflare. autotel's OTLP mode reads and writes
  `traceparent` itself. Checked 2026-10-04 on a `workers.dev` Worker: native
  mode sends no `traceparent` on outbound `fetch()` and starts a fresh trace
  for each request. Cloudflare Traces (zone-level, beta) adds
  `propagation-policy` and `forward-context` per zone for the edge-to-origin
  hop.
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

With `'off'`, `instrumentWorkflow` registers the OTLP provider itself and
exports the run and step spans before `run()` resolves.

```ts
export default wrapModule(
  { service: { name: 'my-worker' }, nativeTracing: 'auto' },
  handler,
);
```

## Querying what Cloudflare stored

Cloudflare's SQL API serves the spans and Workers logs it keeps
(`logs.traces`, `logs.workersLogs`). Point autotel-mcp at it and you get the
same investigation tools as any other backend:

```bash
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... npx autotel-mcp --backend cloudflare
```

The token needs Account Analytics Read. Cloudflare writes `cloudflare.ray_id`
on the root invocation span, and autotel writes the same value as
`correlation.id` on custom spans.

## Workers Issues

[Workers Issues](https://developers.cloudflare.com/workers/observability/issues/)
groups a Worker's failures without an SDK: uncaught exceptions, failed
invocations, `5xx` responses, `console.error` lines carrying an `Error`, and
(checked live on 2026-10-27) exceptions recorded on a native span. Turn it on
with `observability.issues.enabled = true` in Wrangler (4.134.0+), and upload
source maps (`upload_source_maps = true`) so stacks point at your source
rather than the bundle. List what it found with
`cf observability issues list --service <worker>`.

autotel feeds it in two ways:

- **Handled errors.** `log.error(err)` makes an error you catch and answer
  with a fallback response an occurrence. Under native tracing the exception
  it records on the span is enough. When the logger's span cannot record it
  natively (OTLP mode, traces off, an older runtime without
  `recordException`) it also writes `console.error(err)`, the only path in
  there. It never does both, which would group one error as two issues.
- **Application context.** Each occurrence shows the attributes on the active
  span. `log.set({ 'user.id': ..., 'session.id': ... })` early in the handler
  writes them there (`user.id` shows as the occurrence's user). Native tracing
  must be on for this part. Issue data is sent to whatever destination an
  automation names (chat, a coding agent).
  Native spans skip autotel's processors, so nothing redacts them: keep
  secrets and tokens out of attributes and error messages.

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
`isTraced` and `end`, plus `spanContext`, `setStatus` and `updateName` since
26 October 2026. On an older runtime anything missing degrades to attributes,
so a span never throws for lack of a method:

| autotel API                | Native behaviour                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `setAttribute`             | native `setAttribute`                                                                                                                      |
| `setAttributes` (bulk)     | native `setAttributes` (objects JSON-stringified); looped `setAttribute` when absent                                                       |
| `isRecording()`            | native `isTraced`                                                                                                                          |
| `setStatus` / thrown error | native `setStatus` when present, else `otel.status_code` / `error` attributes; the original error rethrows                                 |
| `recordException(e)`       | native `recordException` (an Error, a string or a `{ code, message }` object, as a span event), else `exception.*` attributes              |
| `updateName`               | native `updateName` when present, else a no-op                                                                                             |
| `addEvent(name, attrs)`    | `console.log(name, attrs)` (Cloudflare attributes console output to the span)                                                              |
| `traceId` / `spanId`       | native `spanContext()` ids, the same ones Workers Observability and OTLP exports show; `''` on older runtimes or with observability off    |
| `correlationId`            | the first 16 hex of the trace id; on older runtimes the `cf-ray` id (uuid for non-fetch triggers). Written as a `correlation.id` attribute |
| `addLink` / `addLinks`     | no-op                                                                                                                                      |

> **Real ids.** `ctx.traceId` / `ctx.spanId` come from `span.spanContext()`,
> so you can log the trace id or return it to a client and find the same
> trace in Workers Observability. The trace id also matches the invocation's
> Workers Logs when traces are off or the request was not sampled (no spans
> are stored then). Observability off returns zeros, and autotel falls back to
> the `cf-ray` correlation id as it does on runtimes without `spanContext()`.
>
> Native mode still writes no `traceparent`: Cloudflare's `traceFlags` does not
> say whether the request was sampled, and Cloudflare advises against building
> a `traceparent` from it. Use `nativeTracing: 'off'` to join traces with
> services outside Cloudflare.

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
