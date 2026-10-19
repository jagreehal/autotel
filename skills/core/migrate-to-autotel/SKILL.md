---
name: migrate-to-autotel
description: >
  Migrate an existing observability setup to autotel. Handles raw
  @opentelemetry/sdk-node, Sentry tracer (`@sentry/node`), Datadog APM
  (`dd-trace`), New Relic agent (`newrelic`), Honeycomb Beelines, and
  OpenTracing / OpenCensus. Preserves trace fidelity (no gap in dashboards
  during cutover), maps vendor-specific span attributes to OTel semantic
  conventions, and runs both stacks side-by-side during the cutover window.
---

# Migrate to autotel

Replacing tracing in a live service is risky. You can lose data, change span shapes, or break dashboards your on-call team relies on. This skill covers the safe paths from each major source, what to change in your code, and how to verify the cutover before turning the old stack off.

## Choose your starting point

| You're using                                | Section                                                        |
| ------------------------------------------- | -------------------------------------------------------------- |
| Raw `@opentelemetry/sdk-node`               | [From raw OTel SDK](#from-raw-opentelemetry-sdk-node)          |
| Sentry `@sentry/node` performance / tracing | [From Sentry](#from-sentry-performance-tracing)                |
| Datadog APM (`dd-trace`)                    | [From Datadog APM](#from-datadog-apm)                          |
| New Relic agent (`newrelic`)                | [From New Relic Node agent](#from-new-relic-node-agent)        |
| Honeycomb Beelines                          | [From Honeycomb Beelines](#from-honeycomb-beelines)            |
| OpenTracing / OpenCensus                    | [From OpenTracing / OpenCensus](#from-opentracing--opencensus) |
| `console.log` everything                    | [From unstructured logging](#from-unstructured-logging)        |

## Universal cutover plan

1. **Pin metrics.** Snapshot p50 / p95 / p99 / error-rate / span-count for the top 5 endpoints. You'll diff post-cutover.
2. **Run both side-by-side for 24–48 h.** Both old and new exporters wired in parallel. Use distinct backends (or distinct datasets) so you can compare like for like.
3. **Cutover dashboards & alerts.** Re-author critical dashboards on the autotel data; keep both alert sets armed.
4. **Disable the old stack.** Remove old SDK imports + processors; redeploy.
5. **Decommission.** Remove old packages from `package.json` and lock files; archive old dashboards.

Don't compress this into a single PR. The riskiest step is "disable old stack". Keep it last.

## From raw `@opentelemetry/sdk-node`

The smoothest migration. autotel layers on top of OTel. Your span attributes, propagators, and exporters can stay.

### Drop-in init

Before:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

const sdk = new NodeSDK({
  resource: resourceFromAttributes({ 'service.name': 'my-app' }),
  spanProcessors: [
    new BatchSpanProcessor(
      new OTLPTraceExporter({ url: process.env.OTEL_ENDPOINT }),
    ),
  ],
});
sdk.start();
```

After:

```typescript
import { init } from 'autotel';

init({
  service: 'my-app',
  endpoint: process.env.OTEL_ENDPOINT!, // base URL: autotel appends /v1/traces
  autoInstrumentations: ['http', 'undici'], // what NodeSDK users usually had
});
```

`init()` builds the provider and an OTLP HTTP/JSON exporter, and sets up the W3C trace-context and baggage propagators. It turns on **no** auto-instrumentation by default: list the libraries in `autoInstrumentations` (needs `@opentelemetry/auto-instrumentations-node` installed), or pass your existing `instrumentations: [...]`. If your old `url` ended in `/v1/traces`, drop the suffix. With no `endpoint` (or `OTEL_EXPORTER_OTLP_ENDPOINT`) nothing is exported.

### What you gain immediately

- `getRequestLogger().set({ … })` flattens onto the active span: no more `span.setAttribute('user.id', id)` boilerplate.
- PII redaction (`attributeRedactor: 'default'`) switches on by itself when `environment` (default `NODE_ENV`) is `production`.
- `destinations: [...]` for straightforward OTLP multi-backend fan-out.
- The same API on Cloudflare Workers and edge runtimes via `autotel-cloudflare` / `autotel-edge`.

### What stays the same

- Your propagator (W3C trace context + baggage are the default).
- Your exporters: pass them via `spanExporters` (autotel batches them) or `spanProcessors` (full control).
- Your resource attributes (`resourceAttributes` or `resource`).

## From Sentry performance tracing

Sentry's tracing is OTel-compatible since v7+, but their span shapes have non-standard names (`http.server`, `db.query`).

### Step 1: Use `autotel-sentry` to keep sending to Sentry

If you want the dashboards to stay in Sentry, autotel can export OTLP to Sentry's OTLP intake:

```typescript
import * as Sentry from '@sentry/node';
import { init } from 'autotel';
import { sentryOtlpConfig } from 'autotel-sentry';

const sentry = sentryOtlpConfig(process.env.SENTRY_DSN!);

// Keep Sentry for errors, but let autotel own OpenTelemetry
Sentry.init({ dsn: sentry.dsn, skipOpenTelemetrySetup: true });

init({ service: 'my-app', endpoint: sentry.endpoint, headers: sentry.headers });
```

### Step 2: Replace Sentry-specific helpers

| Sentry                                                     | autotel                                                              |
| ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `Sentry.startSpan({ op: 'fn', name: 'process' }, () => …)` | `trace.run('process', (ctx) => …)`                                   |
| `Sentry.captureException(err)`                             | `getRequestLogger().error(err)` or `recordStructuredError(ctx, err)` |
| `Sentry.setUser({ id })`                                   | `getRequestLogger().set({ user: { id } })`                           |
| `Sentry.setContext('cart', { … })`                         | `getRequestLogger().set({ cart: { … } })`                            |
| reusable named transaction function                        | `trace(name, fn)` or `instrument({ key: name, fn })`                 |

### Step 3: Decide on errors-only vs full tracing

Sentry shines at errors; for tracing you may want to fan out to Honeycomb or Grafana Tempo. If both targets are plain OTLP backends, prefer `destinations`:

```typescript
init({
  service: 'my-app',
  destinations: [
    {
      endpoint: grafanaUrl,
      headers: 'Authorization=Basic ...',
    },
    {
      endpoint: honeycombUrl,
      headers: { 'x-honeycomb-team': key },
      signals: ['traces'],
    },
  ],
});
```

If one destination needs a non-OTLP exporter or custom filtering, drop to `spanProcessors: [...]` (an array; each processor gets every span).

A `createStructuredError()` does nothing to the span by itself. Thrown out of a `trace()` body it marks the span as an error and records the exception; the `error.why` / `error.fix` / `error.status` attributes are added only by `recordStructuredError(ctx, err)` or `getRequestLogger().error(err)`.

## From Datadog APM

Datadog APM uses its own format and proprietary tracer. The migration path is OTLP → Datadog OTLP intake, then sunset `dd-trace`.

### Step 1: Stop importing `dd-trace`

`dd-trace` patches every supported library on import. Keeping it in the bundle while autotel runs causes double-instrumentation. Remove `import 'dd-trace'` (or the `--require dd-trace/init` arg).

### Step 2: Point autotel at Datadog OTLP intake

```typescript
import { init } from 'autotel';
import { createDatadogConfig } from 'autotel-backends';

init(
  createDatadogConfig({
    service: 'my-app',
    apiKey: process.env.DATADOG_API_KEY!,
    site: 'datadoghq.com', // default; 'datadoghq.eu', 'us3.datadoghq.com', …
  }),
);
```

That is the same as `endpoint: 'https://otlp.datadoghq.com'` with header `dd-api-key`. Pass `useAgent: true` to send to a local Datadog Agent instead.

### Step 3: Map Datadog span tags

Datadog uses `service`, `resource`, `operation`. OTel uses `service.name`, `http.route`, span name. Datadog's OTLP intake maps the standard OTel attributes; autotel does not rewrite your own tags. If you have custom Datadog tags in dashboards, rename them in code:

| Datadog tag | OTel attribute                                                      |
| ----------- | ------------------------------------------------------------------- |
| `env`       | `deployment.environment.name` (autotel sets it from `environment`)  |
| `version`   | `service.version` (autotel sets it from `version` / `package.json`) |
| `pod_name`  | `k8s.pod.name`                                                      |
| `host.name` | (resource attr) `host.name`, set by autotel from `DD_HOSTNAME` / OS |

### Step 4: Replace `dd-trace`-specific APIs

| `dd-trace`                             | autotel                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `tracer.trace('op', { resource }, fn)` | `trace.run('op', (ctx) => fn())` (set `http.route` with `ctx.setAttribute`) |
| `tracer.scope().active()`              | `getActiveSpan()` from `autotel`                                            |
| `tracer.wrap('op', fn)`                | `trace('op', fn)` or `instrument({ key: 'op', fn })`                        |

## From New Relic Node agent

New Relic's agent is invasive. It patches Node internals. Plan a maintenance window for the cutover.

### Step 1: Remove `--require newrelic`

Drop it from `start` script and `NODE_OPTIONS`.

### Step 2: Point at New Relic OTLP

```typescript
init({
  service: 'my-app',
  endpoint: 'https://otlp.nr-data.net', // autotel appends /v1/traces
  headers: { 'api-key': process.env.NEW_RELIC_LICENSE_KEY! },
});
```

For EU: `https://otlp.eu01.nr-data.net`.

### Step 3: Replace agent APIs

| `newrelic`                                | autotel                                                |
| ----------------------------------------- | ------------------------------------------------------ |
| `newrelic.startSegment('name', true, fn)` | `trace.run(name, (ctx) => fn())`                       |
| `newrelic.addCustomAttribute(key, value)` | `getRequestLogger().set({ [key]: value })`             |
| `newrelic.noticeError(err)`               | `getRequestLogger().error(err)`                        |
| `newrelic.recordMetric(name, value)`      | `createCounter()` / `createHistogram()` from `autotel` |

## From Honeycomb Beelines

Beelines for Node was Honeycomb's pre-OTel SDK. Migration is straightforward. Honeycomb supports OTLP natively.

```typescript
init({
  service: 'my-app',
  endpoint: 'https://api.honeycomb.io',
  headers: { 'x-honeycomb-team': process.env.HONEYCOMB_API_KEY! },
});
```

| Beeline                                 | autotel                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `beeline.withTrace(meta, fn)`           | `trace.run(meta.task, (ctx) => fn())`                                              |
| `beeline.customContext.add(key, value)` | `getRequestLogger().set({ [key]: value })`                                         |
| `beeline.flush()`                       | `await flush()` from `autotel` (`flushOnExit`, on by default, covers a clean exit) |

## From OpenTracing / OpenCensus

Both are deprecated; the migration is "rewrite the tracer setup, leave call sites alone." OpenTracing's `Tracer.startSpan` and OpenCensus's `tracer.startRootSpan` shapes are similar enough that a script can replace them with `trace()` calls in most files.

For libraries you don't control that still use OpenTracing, the OTel project ships a [shim](https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-shim-opentracing). Wire it once, then migrate at your own pace.

## From unstructured logging

If you're starting from `console.log` everywhere:

1. Add `init({ service: 'my-app', debug: 'pretty' })` so spans are visible locally.
2. Replace `console.log` in handlers with `getRequestLogger().set({ … })` (inside `trace()` or framework middleware).
3. Wrap throw sites with `createStructuredError({ message, status, why, fix })`.
4. Add an `endpoint` when you're ready to ship to a backend; until then nothing is exported.

See [`review-otel-patterns`](../review-otel-patterns/SKILL.md) for the framework setup steps.

## Verifying the cutover

| Check                       | How                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Span volume matches**     | Compare `count(spans)` per route over 24h; should be within ±5 %                                                         |
| **p99 latency unchanged**   | Histograms on both backends                                                                                              |
| **Error rate unchanged**    | `count(spans where status=error)`                                                                                        |
| **Trace correlation works** | Pick 10 random `traceId`s; confirm cross-service spans resolve                                                           |
| **Bundle size acceptable**  | Compare bundle / install size before and after: moving from heavy agents (New Relic, Datadog) often _shrinks_ the bundle |

## Anti-patterns

| Anti-pattern                                              | Fix                                                                                                                           |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Both old SDK and autotel running on the same library      | Pick one: double-instrumentation duplicates spans                                                                             |
| Removing the old SDK in the same PR as adding autotel     | Run both side-by-side for 24–48 h first                                                                                       |
| Changing span names during migration                      | Preserve names; rename in a separate PR after dashboards re-pointed                                                           |
| No metric snapshot before cutover                         | Take p50/p95/p99 + error-rate baselines first                                                                                 |
| Migrating prod before staging                             | Always staging first: at least 24 h                                                                                           |
| Trusting the old vendor agent's auto-instrumentation list | autotel's targeted instrumentations (`autotel-drizzle`, `autotel-mongoose`, …) are faster and tighter; expect to add a couple |
