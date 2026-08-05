# example-genai-metrics

The app records no metrics. It emits `gen_ai.*` spans, and the collector turns
them into the canonical GenAI metrics with the `signal_to_metrics` connector.

That covers most of what a hosted AI observability product shows you: cost per
model, error rate, time to first token, token usage, tool usage. All of it from
spans you were already sending, on a stack you run yourself.

## Prerequisites

- Docker and Docker Compose
- pnpm

## Run it

```bash
cd apps/example-genai-metrics
docker compose up -d          # collector + Grafana LGTM
pnpm install
pnpm start                    # 40 agent conversations
```

Open [Grafana](http://localhost:3000) (admin / admin) and import
[`grafana-llm.json`](../../packages/autotel-mcp/src/resources/dashboards/grafana-llm.json).
Every panel fills from the derived metrics.

To query without the UI:

```bash
curl -sG http://localhost:9090/api/v1/query \
  --data-urlencode 'query=sum by (gen_ai_request_model) (gen_ai_client_cost_usd_total)'
```

A 40-conversation run produces roughly this:

| Metric                                  | Value                         |
| --------------------------------------- | ----------------------------- |
| `gen_ai_client_cost_usd_total`          | $0.24, claude 30x gpt-4o-mini |
| `gen_ai_client_token_usage_sum`         | 59k input, 15k output         |
| `gen_ai_client_tool_calls_total`        | ~12 per tool                  |
| p95 `gen_ai_client_time_to_first_chunk` | ~0.95s                        |
| error rate                              | ~6%                           |

Stop everything:

```bash
docker compose down
```

## Why the app switches its own metrics off

`traceGenAI` records these instruments itself, so this example passes
`metrics: false` and lets the collector do the work. Run both and you double
count.

Pick the SDK when you own the code: the metrics carry `gen_ai.response.model`
and land whether or not a collector is in the path. Pick the collector when you
do not: another language, a vendor SDK, or any service emitting `gen_ai.*` spans
you cannot change.

## What the app emits

`traceGenAI` from `autotel-genai` writes the canonical attributes, and the
helpers fill in the rest when the call returns:

```typescript
recordGenAiUsage(ctx, model, { inputTokens, outputTokens });
recordStreamTiming(ctx, { timeToFirstChunk, timeToFinish });
```

`recordGenAiUsage` prices the call as well as recording the counts, so it writes
`gen_ai.usage.input_tokens`, `output_tokens` and `cost.usd` between them. Reach
for `recordLLMCost` separately only when you passed `recordCost: false` because
the provider returned a real figure and an estimate would be wrong.

That leaves these on the span, and the connector reads them:

| Span attribute                          | Becomes                             |
| --------------------------------------- | ----------------------------------- |
| span duration                           | `gen_ai.client.operation.duration`  |
| `gen_ai.usage.input_tokens`             | `gen_ai.client.token.usage`         |
| `gen_ai.usage.output_tokens`            | `gen_ai.client.token.usage`         |
| `gen_ai.usage.cost.usd`                 | `gen_ai.client.cost.usd`            |
| `gen_ai.response.time_to_first_chunk`   | `gen_ai.client.time_to_first_chunk` |
| `gen_ai.operation.name == execute_tool` | `gen_ai.client.tool.calls`          |
| `error.type`                            | a label on the duration metric      |

## Details worth stealing

**One metric, two declarations.** The spec models tokens as a single
`gen_ai.client.token.usage` split by `gen_ai.token.type`, but the span carries
input and output as separate attributes. Declaring the metric twice and using
`default_value` to stamp the type produces the spec shape:

```yaml
- name: gen_ai.client.token.usage
  attributes:
    - key: gen_ai.token.type
      default_value: input
  histogram:
    value: Int(span.attributes["gen_ai.usage.input_tokens"])
```

**Delta breaks Prometheus.** `signal_to_metrics` emits delta temporality and
Prometheus stores cumulative, so every write fails until you put
`deltatocumulative` in the metrics pipeline. The failures are silent from the
sending side: your collector reports a clean export while Grafana's collector
counts them in `otelcol_exporter_send_failed_metric_points_total`.

**Bucket boundaries match the SDK.** All fourteen boundaries in each list come
from `GEN_AI_DURATION_BUCKETS_SECONDS` or `GEN_AI_TOKEN_USAGE_BUCKETS` in
`autotel-genai/metrics`, `time_to_first_chunk` included, since `traceGenAI`
gives that one the duration advice as well. A service emitting its own
histograms and one relying on the collector then land in the same buckets and
chart together. Truncate a list and they stop agreeing at the tail: drop the
token boundaries above `1048576` and a million-token context window falls into
the overflow bucket on one path but not the other.

**Unit suffixes change the metric name.** `unit: s` makes Prometheus store
`gen_ai_client_operation_duration_seconds_bucket`, not
`gen_ai_client_operation_duration_bucket`. The shipped dashboard matches both
with `{__name__=~"gen_ai_client_operation_duration(_seconds)?_bucket"}`.

## What this does not give you

Cost, latency and tool usage are metrics. Whether the agent answered well is
not. Judging output quality needs a judge: another model scoring the
conversation, or a heuristic over the response. `autotel-genai` carries the
result once you have it, through `recordEvaluationResult` and the
`gen_ai.evaluation.*` attributes, so the score lands on the same trace as the
call it judges. Running the judge is your code.
