---
name: migrate-to-autotel
description: >
  Migrate an existing observability setup to autotel. Handles raw
  @opentelemetry/sdk-node, Sentry tracer (`@sentry/node`), Datadog APM
  (`dd-trace`), New Relic agent (`newrelic`), Honeycomb Beelines, and
  OpenTracing / OpenCensus. Preserves trace fidelity (no gap in dashboards
  during cutover), maps vendor-specific span attributes to OTel semantic
  conventions, and runs both stacks side-by-side during the cutover window.
type: migrate
library: autotel
license: MIT
---

# Migrate to autotel

Replacing tracing in a live service is risky — you can lose data, change span shapes, or break dashboards your on-call team relies on. This skill covers the safe paths from each major source, what to change in your code, and how to verify the cutover before turning the old stack off.

## Choose your starting point

| You're using | Section |
| --- | --- |
| Raw `@opentelemetry/sdk-node` | [From raw OTel SDK](#from-raw-opentelemetry-sdk-node) |
| Sentry `@sentry/node` performance / tracing | [From Sentry](#from-sentry-performance-tracing) |
| Datadog APM (`dd-trace`) | [From Datadog APM](#from-datadog-apm) |
| New Relic agent (`newrelic`) | [From New Relic Node agent](#from-new-relic-node-agent) |
| Honeycomb Beelines | [From Honeycomb Beelines](#from-honeycomb-beelines) |
| OpenTracing / OpenCensus | [From OpenTracing / OpenCensus](#from-opentracing--opencensus) |
| `console.log` everything | [From unstructured logging](#from-unstructured-logging) |

## Universal cutover plan

1. **Pin metrics.** Snapshot p50 / p95 / p99 / error-rate / span-count for the top 5 endpoints. You'll diff post-cutover.
2. **Run both side-by-side for 24–48 h.** Both old and new exporters wired in parallel. Use distinct backends (or distinct datasets) so you can compare like for like.
3. **Cutover dashboards & alerts.** Re-author critical dashboards on the autotel data; keep both alert sets armed.
4. **Disable the old stack.** Remove old SDK imports + processors; redeploy.
5. **Decommission.** Remove old packages from `package.json` and lock files; archive old dashboards.

Don't compress this into a single PR. The riskiest step is "disable old stack" — keep it last.

## From raw `@opentelemetry/sdk-node`

The smoothest migration. autotel layers on top of OTel — your span attributes, propagators, and exporters can stay.

### Drop-in init

Before:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'

const sdk = new NodeSDK({
  resource: resourceFromAttributes({ 'service.name': 'my-app' }),
  spanProcessors: [
    new BatchSpanProcessor(new OTLPTraceExporter({ url: process.env.OTEL_ENDPOINT })),
  ],
})
sdk.start()
```

After:

```typescript
import { init } from 'autotel'

init({
  service: 'my-app',
  exporter: { url: process.env.OTEL_ENDPOINT! },
})
```

`init()` builds the same provider + exporter, plus turns on the global fetch instrumentation, sets up the W3C propagator, and primes the redactor.

### What you gain immediately

- `useLogger().set({ … })` flattens onto the active span — no more `span.setAttribute('user.id', id)` boilerplate.
- `attributeRedactor: 'default'` — PII masking for free in production.
- `composeSpanProcessors([…])` for multi-backend tee.
- Cloudflare Workers + Edge support out of the box (`defineWorkerFetch`).

### What stays the same

- Your propagator (`W3CTraceContextPropagator` is the default).
- Your exporters — pass them via `spanProcessors` if you want to keep custom ones.
- Your resource attributes.

## From Sentry performance tracing

Sentry's tracing is OTel-compatible since v7+, but their span shapes have non-standard names (`http.server`, `db.query`).

### Step 1: Use `autotel-sentry` to keep sending to Sentry

If you want the dashboards to stay in Sentry, autotel can export OTLP to Sentry's OTLP intake:

```typescript
import { init } from 'autotel'
import { SentrySpanExporter } from 'autotel-sentry'

init({
  service: 'my-app',
  spanProcessors: [new BatchSpanProcessor(new SentrySpanExporter({ dsn: process.env.SENTRY_DSN! }))],
})
```

### Step 2: Replace Sentry-specific helpers

| Sentry | autotel |
| --- | --- |
| `Sentry.startSpan({ op: 'fn', name: 'process' }, () => …)` | `trace({ name: 'process' }, () => …)` |
| `Sentry.captureException(err)` | `createStructuredError({ … })` (auto-records on span) |
| `Sentry.setUser({ id })` | `useLogger().set({ user: { id } })` |
| `Sentry.setContext('cart', { … })` | `useLogger().set({ cart: { … } })` |
| `Sentry.startTransaction({ name })` | `trace({ name }, fn)` |

### Step 3: Decide on errors-only vs full tracing

Sentry shines at errors; for tracing you may want to fan out to Honeycomb or Grafana Tempo. Use `composeSpanProcessors`:

```typescript
spanProcessors: composeSpanProcessors([
  new BatchSpanProcessor(new SentrySpanExporter({ dsn })),
  new BatchSpanProcessor(new OTLPHttpJsonExporter({ url: honeycombUrl, headers: { 'x-honeycomb-team': key } })),
])
```

## From Datadog APM

Datadog APM uses its own format and proprietary tracer. The migration path is OTLP → Datadog OTLP intake, then sunset `dd-trace`.

### Step 1: Stop importing `dd-trace`

`dd-trace` patches every supported library on import — keeping it in the bundle while autotel runs causes double-instrumentation. Remove `import 'dd-trace'` (or the `--require dd-trace/init` arg).

### Step 2: Point autotel at Datadog OTLP intake

```typescript
import { init } from 'autotel'

init({
  service: 'my-app',
  exporter: {
    url: 'https://trace.agent.datadoghq.com/api/v0.4/traces',
    headers: { 'dd-api-key': process.env.DD_API_KEY! },
  },
})
```

For the EU site use `datadoghq.eu`; for US3 / US5 see Datadog's region matrix.

### Step 3: Map Datadog span tags

Datadog uses `service`, `resource`, `operation` — OTel uses `service.name`, `http.route`, span name. autotel handles the conversion automatically when exporting via `dd-api-key`. If you have custom Datadog tags in dashboards, rename them in code:

| Datadog tag | OTel attribute |
| --- | --- |
| `env` | `deployment.environment` |
| `version` | `service.version` |
| `pod_name` | `k8s.pod.name` |
| `host.name` | (resource attr) `host.name` |

### Step 4: Replace `dd-trace`-specific APIs

| `dd-trace` | autotel |
| --- | --- |
| `tracer.trace('op', { resource }, fn)` | `trace({ name: 'op' }, fn)` (set `http.route` via `useLogger().set({ http: { route } })` if needed) |
| `tracer.scope().active()` | `trace.getActiveSpan()` (from `@opentelemetry/api`) |
| `tracer.wrap('op', fn)` | `trace(fn)` |

## From New Relic Node agent

New Relic's agent is invasive — it patches Node internals. Plan a maintenance window for the cutover.

### Step 1: Remove `--require newrelic`

Drop it from `start` script and `NODE_OPTIONS`.

### Step 2: Point at New Relic OTLP

```typescript
init({
  service: 'my-app',
  exporter: {
    url: 'https://otlp.nr-data.net/v1/traces',
    headers: { 'api-key': process.env.NEW_RELIC_LICENSE_KEY! },
  },
})
```

For EU: `https://otlp.eu01.nr-data.net/v1/traces`.

### Step 3: Replace agent APIs

| `newrelic` | autotel |
| --- | --- |
| `newrelic.startSegment('name', true, fn)` | `trace({ name }, fn)` |
| `newrelic.addCustomAttribute(key, value)` | `useLogger().set({ [key]: value })` |
| `newrelic.noticeError(err)` | `createStructuredError({ … })` |
| `newrelic.recordMetric(name, value)` | OTel meter API |

## From Honeycomb Beelines

Beelines for Node was Honeycomb's pre-OTel SDK. Migration is straightforward — Honeycomb supports OTLP natively.

```typescript
init({
  service: 'my-app',
  exporter: {
    url: 'https://api.honeycomb.io/v1/traces',
    headers: { 'x-honeycomb-team': process.env.HONEYCOMB_API_KEY! },
  },
})
```

| Beeline | autotel |
| --- | --- |
| `beeline.withTrace(meta, fn)` | `trace({ name: meta.task }, fn)` |
| `beeline.customContext.add(key, value)` | `useLogger().set({ [key]: value })` |
| `beeline.flush()` | `await provider.forceFlush()` (autotel does this on shutdown automatically) |

## From OpenTracing / OpenCensus

Both are deprecated; the migration is "rewrite the tracer setup, leave call sites alone." OpenTracing's `Tracer.startSpan` and OpenCensus's `tracer.startRootSpan` shapes are similar enough that a script can replace them with `trace()` calls in most files.

For libraries you don't control that still use OpenTracing, the OTel project ships a [shim](https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-shim-opentracing) — wire it once, then migrate at your own pace.

## From unstructured logging

If you're starting from `console.log` everywhere:

1. Add `init({ service: 'my-app', debug: 'pretty' })` so spans are visible locally.
2. Replace `console.log` in handlers with `useLogger().set({ … })`.
3. Wrap throw sites with `createStructuredError({ message, status, why, fix })`.
4. Add a real OTLP exporter when you're ready to ship to a backend.

See [`review-otel-patterns`](../review-otel-patterns/SKILL.md) for the framework setup steps.

## Verifying the cutover

| Check | How |
| --- | --- |
| **Span volume matches** | Compare `count(spans)` per route over 24h; should be within ±5 % |
| **p99 latency unchanged** | Histograms on both backends |
| **Error rate unchanged** | `count(spans where status=error)` |
| **Trace correlation works** | Pick 10 random `traceId`s; confirm cross-service spans resolve |
| **Bundle size acceptable** | `pnpm bundle-size` — moving from heavy agents (New Relic, Datadog) often *shrinks* the bundle |

## Anti-patterns

| Anti-pattern | Fix |
| --- | --- |
| Both old SDK and autotel running on the same library | Pick one — double-instrumentation duplicates spans |
| Removing the old SDK in the same PR as adding autotel | Run both side-by-side for 24–48 h first |
| Changing span names during migration | Preserve names; rename in a separate PR after dashboards re-pointed |
| No metric snapshot before cutover | Take p50/p95/p99 + error-rate baselines first |
| Migrating prod before staging | Always staging first — at least 24 h |
| Trusting the old vendor agent's auto-instrumentation list | autotel's targeted instrumentations (`autotel-drizzle`, `autotel-mongoose`, …) are faster and tighter; expect to add a couple |
