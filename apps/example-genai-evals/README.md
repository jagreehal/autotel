# example-genai-evals

Cost and latency tell you the agent is running. Evaluations tell you it is
answering.

Three evaluators score a sample of answers, and each verdict becomes a
`gen_ai.evaluation.result` event on the trace of the conversation it judges. A
failing score and the answer that earned it open together.

## Prerequisites

- Docker and Docker Compose
- pnpm

## Run it

```bash
cd apps/example-genai-evals
docker compose up -d          # Grafana LGTM
pnpm install
pnpm start                    # 12 questions, half of them scored
```

Twelve questions carry three planted problems: one answer runs long, one cites a
document retrieval never returned, and one question hides a prompt injection.
Score everything to see all three:

```bash
EVAL_SAMPLE_RATE=1 pnpm start
```

Then ask Loki for the pass rate:

```bash
curl -sG http://localhost:3100/loki/api/v1/query --data-urlencode 'query=
  sum(count_over_time({service="support-agent"} | json | gen_ai_evaluation_score_label="pass" [15m]))
  /
  sum(count_over_time({service="support-agent"} | json | gen_ai_evaluation_name!="" [15m]))'
```

A full run scores 36 verdicts and 3 fail, so that returns 0.917. Which
evaluator is unhappy:

```promql
sum by (gen_ai_evaluation_name) (
  count_over_time({service="support-agent"} | json | gen_ai_evaluation_score_label="fail" [15m])
)
```

Put either query in a Grafana alert rule and you have the "tell me when pass
rate drops below 70%" that hosted products charge for. Grafana is on
[localhost:3000](http://localhost:3000), admin / admin.

```bash
docker compose down
```

## The evaluators

None of them calls a model. An LLM judge is the expensive option, so let the
cheap checks go first: a heuristic that runs on every response beats a judge you
sample at 5% because of the bill.

| Evaluator          | Asks                                            | Fails when                                                             |
| ------------------ | ----------------------------------------------- | ---------------------------------------------------------------------- |
| `brevity`          | Is this a summary or a wall of text?            | Over 600 characters                                                    |
| `groundedness`     | Did every citation come from retrieval?         | The answer cites a document retrieval never returned, or cites nothing |
| `prompt_injection` | Is the user trying to rewrite the instructions? | The question matches a known pattern                                   |

`groundedness` is the one worth studying. Comparing cited ids against retrieved
ids catches an invented source without asking a model whether the answer is
true, and it gives partial credit: cite two documents where one is invented and
you score 0.5.

`prompt_injection` scores the question rather than the answer. An attempt the
agent shrugged off is still worth counting, and a spike in attempts is the thing
to alert on.

## Sampling

`EVAL_SAMPLE_RATE` decides what fraction of answers get scored, and the decision
happens after the answer exists:

```typescript
const result = await answer(turn, index);
if (Math.random() < SAMPLE_RATE) score(ctx, result);
```

Sampling before the call would bias the sample towards whatever the cheap path
produces. Lower the rate as traffic grows; a busy agent needs a smaller fraction
than a new one to reach the same confidence.

## Why a subscriber is configured

Evaluation results are events, and autotel routes events to subscribers rather
than straight to OTLP. Without one, `recordEvaluationResult` is a no-op:

```typescript
init({
  service: 'support-agent',
  subscribers: [new LokiSubscriber({ endpoint: 'http://localhost:3100' })],
});
```

Each event carries `traceId` and `spanId`, so a verdict in Loki links back to
the conversation in Tempo.

## What is missing, honestly

These evaluators check structure, not truth. `groundedness` proves a citation
was retrieved, not that the sentence it supports says what the document says.
Catching that needs a model reading both, which is what an LLM judge is for. The
plumbing here does not change when you add one: run the judge, hand the score to
`recordEvaluationResult`, and the same queries keep working.
