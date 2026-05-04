---
name: tune-sampling
description: >
  Choose a sampling strategy for an autotel-instrumented service. Covers
  head sampling (per-span-kind rates, parent-based, ratio), tail sampling
  (keep errors, slow, AI-aware, debug-headers), cost vs cardinality
  tradeoffs, and the math for picking rates that hit a target spans/second
  budget. Includes recipes for low-volume admin services, high-volume APIs,
  AI agents, and Cloudflare Workers.
type: tune
library: autotel
license: MIT
---

# Tune sampling

Untuned tracing is either expensive (100 % at scale costs money + drowns dashboards) or unhelpful (1 % loses the failure modes you need to see). The right answer is almost always **head sample most of the boring traffic, tail keep all the interesting traffic**, with explicit overrides for AI calls and customer escalations.

## When to use

- Hitting your observability budget
- Dashboards too sparse to spot anomalies
- "We have the trace IDs but the spans are gone" complaints
- New service launching at scale
- Long-running AI agents producing 50+ spans per request

## The mental model

```
Total cost = (spans/sec × $/span) + (storage_GB × $/GB-month)
                   ↑
Head sampling reduces this directly.
```

Head sampling makes a decision **at span start** — fast, but coarse (it doesn't know if the span will fail).
Tail sampling makes the decision **at span end** — slower, more storage upfront, but precise.

The right mix:

- **Head sample at the entry point** to keep volume tractable.
- **Tail keep** the high-value subset (errors, slow, AI, debug-headered).
- **Don't sample audit spans** — separate processor, see [`build-audit-trails`](../build-audit-trails/SKILL.md).

## Head sampling recipes

### Default for a typical web service

```typescript
init({
  service: 'my-app',
  sampling: {
    rates: {
      server: 25,    // server entry spans — sample ¼
      client: 5,     // outbound HTTP — sample 1/20
      internal: 5,   // internal sub-spans — sample 1/20
    },
  },
})
```

Children of a sampled root are **all** kept (parent-based propagation is the default). So `server: 25` means 25 % of *user requests*, complete trace each.

### High-volume API (>1 k req/s)

```typescript
sampling: {
  rates: { server: 5, client: 1, internal: 1 }, // 5 % → tail keeps errors anyway
  tail: keepInterestingTraces,
},
```

### Low-volume admin / internal service (<10 req/s)

100 % is fine. Don't penalise yourself for a service that produces 1 GB of traces a week.

### Cloudflare Workers (per-colo budget)

Workers run distributed — head sampling is your friend because there's no central queue:

```typescript
defineWorkerFetch(
  {
    service: { name: 'edge' },
    sampling: { rates: { server: 10 } }, // 10 % per colo, scales naturally
  },
  handler,
)
```

## Tail sampling — keep interesting traces

Tail sampling looks at the full trace (root span + children) before deciding. autotel ships `TailSamplingProcessor`:

```typescript
import { TailSamplingProcessor } from 'autotel/processors'
import { SpanStatusCode } from '@opentelemetry/api'

const tail = new TailSamplingProcessor({
  keep: (trace) => {
    // 1. Always keep errors
    if (trace.localRootSpan.status?.code === SpanStatusCode.ERROR) return true
    if (trace.spans.some((s) => s.status?.code === SpanStatusCode.ERROR)) return true

    // 2. Always keep slow traces (configurable threshold)
    if (durationMs(trace.localRootSpan) > 1_000) return true

    // 3. Always keep customer-marked traces
    if (trace.localRootSpan.attributes['debug.trace'] === true) return true

    // 4. Always keep AI traces (rare + expensive — full visibility helps)
    if (trace.spans.some((s) => typeof s.attributes['gen_ai.system'] === 'string')) return true

    // 5. Otherwise: respect head sampling decision
    return false
  },
})
```

### Combining with multi-backend

```typescript
spanProcessors: composeSpanProcessors([
  // Drop nothing here — we want the tail processor to see the full trace
  new BatchSpanProcessor(localExporter),
  tail,                                            // filters before remote export
  new BatchSpanProcessor(expensiveRemoteExporter),
])
```

## AI / LLM-aware sampling

LLM calls produce 5–50 spans per request and are 100× more expensive than a typical handler call. Tradeoffs:

- **Don't head-sample AI handlers below 50 %** — debugging "why did the model loop" requires the full chain.
- **Always tail-keep AI traces** — the `gen_ai.*` attributes flag them.
- **Cost-aware sampling** — keep all calls above a $ threshold:

```typescript
keep: (trace) => {
  const cost = trace.spans.reduce(
    (acc, s) => acc + (typeof s.attributes['gen_ai.cost.usd'] === 'number' ? (s.attributes['gen_ai.cost.usd'] as number) : 0),
    0,
  )
  if (cost > 0.10) return true       // any trace > $0.10 → keep
  if (cost > 0.01) return Math.random() < 0.5  // > $0.01 → 50 %
  return Math.random() < 0.10        // < $0.01 → 10 %
}
```

## Customer-driven sampling (debug header)

Let support flip on full tracing per request:

```typescript
const tail = new TailSamplingProcessor({
  keep: (trace) => trace.localRootSpan.attributes['x-debug-trace'] === '1' || /* … */,
})
```

In your middleware:

```typescript
if (request.headers.get('x-debug-trace') === '1') {
  useLogger().set({ 'x-debug-trace': '1' })
}
```

Now any user can mark a request as "trace this fully" by sending the header — invaluable for reproducing customer reports.

## Sizing the rate

Target volume:

```
spans/sec ≈ requests/sec × spans_per_request × head_rate × tail_keep_rate
```

Worked example for a 100 req/s API with 8 spans/req:

| Head rate | Tail keep | Result |
| --- | --- | --- |
| 100 % | 100 % | 800 spans/sec — expensive |
| 10 % | 100 % (errors + slow + AI ≈ 5 %) | ≈ 110 spans/sec — sweet spot |
| 1 % | 100 % | ≈ 18 spans/sec — too sparse for p99 alerting |

For per-vendor pricing:

- **Honeycomb**: $0.000005 / event for paid plans. 110 spans/sec × 86 400 s = 9.5 M events/day = $48/day.
- **Datadog APM**: ~$1.27/M spans ingested (varies by region). Same volume → ~$12/day.
- **Grafana Cloud**: 100 GB free tier; 110 spans/sec ≈ 5 GB/day.

## Anti-patterns

| Anti-pattern | Fix |
| --- | --- |
| 100 % sampling at scale "to be safe" | You're paying 10–100× without proportional value |
| 1 % sampling with no tail keep | You'll miss every interesting failure |
| Forgetting to tail-keep errors | Sampled traces with errors → silent customer pain |
| Same rate for `server` and `internal` | Internal sub-spans are 5–20× more numerous; sample harder |
| Ratio-based sampling on service entry point | Use parent-based — children of a sampled trace stay together |
| Head-sampling AI calls below 50 % | Debugging tool loops requires the full chain |
| Audit spans subject to sampling | Route them to a separate processor (see `build-audit-trails`) |
| Tail processor before exporter (loses spans) | Tail processor goes between head sampler and remote exporter |
| Rate-by-route hand-coded in handlers | Use head sampler + tail keep — declarative, one place |
