# autotel-genai

> Gold-standard OpenTelemetry **GenAI** instrumentation for LLM calls, tools, and agents.

`autotel-genai` is the AI layer for [autotel](https://github.com/jagreehal/autotel).
It emits the **canonical `gen_ai.*` semantic conventions** (OpenTelemetry semconv
**v1.42.0**) for everything from a single `chat` call to a multi-agent workflow —
token usage, cost, latency metrics, content/evaluation events, and an agent
identity / delegation / policy / audit governance layer.

Canonical-only by design: no legacy `gen.ai.*`, no `prompt_tokens` /
`completion_tokens`, no non-registry `total_tokens`. What you record is exactly
what backends (Grafana, Langfuse, Arize, Honeycomb, Jaeger, …) expect.

## Install

```bash
pnpm add autotel autotel-genai
```

`autotel` is the peer core (trace/span/init). `@opentelemetry/sdk-metrics` is an
optional peer, needed only for `genAiMetricViews()`.

## Quick start

```ts
import { traceGenAI, recordGenAiResponse, recordGenAiUsage } from 'autotel-genai/trace';
import OpenAI from 'openai';

const openai = new OpenAI();

// Span name → `chat gpt-4o`; request attributes set up front.
export const chat = traceGenAI({
  provider: 'openai',
  model: 'gpt-4o',
  operation: 'chat',
  temperature: 0.2,
})((ctx) => async (prompt: string) => {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
  });

  recordGenAiResponse(ctx, {
    model: res.model,
    id: res.id,
    finishReasons: res.choices.map((c) => c.finish_reason),
  });
  // Sets gen_ai.usage.input_tokens / output_tokens + gen_ai.usage.cost.usd
  recordGenAiUsage(ctx, 'gpt-4o', {
    inputTokens: res.usage?.prompt_tokens,
    outputTokens: res.usage?.completion_tokens,
  });

  return res.choices[0].message.content;
});
```

## What you get

| Area | Import | Highlights |
| --- | --- | --- |
| **Semconv** | `autotel-genai/semconv` | `GEN_AI.*` keys, `GEN_AI_OPERATION`, `GEN_AI_PROVIDER`, `genAiSpanName()` |
| **Cost** | `autotel-genai/cost` | `estimateLLMCost`, `recordLLMCost`, `MODEL_PRICING` (cache-read/write aware) |
| **Metrics** | `autotel-genai/metrics` | `genAiMetricViews()` re-buckets the canonical histograms |
| **Attributes** | `autotel-genai` | typed builders → canonical attribute maps |
| **Events** | `autotel-genai/events` | opt-in content + `inference.operation.details` / `evaluation.result` |
| **Trace** | `autotel-genai/trace` | `traceGenAI()`, `recordGenAiResponse/Usage` |
| **Guard** | `autotel-genai/guard` | inline cost/token/loop kill-switch — `createGenAiBudget`, `createGenAiGuard`, `parseGuardRules` |
| **Streaming** | `autotel-genai/streaming` | TTFC, throughput, inter-chunk distribution — `createStreamTimer`, `recordStreamTiming` |
| **AI SDK** | `autotel-genai/observer` | `autotelTelemetry()` — `registerTelemetry()` integration: live `gen_ai.*` spans + cost + streaming + nested traces + opt-in content. `subscribeAiTelemetry()` — zero-config `ai:telemetry` channel path |
| **AI SDK (legacy)** | `autotel-genai/ai-sdk` | `ai.*` → `gen_ai.*` mapping + cost for `LegacyOpenTelemetry`/older versions; `autotelEnrich()` for `@ai-sdk/otel` `enrichSpan` |
| **Agents** | `autotel-genai/agent` | identity, delegation, policy, audit, privacy, non-repudiation |

### Cost

```ts
import { estimateLLMCost, recordLLMCost } from 'autotel-genai/cost';

estimateLLMCost('gpt-4o', { inputTokens: 1000, outputTokens: 500 }); // 0.0075
recordLLMCost(ctx, 'claude-sonnet-4', {
  inputTokens: 4000,
  cacheReadInputTokens: 3500, // priced at the cached rate
});
```

### Metrics

```ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { genAiMetricViews } from 'autotel-genai/metrics';

const sdk = new NodeSDK({ serviceName: 'my-agent', views: [...genAiMetricViews()] });
```

Re-buckets `gen_ai.client.operation.duration`, `…time_to_first_chunk`,
`…time_per_output_chunk`, `gen_ai.client.token.usage`, and the autotel
`gen_ai.client.cost.usd` extension for LLM-shaped distributions.

### Guard / budget (kill-switch)

Most tracing tells you what an agent _did_, after the bill. A **guard** runs
_during_ the run: feed it each step, it accumulates cost / tokens / loop state,
and halts the run when a rule crosses its threshold — aborting an `AbortSignal`
and (by default) throwing a `GEN_AI_GUARD_STOP` structured error.

```ts
import { createGenAiBudget } from 'autotel-genai/guard';
import { estimateLLMCost } from 'autotel-genai/cost';

const budget = createGenAiBudget({ maxCostUsd: 5, warnAtUsd: 4 });

for (const task of tasks) {
  if (budget.stopped) break;
  const res = await model.chat(task);
  budget.record(
    { kind: 'llm', usage: { costUsd: estimateLLMCost('gpt-4o', res.usage) } },
    ctx, // optional TraceContext → records gen_ai.guard.* + gen_ai.session.* telemetry
  ); // throws once total cost > $5
}
```

Rules can also come from a shorthand string — cost ceilings, token ceilings,
spin-loop detection (`N identical calls in a window of M`), error loops,
tool-call / step caps, wall-clock timeouts, and context-window budgets:

```ts
import { createGenAiGuard, parseGuardRules } from 'autotel-genai/guard';

const guard = createGenAiGuard({
  rules: parseGuardRules('budget:$2,loop:3/10,max-tools:50,timeout:5m'),
});

guard.record({ kind: 'tool', name: 'search', signature: JSON.stringify(args) });
```

Each rule fires once; `onStop` chooses `throw` (default), `abort` (signal only),
or `silent` (record only). All logic is deterministic — no LLM in the loop.

### Streaming performance

Streaming latency is two numbers: **time to first chunk** (the wait before
anything appears) and **throughput** (how fast tokens then arrive). A single
duration hides both. `createStreamTimer` captures the full picture and records
the headline values as `gen_ai.response.*` attributes.

```ts
import { createStreamTimer, recordStreamTiming } from 'autotel-genai/streaming';

const timer = createStreamTimer();
let text = '';
for await (const chunk of stream) {
  timer.chunk(); // first call also marks time-to-first-chunk
  text += chunk;
}
recordStreamTiming(ctx, timer.finish({ outputTokens: countTokens(text) }));
// → gen_ai.response.time_to_first_chunk / .time_to_finish /
//   .output_tokens_per_second / .time_per_output_chunk (seconds)
```

`computeStreamTiming` is the pure function underneath (TTFC, total time, steady
throughput, and an inter-chunk gap distribution `{min,p10,median,avg,p90,max}`).

### Content capture & warnings

`setGenAiContent` now gates input/output independently and base64-encodes binary
(image/audio/file) parts instead of letting `JSON.stringify` corrupt them:

```ts
import { setGenAiContent, recordModelWarnings } from 'autotel-genai';

setGenAiContent(ctx, { inputMessages, outputMessages },
  { recordInputs: false, recordOutputs: true }); // keep prompts out of telemetry

recordModelWarnings(ctx, result.warnings); // surface provider warnings vendors only log
```

### Agents & tools

```ts
import { withScopedTool } from 'autotel-genai/agent';

await withScopedTool(
  {
    action: 'agent.refund.execute',
    agent: { id: 'refund-specialist' },
    tool: { name: 'stripe_refund_v3' },
    requiredScopes: ['refund:write'],
    delegation: { parentIdentity: 'usr_99824', scope: ['refund:write'] },
    policy: { decision: 'permit', policyId: 'refund-scope-v2' },
    ai: { model: 'gpt-4o', operation: 'execute_tool' },
  },
  { refundId: 're_123' },
  async () => stripe.refunds.create(req),
);
```

The agent layer records `agent.*`, `delegation.*`, `tool.*`, `policy.*`
governance attributes **and** canonical `gen_ai.*` when `ai` metadata is present.
It honours spec breaking change #242 (`gen_ai.agent.id` is dropped on internal
`invoke_agent` spans via `genAiAgentAttributes(…, { internal: true })`).

### Vercel AI SDK

Register `autotelTelemetry()` once and every `generateText` / `streamText` /
`embed` call streams a canonical `gen_ai.*` span tree — live, as it runs:

```ts
import { registerTelemetry } from 'ai';
import { autotelTelemetry } from 'autotel-genai/observer';

registerTelemetry(autotelTelemetry()); // once, at startup
```

See `apps/example-ai-sdk-observer` for a runnable AI SDK + Ollama demo
(generateText, tool loop, streamText timing, embeddings).

It implements the AI SDK's stable `Telemetry` lifecycle interface (ai v7+), so
it slots in exactly where `@ai-sdk/otel`'s `OpenTelemetry` does — but it also,
on every `chat` span:

- **prices the call** (`gen_ai.usage.cost.usd`) from `MODEL_PRICING`;
- records **streaming throughput** (`time_to_first_chunk`, `time_to_finish`,
  `output_tokens_per_second`);
- keeps token usage on leaf `chat` spans only, so the `invoke_agent` root never
  double-counts.

It is push-based and concurrency-safe (every event carries the SDK `callId`),
and it pulls in **no** dependency on `ai` — the returned object satisfies the
`Telemetry` interface structurally, so the snippet above type-checks as-is.
`rerank` has no canonical `gen_ai` operation and is intentionally not mapped.

**Nested traces.** It implements the SDK's `executeTool` / `executeLanguageModelCall`
context runners, so a tool whose `execute` calls `generateText` — and the
provider's own auto-instrumented HTTP spans — nest under the right span
automatically.

**Content capture (opt-in).** Off by default for privacy. Turn it on to record
prompts, responses, system instructions, and tool I/O, mapped to the
[GenAI SemConv message format](#genai-message-format). The SDK's per-call
`recordInputs` / `recordOutputs` are honored, and `exportContent` lets you redact
or drop content per event:

```ts
registerTelemetry(
  autotelTelemetry({
    captureContent: true,
    exportContent: (event) => redact(event), // optional: redact before write
  }),
);
```

**Zero-config (no `registerTelemetry`).** Subscribe to the SDK's `ai:telemetry`
Node tracing channel instead. The SDK publishes operation spans as soon as the
channel has a subscriber:

```ts
import { subscribeAiTelemetry } from 'autotel-genai/observer';

const unsubscribe = subscribeAiTelemetry(); // once, at startup
```

The channel path gives you the same `invoke_agent › chat › execute_tool` tree
with usage and cost, but not the per-call streaming timing (which only the
lifecycle `onLanguageModelCallEnd` event carries) — prefer
`registerTelemetry(autotelTelemetry())` when you can.

Register globally, or pass per-call via `telemetry.integrations` to scope it to
one call. For the **legacy** `LegacyOpenTelemetry`/older-version path, or to
enrich spans another integration already emitted, the attribute bridge maps
`ai.*` → `gen_ai.*` and adds cost; for versions before the `Telemetry` interface,
walk the finished result with `observeAiSdkResult` (see
[Observer](#observer-event-stream--spans)):

```ts
import { mapAiSdkAttributes, recordAiSdkCost } from 'autotel-genai/ai-sdk';

const canonical = mapAiSdkAttributes(span.attributes); // ai.* → gen_ai.*
recordAiSdkCost(ctx, span.attributes);                 // sets gen_ai.usage.cost.usd
```

#### Already using `@ai-sdk/otel`?

Drop `autotelEnrich()` into its `enrichSpan` to stamp autotel provenance and
promote your `runtimeContext` onto every span:

```ts
import { OpenTelemetry } from '@ai-sdk/otel';
import { autotelEnrich } from 'autotel-genai/ai-sdk';

registerTelemetry(new OpenTelemetry({ enrichSpan: autotelEnrich() }));
```

`enrichSpan` **cannot add cost** — the SDK passes it only
`{ spanType, operationId, callId, runtimeContext }` (no usage, no model), and its
own attributes win over custom keys. To get `gen_ai.usage.cost.usd` on the model
span, use `autotelTelemetry()` (it owns span creation). Either way,
[`autotel-devtools`](../autotel-devtools) prices `gen_ai` spans on render, so cost
shows there regardless of which integration emitted them.

#### Local devtools, one line

Point an OTLP exporter at a running `autotel-devtools` receiver and you get a
live GenAI run view — cost, token breakdown, tool timeline, and a narrated
"Explain run" walkthrough — that works in production too (unlike
`@ai-sdk/devtools`, which is dev-only):

```ts
import { registerTelemetry } from 'ai';
import { autotelTelemetry } from 'autotel-genai/observer';

registerTelemetry(autotelTelemetry()); // → your OTLP pipeline → autotel-devtools
// npx autotel-devtools  →  http://localhost:4318
```

### Observer (event-stream → spans)

When you instrument a framework that emits its own lifecycle stream (agent
runtimes, durable workflows) rather than wrapping calls with `traceGenAI`,
subscribe an observer and feed every event through it. It rebuilds the span
tree, estimates cost, and force-closes any child whose end never arrives:

```ts
import { createGenAiObserver } from 'autotel-genai/observer';

const observe = createGenAiObserver({
  // Content (messages, tool args/results) is omitted unless you opt in here.
  exportContent: (event) => redact(event),
});

observe({ type: 'agent.start', id: 'a1', agent: { name: 'planner' } });
observe({ type: 'chat.start', id: 'c1', parentId: 'a1',
          request: { provider: 'openai', model: 'gpt-4o' } });
observe({ type: 'chat.end', id: 'c1', response: { model: 'gpt-4o' },
          usage: { inputTokens: 412, outputTokens: 87 } });
observe({ type: 'agent.end', id: 'a1' }); // closes c1 too if it never ended
```

Token usage lands on leaf `chat` spans only — aggregate `agent`/`workflow`
spans never carry `gen_ai.usage.*`, so summing usage across a trace counts each
call exactly once.

**Framework glue** ships with the observer:

```ts
import {
  createGenAiObserver,
  createLangChainObserver, // LangChain / LangGraph callback handler
  observeAiSdkResult,      // Vercel AI SDK result walker
} from 'autotel-genai/observer';

const observe = createGenAiObserver();

// LangChain / LangGraph — one handler, runId/parentRunId → span tree:
await graph.invoke(input, { callbacks: [createLangChainObserver(observe)] });

// Vercel AI SDK — walk a generateText/streamText result:
observeAiSdkResult(observe, await generateText({ model, prompt }), {
  id: 'gen-1',
  provider: 'openai',
  model: 'gpt-4o',
});
```

See `apps/example-langchain-observer` for a runnable LangGraph + Ollama demo.

## Semantic conventions

Aligned to the `semantic-conventions-genai` snapshot. Span names follow the
operation-specific upstream rules: inference and embeddings use
`{operation} {request.model}`, retrieval uses `retrieval {data_source.id}`,
`execute_tool` uses `execute_tool {tool.name}`, agent spans use
`... {agent.name}` when available, workflow spans use
`invoke_workflow {workflow.name}`, and memory spans are just the bare
operation. Usage is `input_tokens` / `output_tokens` with `cache_read` /
`cache_creation` / `reasoning.output_tokens`; providers use the
`gen_ai.provider.name` enum.

## License

Apache-2.0 © Jag Reehal
