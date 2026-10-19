---
name: production-observability
description: >
  Takes a Node.js or TypeScript service to production-grade observability with
  autotel, in an existing codebase or a new one, and keeps it there. Defines the
  standard as a checklist an agent can verify (startup, shutdown, traces at every
  boundary, context propagation, request context, logs tied to traces, errors,
  metrics an alert can use, data safety, sampling, tests), then wires the CI
  ratchet that holds every later PR to it. Use when asked to "make this production ready", "add observability",
  "set autotel up properly", onboard a team or service to autotel, or check
  whether a service could be debugged in production. Do not use for one API's
  details: follow the links to skill autotel-core, autotel-request-logging and
  the rest.
---

# production-observability

The bar: an on-call engineer who has never seen this code can tell that it is
failing, find the one request, follow it across every service and queue it
touched, and see why, from telemetry alone. The telemetry must not leak data,
cost more than it earns, or take the app down.

Each item below has an id. Use the same ids as the rules your code review
checks, so the standard you build to is the standard each change is reviewed
against.

## The standard

| Id                    | Done when                                                                                                                                                                                          | With autotel                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `safe-telemetry`      | Init runs once, before the code it instruments, and cannot crash the app. Service name, version and environment come from config. Telemetry flushes on every exit.                                 | `instrumentation.ts` loaded with `--import`; `init({ service, version, environment })`; `processHandlers: true` or your own `shutdown()` |
| `boundary-signal`     | Every route, consumer, job and CLI command has a span, and every outbound call (HTTP, DB, cache, queue, model API) has a child span.                                                               | Framework adapter or middleware; `autoInstrumentations`; `trace()` on jobs; `traceConsumer` / `traceProducer` from `autotel/messaging`   |
| `context-propagation` | One trace spans every service and queue a request touches. Deferred work stays inside the span that started it.                                                                                    | `http` / `undici` instrumentation for outbound calls; `traceProducer` injects context into messages and `traceConsumer` continues it     |
| `request-context`     | Each request's wide event carries the bounded ids that find it (tenant, user, order or job id, outcome) and which way each decision went (branch, fallback, retry, cache, flag variant, provider). | `getRequestLogger().set({...})`, one wide event per request                                                                              |
| `structured-logs`     | Server code logs through one structured logger, and every line carries `trace_id` and `span_id`.                                                                                                   | `autoInstrumentations: ['pino']` plus `logs: true`, with the logger created after `init()`                                               |
| `error-context`       | Errors keep their cause, mark the span ERROR, and are logged once with ids.                                                                                                                        | `createStructuredError({ message, why, fix, cause })` thrown through `trace()`, or `recordStructuredError(ctx, err)`                     |
| `alertable-signal`    | Every dependency, queue and job emits outcome by bounded reason, a duration, and for queues the lag. Alerts and SLOs read them.                                                                    | `Metric#trackOutcome`, `createHistogram`, `createObservableGauge`, `autotel/slo` (skill `design-alertable-metrics`)                      |
| `feature-signal`      | A user-facing change emits the event or metric that shows whether it worked.                                                                                                                       | `track()` or `Event` (skill `autotel-events`)                                                                                            |
| `no-sensitive-data`   | No secrets, tokens, cookies, whole bodies or headers, or personal data beyond agreed ids reach telemetry.                                                                                          | `attributeRedactor: 'default'` set explicitly; fields chosen, never spread                                                               |
| `bounded-attributes`  | Span names and metric labels are bounded: route templates, enum reasons. Ids live on spans and logs only.                                                                                          | `spanNameNormalizer: 'rest-api'`; labels from closed sets                                                                                |
| `silent-drop`         | Skipped, filtered, retried-out and fallen-back work is counted with a reason.                                                                                                                      | A counter or a `log.warn` with the reason, inside the span                                                                               |
| `telemetry-config`    | Sampling keeps every error and slow request; health checks and probes are filtered out; production runs at the agreed log level.                                                                   | `sampling: 'production'` set explicitly (unset keeps everything); `spanFilter` for probes (skill `tune-sampling`)                        |
| `telemetry-contract`  | Names that dashboards and alerts read are treated as a contract and covered by a test.                                                                                                             | `createTraceCollector()` from `autotel/testing`, or `autotel-vitest`                                                                     |

Ownership of the dashboards and alerts (skill `autotel-grafana`) and audit
trails for money and auth paths (skill `build-audit-trails`) build on this. They
are not part of the minimum.

## Existing codebase

Work in this order. Each step is mergeable on its own, and the earlier ones
make the later ones visible.

1. **Measure.** Run `npx autotel-cli map --json --no-write` (Node 22 or later)
   and keep the score and the dark routes for the report. On an unsupported
   framework, list entry points by hand.
2. **Startup and shutdown (`safe-telemetry`).** Set up the instrumentation file
   (see [New project](#new-project)) and run the app with it. Then check the
   points below before moving on:
   - With no endpoint configured, autotel exports nothing.
   - In production, set `OTEL_EXPORTER_OTLP_ENDPOINT` to the base URL. autotel
     appends `/v1/traces`, `/v1/metrics` and `/v1/logs`, so a URL that already
     ends in `/v1/traces` breaks metrics.
   - `init()` throws on an unknown `sampling` preset or a bad
     `attributeRedactor`, so validate config before deploying.
   - `beforeExit` does not fire on `process.exit()`. Code that exits itself must
     `await shutdown()` first.
3. **Entry points and outbound calls (`boundary-signal`, `context-propagation`).**
   - Add the framework adapter (skill `autotel-frameworks`).
   - Put the libraries the service calls in `autoInstrumentations`. It is an
     allowlist and is off by default in Node, so list `http` for outbound
     calls.
   - Wrap jobs, crons, consumers and CLI commands in `trace()` or
     `traceConsumer`.
   - Re-run `map` until no route is dark.
4. **Request context and logs (`request-context`, `structured-logs`).**
   - In each handler, call `getRequestLogger().set()` with the ids that find
     the request.
   - Route the existing logger through instrumentation so every line carries
     the trace.
   - Replace `console.*` in server code.
   - Skill `autotel-request-logging` covers this step.
5. **Errors (`error-context`).**
   - Replace bare `throw new Error('failed')` and empty catches with structured
     errors that keep `cause`.
   - At the HTTP boundary, return `parseError(err)`, which strips `internal`.
   - Skill `autotel-structured-errors` covers this step.
6. **Data safety and cost (`no-sensitive-data`, `bounded-attributes`, `telemetry-config`).**
   - Set `attributeRedactor` explicitly. It is automatic only when the
     resolved environment is `production`, and the environment defaults to
     `NODE_ENV`.
   - Set `spanNameNormalizer` and filter health probes with `spanFilter`.
   - Set `sampling: 'production'` explicitly. It keeps every error and slow
     call and 10% of the rest. With no `sampling` at all, nothing is dropped,
     which is right in development and expensive at scale. With your own
     `spanProcessors`, wrap the exporting one in `TailSamplingSpanProcessor`
     (`init()` warns when none is). Skill `tune-sampling` covers what it does
     and doesn't evaluate.
7. **Signals an alert can use (`alertable-signal`, `silent-drop`).** For each
   dependency, queue and job:
   - count outcomes by a bounded reason
   - record a duration
   - for queues, observe the lag

   Skill `design-alertable-metrics` turns these into alerts, and
   [`incident-readiness.md`](../find-observability-gaps/references/incident-readiness.md)
   lists what to emit per area.

8. **Prove it (`telemetry-contract`).**
   - Add a test per critical path that asserts the span, its key attributes
     and its error status (see [Proving it](#proving-it)).
   - Run the app against `autotel-devtools` and follow one real request end to
     end.
9. **Lock it in.** Set up [enforcement](#enforcement), so the next PR cannot
   undo the work.

Leave a product decision to the team rather than guessing: which ids count as
personal data, SLO targets, and which vendor to use. Name each one in the
report.

## New project

Start with the instrumentation file and the shutdown path, before the first
route, so every later file is written against them.

```typescript
// src/instrumentation.ts — loaded with: node --import ./dist/instrumentation.js dist/server.js
import 'autotel/register'; // ESM loader hook; must come first
import { init } from 'autotel';

init({
  service: process.env.OTEL_SERVICE_NAME ?? 'orders-api',
  // version: from package.json; environment: from NODE_ENV
  autoInstrumentations: ['http', 'undici', 'pg', 'pino'],
  logs: true, // off by default; OTLP over HTTP needs no extra install
  sampling: 'production', // errors, slow calls and 10% of the rest; unset keeps everything
  attributeRedactor: 'default',
  spanNameNormalizer: 'rest-api',
  spanFilter: (span) =>
    !['/healthz', '/readyz'].includes(String(span.attributes['url.path'])), // true keeps the span
  processHandlers: true, // flush on SIGTERM, SIGINT and fatal errors
});
```

```typescript
// src/logger.ts — imported after instrumentation, so pino is patched
import pino from 'pino';
export const logger = pino();
```

Configure the endpoint, headers and resource through environment variables, so
the build does not change per environment:

```bash
OTEL_SERVICE_NAME=orders-api
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.example.com   # base URL, no /v1/traces
OTEL_EXPORTER_OTLP_HEADERS=x-api-key=…
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=production,cloud.region=eu-west-2
```

Then follow the framework skill for routes (skill `autotel-frameworks`), and
give every handler request context and structured errors from the first
commit. For vendor presets, see skill `autotel-backends`.

Each `autoInstrumentations` name is an `@opentelemetry/instrumentation-<name>`
package from `@opentelemetry/auto-instrumentations-node`, an optional peer
dependency to install. `undici` covers Node's global `fetch`, and `http` covers
`node:http`. List only the libraries the service uses.

## Proving it

```typescript
import { createTraceCollector } from 'autotel/testing';

test('a declined payment marks the trace and says why', async () => {
  const collector = createTraceCollector();
  await expect(
    charge({ orderId: 'o_1', card: declinedCard }),
  ).rejects.toThrow();

  const span = collector.expectSpan('payment.charge');
  expect(span.status.code).toBe(2); // ERROR
  expect(span.attributes['order.id']).toBe('o_1');
  expect(span.attributes).not.toHaveProperty('card.number');
});
```

A test like this pins the names that dashboards read (`telemetry-contract`). It
also proves the code never writes the card number (`no-sensitive-data`), which
matters more than the redactor catching it later. The collector records spans
from autotel's own API (`trace()`, `span()`, adapters); auto-instrumented
library spans need `InMemorySpanExporter` from `autotel/exporters`. Skill
`autotel-vitest` has the fixture form.

## Enforcement

**A ratchet in CI.** The step below fails a PR that loses a check a route
passed on the default branch, such as its span or its request context, and
annotates the lines:

```yaml
# .github/workflows/observability.yml (job steps)
- uses: actions/checkout@v4
  with: { fetch-depth: 0 } # the baseline is read from origin/main
- uses: actions/setup-node@v4
  with: { node-version: 22 }
- run: npx autotel-cli map --baseline git:origin/main --min-score 70 --format github --no-write
```

Raise `--min-score` as the score climbs, and keep it there.

**Code review.** Review each PR against the ids in the standard table, and
refuse a PR that breaks one: each id names a blind spot the next incident falls
into.

## Report

End with:

- the `map` score before and after
- the standard's ids that pass, with evidence (a test, a trace seen in
  devtools)
- the ids left open, with the product decision each one waits on
- the enforcement now in place

Never report an id as done on the scanner's word alone. See it in a test or in a
real trace.

## Common mistakes

### HIGH: Logger created before `init()`

pino and winston are patched as they load. A logger module imported before the
instrumentation file writes lines with no trace id. autotel warns about this at
startup.

### HIGH: Trusting the default redaction outside production

`attributeRedactor` is automatic only when the environment resolves to
`production`. A staging deploy with `NODE_ENV=staging` ships raw attributes.
Set it explicitly.

### HIGH: A per-signal URL as the endpoint

`endpoint: 'https://collector/v1/traces'` sends metrics to
`/v1/traces/v1/metrics`. Use the base URL.

### MEDIUM: A span on every function

Spans belong at boundaries and decisions, not on every function. Put detail on
the request logger as attributes of one wide event, so a trace stays readable
and sampling stays cheap.

### MEDIUM: Ids as metric labels

`user.id` or a raw path as a label makes the metric unqueryable and expensive.
Keep ids on spans and logs, and use metric labels for bounded reasons.

## Related

- Skill `find-observability-gaps`: the scanner, its checks and waivers.
- Skill `autotel-core`: `init()` options and the core APIs.
- Skill `review-otel-patterns`: deeper review of an existing setup.
- Skill `debug-missing-spans`: telemetry that never arrives.
- Skill `migrate-to-autotel`: moving from raw OTel, Datadog, Sentry or New Relic.
