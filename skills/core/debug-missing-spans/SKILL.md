---
name: debug-missing-spans
description: >
  Troubleshoot when expected OpenTelemetry spans don't reach the backend.
  Walks the chain top-to-bottom — code → SDK init → sampler → processor →
  exporter → network → backend ingest — with concrete tests at each step.
  Covers a missing endpoint, sampling drops, ctx.waitUntil drops on
  Cloudflare, init-order races, propagation breaks, exporter auth errors,
  and silent ratelimits.
---

# Debug missing spans

When a span you expect isn't in the backend, the cause is somewhere in this chain:

```
code → SDK init → sampler → processor → exporter → network → backend ingest → backend index
```

This skill walks each link in order with a quick check you can run. Don't skip steps. The cause is rarely where you'd guess.

## Check these three first

1. **No endpoint, no export.** Node `init()` has no default endpoint and no
   localhost fallback. Without `endpoint`, `destinations`, `spanExporters`,
   `spanProcessors` or `OTEL_EXPORTER_OTLP_ENDPOINT`, no exporter is built and
   every span is silently discarded. Set one:

   ```typescript
   init({ service: 'my-app', endpoint: 'http://localhost:4318' });
   ```

   `endpoint` is the base URL; autotel appends `/v1/traces`, `/v1/metrics`
   and `/v1/logs`.

2. **Sampling.** With `sampling: 'production'` (or
   `samplingPresets.production()`), about 90 % of fast, successful spans from
   `trace()` / `withTracing()` / `instrument()` are dropped on export, and each
   wrapped span decides on its own. Reproduce with `sampling: 'development'`.
   See [`tune-sampling`](../tune-sampling/SKILL.md).

3. **Two copies of `@opentelemetry/api` (Next.js, bundlers).** An
   instrumentation on a different API copy than autotel sends its spans to a
   provider nobody exports from. `init()` warns and names it. Under Next.js,
   use `withAutotelConfig` from `autotel-adapters/next-config` and add
   `@opentelemetry/api` to the app's dependencies.

## Step 0: Reproduce locally with the pretty exporter

Before chasing remote backends, confirm the span exists at all:

```typescript
init({
  service: 'my-app',
  debug: 'pretty', // hierarchical colourised output to stdout
  sampling: 'development', // keep everything while reproducing
});
```

The pretty exporter prints one tree per trace when the trace's root span ends; a trace whose root never exports prints after two idle seconds, and `flush()` prints anything still waiting. If you see the span in stdout, the code and sampler are fine. Skip to "exporter / network". If you don't, keep reading.

## Step 1: Is the SDK actually initialised?

Common failure: `init()` runs after the code you expect to trace, or after the
library you expect auto-instrumented was imported.

```typescript
import { isInitialized } from 'autotel';

console.log('[autotel-debug] initialised:', isInitialized());
```

If `false`, `init()` has not run. Move it to the very top of the entry file (or to `instrumentation.ts` for Next.js). Wrapping a function with `trace()` at module load is fine; calling it before `init()` is not.

Auto-instrumented spans (HTTP, pg, pino, …) need three things: the library
listed in `autoInstrumentations` (it is off by default), the
`@opentelemetry/auto-instrumentations-node` package installed, and `init()`
running before the library is imported. Under ESM, start node with
`--import autotel/register`. `init()` prints a console warning for a missing
loader hook or a logger loaded too early.

## Step 2: Sampler

- `sampling: 'production'` / `'errors-only'` drop fast, successful wrapped
  spans; `'off'` drops all of them.
- A `sampler` passed to a single `trace()` / `withTracing()` / `instrument()`
  overrides the one from `init()`.
- With neither `sampling` nor `sampler`, `OTEL_TRACES_SAMPLER` /
  `OTEL_TRACES_SAMPLER_ARG` from the environment set the SDK head sampler.

To keep one request whatever the sampler says, call `forceKeep()` in its span,
or send `baggage: autotel.debug=1` (read where incoming context is extracted).

Edge (`autotel-edge` / `autotel-cloudflare`): check `sampling.headSampler`
(a `{ ratio }` stops spans being recorded) and `sampling.tailSampler`.
`getActiveConfig()` from `autotel-edge` returns the resolved edge config.

## Step 3: Cloudflare Workers: `ctx.waitUntil`

The single biggest cause of missing spans on the edge: **the response returned before the exporter flushed**.

If you're using `addEventListener('fetch', …)` or a hand-rolled `fetch` in a module worker without wiring `ctx.waitUntil(…)` to the export call, async drains drop silently. `autotel-edge` also warns once when the config has no `exporter` and no `spanProcessors`.

Fix. Switch to `defineWorkerFetch` or `wrapModule`, both of which wire `waitUntil` automatically:

```typescript
import { defineWorkerFetch } from 'autotel-cloudflare';

export default defineWorkerFetch(
  {
    service: { name: 'edge' },
    exporter: { url: 'https://otlp.example.com/v1/traces' },
  },
  async (request, env, ctx, log) => {
    // log.set / spans here all flush via ctx.waitUntil before response returns
    return new Response('ok');
  },
);
```

## Step 4: Processor pipeline

Read the `init()` call, not the provider internals. Common issues:

- **`spanFilter` returns `false` for your span.** It wraps every processor.
- **A `FilteringSpanProcessor` you added drops it.** Its `filter` must return `true` to keep.
- **`TailSamplingSpanProcessor` dropped it** (fast, successful, not force-kept).
- **`spanProcessors: []`** is an explicit off switch: nothing is exported.
- **Edge only: a `postProcessor` / `composePostProcessors` step returns `[]` for your span.**

To bisect, temporarily strip everything:

```typescript
init({
  service: 'my-app',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  sampling: 'development',
  // no spanFilter, no spanProcessors, no policies
});
```

If the span shows up now, add back the pieces one at a time.

## Step 5: Exporter

Tail the SDK's diagnostic log:

```typescript
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
```

Look for export failures with an HTTP status, e.g. `401`.

The default protocol is OTLP over HTTP with a JSON body. `protocol: 'http/protobuf'` or `'grpc'` needs the matching `@opentelemetry/exporter-*-otlp-proto` / `-grpc` packages installed in the app.

Common exporter errors:

| Status        | Meaning                   | Fix                                                                    |
| ------------- | ------------------------- | ---------------------------------------------------------------------- |
| `401`         | Bad / missing auth header | Check `headers` / `OTEL_EXPORTER_OTLP_HEADERS` / vendor token name     |
| `403`         | Token has no write scope  | Issue a token with the right scope                                     |
| `404`         | Wrong endpoint URL        | Base URL only (no `/v1/traces`); check region (`api.eu1.honeycomb.io`) |
| `413`         | Batch too big             | Lower `BatchSpanProcessor` `maxExportBatchSize`                        |
| `429`         | Rate-limited              | Lower the sampling baseline; honour `retry-after`                      |
| `502/503/504` | Upstream unhealthy        | Often transient; add retries; check backend status                     |
| Network error | DNS / firewall            | `curl -v <url>` from the same network                                  |

## Step 6: Network / TLS

For self-hosted Collectors:

```bash
curl -v -X POST $OTEL_EXPORTER_OTLP_ENDPOINT/v1/traces \
  -H 'content-type: application/json' \
  -H "$AUTH_HEADER" \
  -d '{"resourceSpans":[]}'
```

Should return `200`. If it doesn't, the problem is between you and the Collector. Not autotel.

For Cloudflare Workers, run `wrangler tail` and look for exporter errors.

## Step 7: Backend ingest: silent rejection

Some backends accept the request with a 200 but drop the events:

- **Honeycomb**: dataset must exist _and_ the API key must have write access to it. Mismatched key/dataset → silent drop.
- **Datadog**: check `service` is set (resource attribute `service.name`): they ignore spans without it.
- **Sentry**: SDK version mismatch on envelope → 200 but events disappear.
- **Grafana Cloud Tempo**: spans without `service.name` go to a fallback service called `unknown_service`.

For each backend, the dataset / index / project where you'd expect the span:

| Backend       | Where the span lands                    |
| ------------- | --------------------------------------- |
| Honeycomb     | dataset = `service.name` (auto-created) |
| Datadog       | `service:<name>` filter                 |
| Grafana Tempo | search by `traceId`                     |
| Jaeger        | service dropdown = `service.name`       |
| Sentry        | project linked to the DSN               |

## Step 8: Backend index lag

After a 200, expect ingestion lag of:

| Backend            | Typical lag |
| ------------------ | ----------- |
| Honeycomb          | < 5 s       |
| Datadog            | 30–60 s     |
| Grafana Tempo      | 10–30 s     |
| Sentry             | 30–120 s    |
| Self-hosted Jaeger | < 1 s       |

Don't conclude the span is missing until you've waited > 2× the expected lag.

## Step-by-step checklist

```
[ ] An endpoint is configured (endpoint / destinations / OTEL_EXPORTER_OTLP_ENDPOINT)
[ ] Span shows in `debug: 'pretty'` stdout with sampling: 'development'
[ ] isInitialized() is true before the traced code runs
[ ] Sampling preset / sampler allows the request
[ ] Workers handler uses defineWorkerFetch / wrapModule
[ ] No spanFilter / FilteringSpanProcessor / tail sampler strips it
[ ] Exporter logs no 4xx/5xx
[ ] Curl to OTLP endpoint returns 200
[ ] Backend has the right service.name / dataset / project
[ ] Waited 2× expected ingest lag
```

## When the trace partially shows up

Some spans land, some don't:

- **Sampling decided per span (Node).** Under `'production'` each wrapped span rolls its own baseline, so a kept parent can lose fast children. Use `forceKeep()` or `autotel.debug` baggage while debugging.
- **Trace context broken between services**: outbound calls aren't propagating `traceparent`. Node has no outbound HTTP instrumentation unless you enable it: `autoInstrumentations: ['http', 'undici']` (`undici` covers global `fetch`). On Workers, global fetch is instrumented by default (`instrumentation.instrumentGlobalFetch`).
- **Async boundary loses context**: a `setTimeout` / queue callback ran outside the AsyncLocalStorage scope. Wrap with `trace()` or use `context.with()`.
- **Cross-runtime call**: Node service → Workers → browser; verify `traceparent` arrives at each leg via response headers / network panel.

## When the SDK itself crashes

```
TypeError: Cannot read properties of undefined (reading 'startActiveSpan')
```

Usually means the API version (`@opentelemetry/api`) and SDK version (`@opentelemetry/sdk-trace-base`) drifted. Run:

```bash
pnpm why @opentelemetry/api
```

There should be exactly one resolved version. If there are two, dedup via `pnpm.overrides`.

## Anti-patterns to fix as you debug

| Anti-pattern                                              | Why it loses spans                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| No `endpoint` and no `OTEL_EXPORTER_OTLP_ENDPOINT`        | No exporter is built; spans go nowhere                              |
| Calling traced code before `init()`                       | Spans before `init()` are no-ops                                    |
| `addEventListener('fetch', …)` on Workers                 | Pre-module-worker style; no `ctx.waitUntil` to wire                 |
| Single `OTLP_ENDPOINT` env var with `?` chars URL-encoded | Auth gets parsed as part of the path                                |
| Importing both `@sentry/tracing` and `autotel`            | Double-instrumentation eats spans                                   |
| `process.exit(0)` immediately after the work              | The exporter never flushed; `await shutdown()` from `autotel` first |

`flushOnExit` (default `true`) flushes on `beforeExit`, which covers a script that ends on its own but not `process.exit()` or a signal. Call `await flush()` or `await shutdown()` yourself, or opt into `processHandlers: true` for SIGTERM/SIGINT and fatal errors.

If spans reach one backend but not another in a fan-out setup, bisect with `destinations`: keep one destination at a time, then re-add the others until the failing backend is isolated.
