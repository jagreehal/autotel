---
name: tune-sampling
description: >
  Choose a sampling strategy for an autotel-instrumented service. Covers
  Node sampling presets and custom samplers, what the tail decision really
  drops, forceKeep and debug baggage, health-check filtering with spanFilter,
  edge predicate tail sampling, deterministic and per-key samplers, cost vs
  cardinality tradeoffs, and the math for picking rates that hit a target
  spans/second budget. Includes recipes for low-volume admin services,
  high-volume APIs, AI agents, and Cloudflare Workers.
---

# Tune sampling

Untuned tracing is either expensive (100 % at scale costs money + drowns dashboards) or unhelpful (1 % loses the failure modes you need to see). The right answer is almost always **sample most of the boring traffic, keep all the interesting traffic**, with explicit overrides for AI calls and customer escalations.

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
Sampling reduces this directly.
```

Head sampling makes a decision **at span start**: fast but coarse, since it cannot know whether the span will fail.
Tail sampling makes the decision **at span end**: it can keep errors and slow calls, but every span is created first.

The right mix:

- **Keep volume tractable** with a low baseline.
- **Always keep** the high-value subset (errors, slow, AI, debug requests).
- **Don't sample audit spans**: separate processor, see [`build-audit-trails`](../build-audit-trails/SKILL.md).

## What Node `init()` actually does

```typescript
import { init } from 'autotel';

init({ service: 'my-app', sampling: 'production' });
```

`sampling` takes a preset: `'development'` (keep everything), `'errors-only'`
(errors only, zero baseline), `'production'` (10 % baseline, plus every error
and every call slower than 1 s) or `'off'` (keep nothing). Any other string
makes `init()` throw. For custom numbers pass a `sampler`, which wins over
`sampling`:

```typescript
import { init, samplingPresets } from 'autotel';

init({
  service: 'my-app',
  sampler: samplingPresets.production({
    baselineSampleRate: 0.05,
    slowThresholdMs: 500,
  }),
});
```

There are no per-span-kind rates. Know these before you tune:

- **No `sampling` and no `sampler` means nothing is sampled away.** A wrapped
  function resolves its sampler per call: the `sampler` passed to `trace()` /
  `withTracing()` / `instrument()`, then the one `init()` was given, then
  keep-everything. Set `sampling` explicitly in production.
- **The decision is made per local root, when it ends.**
  `TailSamplingSpanProcessor` buffers the spans under each local root (no
  parent, or a remote one) until it ends, then keeps or drops all of them.
  Sibling requests under one remote parent each get their own verdict. Spans
  that end later follow theirs, so a dropped trace leaves no orphan children.
  The trace is kept when any wrapped span kept it (error, slow, baseline) or
  called `forceKeep()`. Otherwise the sampler decides from the whole trace:
  any span with ERROR status, the root's duration, and the trace id. That is
  what samples auto-instrumented roots (HTTP, pg, …) too.
- **The baseline hashes the trace id.** Nested wrapped spans agree with each
  other, and two services on the same rate keep the same traces. This is
  per process, not cross-service tail sampling: an error in a downstream
  service cannot bring back the upstream spans this process already dropped.
  For that, use a Collector (below).
- **It waits for work still running.** A root that returns before its
  children (fire-and-forget work) does not decide the trace: the processor
  waits until every span started in it has ended, so a late error or
  `forceKeep()` still counts. `flush()` does not cut the wait short (only
  spans already decided are exported); `shutdown()` decides everything.
- **Buffering has bounds.** At most 20,000 spans wait across all traces
  (`maxBufferedSpans`), and a trace waits at most 30 s from its first span
  (`traceTimeoutMs`). A trace whose root ended is then decided on what it
  has; one whose root is still open (a long-lived connection) is exported as
  it stands. When the span bound is hit, the oldest trace goes the same way.
  A process that runs one long job raises both through
  `init({ tailSampling: { traceTimeoutMs, maxBufferedSpans } })`, so the whole
  job is decided on its outcome at `shutdown()`.
- **The drop happens only where `init()` built the pipeline.** `endpoint`,
  `destinations` and `spanExporters` are wrapped in `TailSamplingSpanProcessor`
  for you. Your own `spanProcessors` are not, on purpose: they replace the
  pipeline, so a branch can keep everything (an audit trail beside a sampled
  ops exporter, see [`build-audit-trails`](../build-audit-trails/SKILL.md)).
  Wrap the exporting one yourself; `init()` hands it the configured sampler,
  so auto-instrumented roots are sampled there too. If a tail sampler is
  configured and no processor is wrapped anywhere, `init()` warns once that
  every span is exported.

```typescript
import { BatchSpanProcessor } from 'autotel/processors';
import { TailSamplingSpanProcessor } from 'autotel/tail-sampling-processor';

init({
  service: 'my-app',
  sampling: 'production',
  spanProcessors: [
    new TailSamplingSpanProcessor(new BatchSpanProcessor(exporter)),
  ],
});
```

`OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` only set the SDK head
sampler, and only when neither `sampling` nor `sampler` is passed.

## Recipes

### Typical web service

`sampling: 'production'`. Lower the baseline with
`samplingPresets.production({ baselineSampleRate })` once volume demands it.

### High-volume API (>1 k req/s)

```typescript
sampler: samplingPresets.production({ baselineSampleRate: 0.01 }),
```

Errors and slow calls are still kept at any baseline.

### Low-volume admin / internal service (<10 req/s)

`sampling: 'development'`. 100 % is fine. Don't penalise yourself for a
service that produces 1 GB of traces a week.

### Drop health checks and other noise

There is no built-in health-check filter. Use `spanFilter`: return `false` to
drop a span. It wraps every span processor `init()` ends up with, and sees
attributes before redaction.

```typescript
init({
  service: 'my-app',
  sampling: 'production',
  spanFilter: (span) =>
    !['/health', '/healthz', '/ready'].some((p) => span.name.includes(p)),
});
```

### Collector does the sampling

When a Collector runs `tail_sampling` across services, it needs every span.
Leave autotel's sampling off (`sampling: 'development'`, or set neither
`sampling` nor `sampler`) and keep `spanFilter` for noise. All spans travel
to the Collector; only the traces it keeps reach the paid backend.

`spanFilter` respects the trace's shape wherever a `TailSamplingSpanProcessor`
sits behind it (every exporter `init()` builds): filtering a request's root
(`GET /health`) drops it and every span under it, leaving siblings under the
same remote parent in place, and filtering a span in the middle
(`fs.read`) re-parents its children to the nearest kept ancestor. Behind a
plain processor it drops one span at a time.

## Customer-driven sampling (debug baggage)

Let support flip on full tracing per request. The trace is kept when the
baggage carries `autotel.debug` set to
anything other than `''` or `'0'`. The default propagators include W3C
baggage, so a caller sends:

```
baggage: autotel.debug=1
```

The header is only read where incoming context is extracted (the `'http'`
auto-instrumentation or a framework adapter). For a decision made in your own
middleware, call `forceKeep()` inside the request span instead:

```typescript
import { forceKeep } from 'autotel';

if (request.headers.get('x-debug-trace') === '1') forceKeep();
```

Both keep the whole trace, auto-instrumented spans included. Invaluable for
reproducing customer reports.

## Edge runtimes: predicate tail sampling

Whole-trace tail sampling with a predicate exists only in `autotel-edge` /
`autotel-cloudflare`. Their processor buffers a trace and hands
`{ traceId, spans, localRootSpan }` to `sampling.tailSampler` when the local
root ends. The default keeps traces that were head-sampled or whose root
errored.

Keep the default always-on head sampler and let the tail sampler decide. A
`headSampler: { ratio }` stops spans being recorded at all, so errors in the
unsampled share never reach the tail sampler.

```typescript
import { defineWorkerFetch } from 'autotel-cloudflare';
import {
  combineTailSamplers,
  createAdaptiveTailSampler,
  createCustomTailSampler,
} from 'autotel-cloudflare/sampling';

export default defineWorkerFetch(
  {
    service: { name: 'edge' },
    exporter: { url: 'https://otlp.example.com/v1/traces' },
    sampling: {
      tailSampler: combineTailSamplers(
        // 10 % baseline + root errors + roots slower than 1 s
        createAdaptiveTailSampler({ baselineSampleRate: 0.1 }),
        // always keep AI traces
        createCustomTailSampler((trace) =>
          trace.spans.some(
            (s) =>
              typeof s.attributes['gen_ai.provider.name'] === 'string' ||
              // legacy: third-party instrumentations may still emit gen_ai.system
              typeof s.attributes['gen_ai.system'] === 'string',
          ),
        ),
      ),
    },
  },
  handler,
);
```

`autotel-edge/sampling` exports the same helpers, plus
`createErrorOnlyTailSampler`, `createSlowOnlyTailSampler`,
`createRandomTailSampler` and `SamplingPresets`.

## AI / LLM-aware sampling

LLM calls produce 5–50 spans per request and are 100× more expensive than a typical handler call. Tradeoffs:

- **Don't sample AI handlers below 50 %**: debugging "why did the model loop" requires the full chain. In Node, call `forceKeep()` in the agent's root span, or pass that wrapper its own `sampler`.
- **On the edge, always tail-keep AI traces**: the `gen_ai.*` attributes flag them (recipe above).
- **Cost-aware sampling (edge)**: keep all calls above a $ threshold:

```typescript
createCustomTailSampler((trace) => {
  const cost = trace.spans.reduce(
    (acc, s) =>
      acc +
      (typeof s.attributes['gen_ai.usage.cost.usd'] === 'number'
        ? (s.attributes['gen_ai.usage.cost.usd'] as number)
        : 0),
    0,
  );
  if (cost > 0.1) return true; // any trace > $0.10 → keep
  if (cost > 0.01) return Math.random() < 0.5; // > $0.01 → 50 %
  return Math.random() < 0.1; // < $0.01 → 10 %
});
```

## Keeping the trace whole across services

`RandomSampler` rolls the dice in each process. The API can keep a trace its
worker drops, which leaves a waterfall with holes and no way to tell a dropped
span from a fast one. `DeterministicSampler` hashes a key that travels with the
request, so every service reaches the same verdict:

```typescript
import { DeterministicSampler } from 'autotel/sampling';
import { trace } from '@opentelemetry/api';

init({
  service: 'checkout',
  sampler: new DeterministicSampler({
    sampleRate: 0.1,
    key: () => trace.getActiveSpan()?.spanContext().traceId,
  }),
});
```

Give every service the same rate and the same key. Different rates break the
agreement again.

## Per-key target rates

A single rate cannot fit skewed traffic. At 1 % your busiest endpoint still
floods storage while the rare tenant whose failures you need disappears.
`KeyTargetRateSampler` counts traffic per key over a rolling window and gives
each key its own rate, so every key contributes about the same number of
events:

```typescript
import { KeyTargetRateSampler } from 'autotel/sampling';

new KeyTargetRateSampler({
  key: (context) => context.operationName,
  targetPerKey: 10, // ~10 events per key per window
  windowMs: 30_000,
  maxKeys: 1000, // keys past this share one overflow bucket
});
```

The first window keeps everything, because no traffic history exists yet. Rates
apply from the second window on.

## Recording the rate

Sampled counts lie unless you record what you discarded. A query over a 1 %
sample reports a hundredth of your traffic, and the number looks plausible
enough to act on.

autotel writes `autotel.sampling.rate` on the span as "1 in N", so
`COUNT * rate` estimates the population. It appears only when N exceeds 1, so
fully captured spans stay clean. A custom sampler joins in by implementing
`sampleRate()`:

```typescript
import type { Sampler } from 'autotel/sampling';

class TenantSampler implements Sampler {
  shouldSample(context) {
    /* … */
  }
  sampleRate() {
    return 20; // each kept event stands for 20
  }
}
```

Reach for `hashUnitInterval` from `autotel/sampling` when you need the same
spread for your own keys.

## Sizing the rate

Target volume:

```
spans/sec ≈ requests/sec × spans_per_request × keep_rate
```

Worked example for a 100 req/s API with 8 spans/req:

| Baseline | Always kept                | Result                                      |
| -------- | -------------------------- | ------------------------------------------- |
| 100 %    | n/a                        | 800 spans/sec: expensive                    |
| 10 %     | errors + slow + AI (≈ 5 %) | ≈ 110 spans/sec: sweet spot                 |
| 1 %      | errors + slow + AI (≈ 5 %) | ≈ 48 spans/sec: too sparse for p99 alerting |

For per-vendor pricing:

- **Honeycomb**: $0.000005 / event for paid plans. 110 spans/sec × 86 400 s = 9.5 M events/day = $48/day.
- **Datadog APM**: ~$1.27/M spans ingested (varies by region). Same volume → ~$12/day.
- **Grafana Cloud**: 100 GB free tier; 110 spans/sec ≈ 5 GB/day.

## Anti-patterns

| Anti-pattern                                      | Fix                                                                        |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| No `sampling` in production                       | Nothing is dropped; set `sampling: 'production'` or a `sampler`            |
| 100 % sampling at scale "to be safe"              | You're paying 10–100× without proportional value                           |
| Low baseline with errors not kept                 | Keep `alwaysSampleErrors` on (the presets do)                              |
| Custom `spanProcessors` without tail wrapping     | `init()` warns; wrap in `TailSamplingSpanProcessor` or nothing is dropped  |
| Expecting a 10 % sample to be whole traces (Node) | Each wrapped span decides alone; `forceKeep()` or `autotel.debug` baggage  |
| Edge `headSampler: { ratio }` plus a tail sampler | Unsampled spans never reach the tail; keep head always-on                  |
| Health checks filling the budget                  | `spanFilter` drops them                                                    |
| Sampling AI calls below 50 %                      | Debugging tool loops requires the full chain                               |
| Audit spans subject to sampling                   | Route them to a separate processor (see `build-audit-trails`)              |
| Rate-by-route hand-coded in handlers              | One `sampler` in `init()`; per-wrapper `sampler` option for the exceptions |
| Counting sampled spans as the population          | Multiply by `autotel.sampling.rate`                                        |
| `RandomSampler` on a multi-service trace          | `DeterministicSampler` keyed on the trace id keeps it whole                |
| One flat rate over skewed traffic                 | `KeyTargetRateSampler` gives rare keys their own rate                      |
