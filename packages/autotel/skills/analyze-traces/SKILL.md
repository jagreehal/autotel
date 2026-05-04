---
name: analyze-traces
description: >
  Analyze OpenTelemetry traces and structured logs from a running autotel service to debug errors,
  investigate latency, follow requests across services, and surface cardinality / attribute hygiene
  problems. Works with traces from any OTLP backend (Honeycomb, Grafana Tempo, Datadog, Jaeger,
  Sentry, Axiom, HyperDX, …) plus the local `.autotel/spans/` dump and `InMemorySpanExporter` in tests.
type: analyze
library: autotel
license: MIT
---

# Analyze traces

This skill teaches an AI assistant how to read and reason about OpenTelemetry traces produced by autotel — whether they're sitting in a backend, exported to a local JSON dump, or captured in a test.

## When to use

- Debugging a failing endpoint after deploy
- Investigating latency regressions (p50 / p95 / p99 spike)
- Following a single request across browser → server → queue → worker
- Auditing attribute hygiene (cardinality, PII leak risk, noise)
- Spot-checking that a new instrumentation actually produces the spans you expected

## Input formats

| Source                         | How to access                                                      |
| ------------------------------ | ------------------------------------------------------------------ |
| Local debug dump               | `.autotel/spans/*.ndjson` — one span per line, OTLP JSON shape     |
| `InMemorySpanExporter` (tests) | `exporter.getFinishedSpans()`                                      |
| Backend (interactive)          | Jaeger / Tempo / Honeycomb UI; Datadog Trace Search; etc.          |
| Backend (programmatic)         | Honeycomb Query API, Tempo `/api/search`, Datadog Logs / Trace API |

## The shape of an autotel span

```json
{
  "name": "POST /api/checkout",
  "context": { "traceId": "…", "spanId": "…" },
  "parentSpanId": "…",
  "kind": "SERVER",
  "startTimeUnixNano": "…",
  "endTimeUnixNano": "…",
  "status": { "code": "OK" },
  "attributes": {
    "service.name": "checkout",
    "http.request.method": "POST",
    "url.full": "https://api.example.com/api/checkout",
    "http.response.status_code": 200,
    "user.id": "usr_123",
    "user.plan": "enterprise",
    "cart.items": 3,
    "cart.total": 14999,
    "_correlationId": "01J…"
  },
  "events": [
    {
      "name": "log.emit.manual",
      "attributes": { "level": "info", "stage": "validated" }
    }
  ],
  "links": [],
  "resource": {
    "service.name": "checkout",
    "deploy.id": "v2025.05.04-1"
  }
}
```

Key conventions to recognise:

- `service.name` distinguishes services in a multi-service trace.
- `_correlationId` (autotel-specific) is stable within a logical unit of work even across forked child spans (`_parentCorrelationId` ties them).
- `gen_ai.*` attributes follow OpenTelemetry gen-ai semantic conventions for LLM calls.
- `exception.*` attributes (auto-set by `createStructuredError`) carry `type`, `message`, `stacktrace`.

## Common investigations

### "Why is endpoint X failing?"

1. Find the trace: filter `service.name = "<svc>" AND http.route = "<route>" AND status = error` for the last hour.
2. Open the slowest / latest matching trace.
3. Inspect the root span's `exception.message` and `exception.stacktrace`.
4. Walk down the child spans — the deepest span with `status.code = ERROR` is usually the culprit.
5. If using `createStructuredError`, look for `code`, `why`, `internal.*` attributes. They usually answer the "why" without you reading code.

### "Why is endpoint X slow?"

1. Find a slow trace: `service.name = "<svc>" AND http.route = "<route>" AND duration > p99(duration)`.
2. View the waterfall — pinpoint the longest child span by self-time (not wall time).
3. Common offenders:
   - **Sequential awaits that should be parallel** — sibling spans run end-to-end instead of overlapping.
   - **N+1 queries** — many short same-named spans (`SELECT * FROM …`) under one parent.
   - **Cold starts** — `faas.coldstart=true` in Workers or Lambda.
   - **Tool retries** — gen-ai spans with `gen_ai.response.finish_reason = error` followed by another call.

### "Follow this user across services"

Use `_correlationId` (or `user.id` if you have it):

```
service.name in (web, api, worker) AND _correlationId = "01J…"
ORDER BY startTime
```

Each service contributes spans with the same `traceId` (W3C trace context propagation handles this automatically with autotel's global fetch instrumentation).

### "Did the new instrumentation actually fire?"

In a test, dump the in-memory exporter:

```typescript
import { InMemorySpanExporter } from 'autotel/exporters';
const exporter = new InMemorySpanExporter();
// … run the code under test
const spans = exporter.getFinishedSpans();
console.log(spans.map((s) => ({ name: s.name, attrs: s.attributes })));
```

Or live, point the SDK at a local file dump:

```typescript
init({ service: 'my-app', debug: 'pretty', spanDumpPath: '.autotel/spans' });
```

…then `tail -f .autotel/spans/*.ndjson | jq` while exercising the feature.

## Cardinality / hygiene audits

| Check                         | Query / heuristic                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Span name cardinality**     | Top-K distinct `name` per service. Anything > a few hundred is a red flag — likely an unnormalised URL.         |
| **Per-attribute cardinality** | `unique(attribute_value)` per `attribute_key`. UUIDs / emails / `Date.now()` ids in attributes blow up storage. |
| **Missing `service.name`**    | Spans where the resource attribute is empty or `"app"` — fix at the SDK init.                                   |
| **PII smell**                 | Look for raw `@`, leading digit-runs of length 16, or `eyJ` prefixes — your redactor is off.                    |
| **Health-check noise**        | Spans with `http.route in (/healthz, /ready)`. Drop with `FilteringSpanProcessor`.                              |

## Reading gen-ai traces

LLM calls produce a parent span (kind `CLIENT`) with children for each tool call:

| Attribute                                                  | Meaning                                  |
| ---------------------------------------------------------- | ---------------------------------------- |
| `gen_ai.system`                                            | Provider (`openai`, `anthropic`, …)      |
| `gen_ai.request.model`                                     | Model id                                 |
| `gen_ai.usage.input_tokens` / `output_tokens`              | Token count                              |
| `gen_ai.usage.cache_read_tokens` / `cache_creation_tokens` | Cache hits                               |
| `gen_ai.response.finish_reason`                            | `stop`, `tool_calls`, `length`, `error`  |
| `gen_ai.tool.name`                                         | Tool invoked (on tool-call child spans)  |
| `gen_ai.cost.usd`                                          | Estimated cost (if pricing map provided) |

Common findings:

- High `gen_ai.usage.input_tokens` with low `cache_read_tokens` → enable prompt caching.
- Many sequential tool-call spans → consider parallel tool calls if the model supports it.
- `gen_ai.response.finish_reason = length` → bump `max_tokens`.

## When the trace is missing

If you expected a span and there isn't one:

1. **Sampling.** Did head sampling drop it? Check `sampling.rates` and `recordedSpans` in any subscriber.
2. **Workers without `waitUntil`.** Did the request return before the exporter flushed? Move to `defineWorkerFetch` / `wrapModule`.
3. **`instrumentation.disabled = true`** — check env-conditional config.
4. **Exporter rejected.** Check service logs for `OTLP exporter` 4xx / 5xx — bad token, wrong dataset.

## Output format

When summarising an investigation, lead with the **decision-changing fact**, then the supporting evidence:

```
Failure cause: payment.declined (Stripe code: insufficient_funds)
- Trace: 9d3a…b21
- 38 / 412 checkout requests in the last hour failed with status=402.
- All in eu-west-1, all on plan=free.
- exception.cause.stripeChargeId starts with ch_3M…
- Suggest: surface the structured `fix` field to the client; current 402 body returns generic message.
```

Keep raw span dumps out of the summary; link to the trace ID instead.
