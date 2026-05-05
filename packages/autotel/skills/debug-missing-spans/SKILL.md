---
name: debug-missing-spans
description: >
  Troubleshoot when expected OpenTelemetry spans don't reach the backend.
  Walks the chain top-to-bottom — code → SDK init → processor → exporter →
  network → backend ingest — with concrete tests at each step. Covers head
  sampling, ctx.waitUntil drops on Cloudflare, init-order races, runtime
  detection failures, propagation breaks, exporter auth errors, and
  silent ratelimits.
license: MIT
---

# Debug missing spans

When a span you expect isn't in the backend, the cause is somewhere in this chain:

```
code → SDK init → head sampler → processor → exporter → network → backend ingest → backend index
```

This skill walks each link in order with a quick check you can run. Don't skip steps — the cause is rarely where you'd guess.

## Step 0: Reproduce locally with the pretty exporter

Before chasing remote backends, confirm the span exists at all:

```typescript
init({
  service: 'my-app',
  debug: 'pretty', // hierarchical colourised output to stdout
});
```

If you see the span in stdout, the SDK + sampler are fine — skip to "exporter / network". If you don't, keep reading.

## Step 1: Is the SDK actually initialised?

Common failure: `init()` runs after the first request because of import-order.

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('autotel-debug');
console.log(
  '[autotel-debug] tracer is no-op:',
  tracer.constructor.name === 'NoopTracer',
);
```

If `true`, `init()` ran too late. Move it to the very top of the entry file (or to `instrumentation.ts` for Next.js).

## Step 2: Head sampler

Print the effective head rate:

```typescript
import { getActiveConfig } from 'autotel-edge';
console.log('[autotel-debug] sampling:', getActiveConfig()?.sampling);
```

Common gotchas:

- `sampling.rates: { server: 5 }` — 5 % means 95 % of spans never start.
- Inheriting `OTEL_TRACES_SAMPLER_ARG=0.01` from the environment via the OTel default sampler.
- Your test happens to hit the unsampled branch — instrument with `sampling: { rates: { server: 100 } }` while reproducing.

To force sampling for one request, send a `traceparent` with the sampled flag set:

```
traceparent: 00-<traceid>-<spanid>-01
```

(`-01` at the end = sampled.) autotel's parent-based sampler will respect it.

## Step 3: Cloudflare Workers — `ctx.waitUntil`

The single biggest cause of missing spans on the edge: **the response returned before the exporter flushed**.

If you're using `addEventListener('fetch', …)` or a hand-rolled `fetch` in a module worker without wiring `ctx.waitUntil(…)` to the export call, async drains drop silently.

Fix — switch to `defineWorkerFetch` or `wrapModule`, both of which wire `waitUntil` automatically:

```typescript
import { defineWorkerFetch } from 'autotel-cloudflare';

export default defineWorkerFetch(
  { service: { name: 'edge' } },
  async (request, env, ctx, log) => {
    // log.set / spans here all flush via ctx.waitUntil before response returns
    return new Response('ok');
  },
);
```

## Step 4: Processor pipeline

Print what's wired:

```typescript
import { trace } from '@opentelemetry/api';
const provider = trace.getTracerProvider();
console.log('[autotel-debug] provider:', provider.constructor.name);
console.log(
  '[autotel-debug] processors:',
  (provider as any)._registeredSpanProcessors?.map(
    (p: any) => p.constructor.name,
  ),
);
```

Common issues:

- **A `FilteringSpanProcessor` excludes your span.** Check the `include` / `exclude` predicates.
- **A `TailSamplingProcessor` dropped the trace** (no error, no slow root, no debug header).
- **A `composePostProcessors` step returns `[]` for your span.**

To bisect, temporarily strip post-processors:

```typescript
init({
  service: 'my-app',
  exporter: { url: process.env.OTLP_ENDPOINT! },
  // no postProcessor, no tail sampler, no filter
});
```

If the span shows up now, add back the processors one at a time.

## Step 5: Exporter

Tail the SDK's diagnostic log:

```typescript
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
```

Look for:

```
@opentelemetry/api: ... OTLPExporter: failed to send 4 traces, status: 401, error: ...
```

Common exporter errors:

| Status        | Meaning                   | Fix                                                         |
| ------------- | ------------------------- | ----------------------------------------------------------- |
| `401`         | Bad / missing auth header | Check `OTLP_HEADERS` / vendor token name                    |
| `403`         | Token has no write scope  | Issue a token with the right scope                          |
| `404`         | Wrong endpoint URL        | Check region (`api.honeycomb.io` vs `api.eu1.honeycomb.io`) |
| `413`         | Batch too big             | Lower `BatchSpanProcessor` `maxExportBatchSize`             |
| `429`         | Rate-limited              | Reduce head/tail rates; honour `retry-after`                |
| `502/503/504` | Upstream unhealthy        | Often transient; add retries; check backend status          |
| Network error | DNS / firewall            | `curl -v <url>` from the same network                       |

## Step 6: Network / TLS

For self-hosted Collectors:

```bash
curl -v -X POST $OTLP_ENDPOINT \
  -H 'content-type: application/json' \
  -H "$AUTH_HEADER" \
  -d '{"resourceSpans":[]}'
```

Should return `200`. If it doesn't, the problem is between you and the Collector — not autotel.

For Cloudflare Workers, run `wrangler tail` and look for `OTLPExporter` errors.

## Step 7: Backend ingest — silent rejection

Some backends accept the request with a 200 but drop the events:

- **Honeycomb**: dataset must exist _and_ the API key must have write access to it. Mismatched key/dataset → silent drop.
- **Datadog**: check `service` is set (resource attribute `service.name`) — they ignore spans without it.
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
[ ] Span shows in `debug: 'pretty'` stdout
[ ] `tracer.constructor.name !== 'NoopTracer'` (SDK initialised)
[ ] Head rate is high enough to allow the request
[ ] Workers handler uses defineWorkerFetch / wrapModule
[ ] No post-processor / tail sampler / filter strips it
[ ] Exporter logs no 4xx/5xx
[ ] Curl to OTLP endpoint returns 200
[ ] Backend has the right service.name / dataset / project
[ ] Waited 2× expected ingest lag
```

## When the trace partially shows up

Some spans land, some don't:

- **Trace context broken between services** — outbound HTTP calls aren't propagating `traceparent`. Confirm autotel's global fetch instrumentation is on (`instrumentation.instrumentGlobalFetch: true`, default).
- **Async boundary loses context** — a `setTimeout` / queue callback ran outside the AsyncLocalStorage scope. Wrap with `trace()` or use `context.with()`.
- **Cross-runtime call** — Node service → Workers → browser; verify `traceparent` arrives at each leg via response headers / network panel.

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

| Anti-pattern                                              | Why it loses spans                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| `init()` after the first import that uses tracing         | Spans before `init()` are no-ops                                   |
| `addEventListener('fetch', …)` on Workers                 | Pre-module-worker style; no `ctx.waitUntil` to wire                |
| Single `OTLP_ENDPOINT` env var with `?` chars URL-encoded | Auth gets parsed as part of the path                               |
| Importing both `@sentry/tracing` and `autotel`            | Double-instrumentation eats spans                                  |
| `process.exit(0)` immediately after the work              | The exporter never flushed; call `await provider.shutdown()` first |
