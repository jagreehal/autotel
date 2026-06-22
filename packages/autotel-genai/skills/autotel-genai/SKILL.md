---
name: autotel-genai
description: >
  Use this skill when instrumenting AI/LLM/agent code with OpenTelemetry GenAI semantic conventions — traceGenAI() spans, token usage and cost, gen_ai.* attributes, GenAI metric views, content/evaluation events, the Vercel AI SDK bridge, or the agent identity/delegation/policy/audit governance layer. This is the canonical home for everything GenAI in autotel (the core `autotel` package is AI-free).
---

# autotel-genai

Gold-standard OpenTelemetry **GenAI** instrumentation: canonical `gen_ai.*`
semantic conventions (semconv **v1.42.0**) for LLM calls, tools, and agents.
Canonical-only — there is no legacy `gen.ai.*`, `prompt_tokens`/`completion_tokens`,
or non-registry `total_tokens` surface.

Core `autotel` provides `trace()`/`span()`/`init()`. `autotel-genai` adds the AI
layer on top.

## Setup

```bash
npm install autotel autotel-genai
# autotel is a peer; @opentelemetry/sdk-metrics is an optional peer (for metric views)
```

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { genAiMetricViews } from 'autotel-genai/metrics';

// Re-bucket the GenAI histograms (duration, time-to-first-chunk, token usage, cost)
const sdk = new NodeSDK({ serviceName: 'my-agent', views: [...genAiMetricViews()] });
sdk.start();
```

## Core Patterns

### Trace an LLM call — `traceGenAI`

Names the span per spec (`{operation} {model}` → `chat gpt-4o`) and sets the
request attributes up front. Record the response + usage when the call returns.

```typescript
import { traceGenAI, recordGenAiResponse, recordGenAiUsage } from 'autotel-genai/trace';

export const chat = traceGenAI({
  provider: 'openai',          // gen_ai.provider.name
  model: 'gpt-4o',             // gen_ai.request.model + span name
  operation: 'chat',           // gen_ai.operation.name
  temperature: 0.2,
})((ctx) => async (prompt: string) => {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
  });

  recordGenAiResponse(ctx, {
    model: res.model,
    id: res.id,
    finishReasons: res.choices.map((c) => c.finish_reason), // gen_ai.response.finish_reasons
  });
  // gen_ai.usage.input_tokens / output_tokens + estimated gen_ai.usage.cost.usd
  recordGenAiUsage(ctx, 'gpt-4o', {
    inputTokens: res.usage?.prompt_tokens,
    outputTokens: res.usage?.completion_tokens,
    cacheReadInputTokens: res.usage?.prompt_tokens_details?.cached_tokens,
  });

  return res.choices[0].message.content;
});
```

`operation` drives both the span name's trailing identifier and which metadata
matters: `retrieval` → `data_source.id`; `execute_tool` → `tool.name`;
`create_agent`/`invoke_agent`/`plan` → `agent.name`; `invoke_workflow` →
`workflow.name`; memory ops → bare operation name. Pass `agent`/`tool`/`workflow`
config to set the matching `gen_ai.*` attributes and name the span.

### Cost

```typescript
import { estimateLLMCost, recordLLMCost } from 'autotel-genai/cost';

estimateLLMCost('gpt-4o', { inputTokens: 1000, outputTokens: 500 }); // 0.0075
// recordLLMCost sets ONLY gen_ai.usage.cost.usd (use when tokens are already on the span)
recordLLMCost(ctx, 'claude-sonnet-4', { inputTokens: 4000, cacheReadInputTokens: 3500 });
```

Override/extend pricing per call with `{ pricing: { 'my-model': { inputPer1M, outputPer1M } } }`.

### Typed attribute builders

When you control the span directly, build canonical maps and merge them:

```typescript
import { genAiRequestAttributes, genAiUsageAttributes } from 'autotel-genai';

ctx.setAttributes({
  ...genAiRequestAttributes({ operation: 'chat', provider: 'openai', model: 'gpt-4o', topK: 40 }),
  ...genAiUsageAttributes({ inputTokens: 412, outputTokens: 87 }),
});
```

Builders omit absent fields, coerce int-typed attributes (`top_k`, `seed`,
`choice.count`), and JSON-serialise structured attributes (`tool.call.arguments`,
`memory.records`). Also: `genAiResponseAttributes`, `genAiAgentAttributes`,
`genAiToolAttributes`, `genAiRetrievalAttributes`, `genAiMemoryAttributes`,
`genAiWorkflowAttributes`.

### Content + evaluation events

```typescript
import {
  setGenAiContent,
  recordInferenceDetails,
  recordEvaluationResult,
  recordModelWarnings,
} from 'autotel-genai/events';

// Opt-in content on the span. Gate input/output independently; binary parts
// (image/audio/file) are base64-encoded, not corrupted by JSON.stringify.
setGenAiContent(ctx, { inputMessages, outputMessages }, { recordInputs: false });
// gen_ai.client.inference.operation.details event (decoupled from the span)
recordInferenceDetails(ctx, { operation: 'chat', requestModel: 'gpt-4o', inputTokens: 412 });
// gen_ai.evaluation.result event
recordEvaluationResult(ctx, { name: 'relevance', scoreValue: 0.92 });
// gen_ai.client.warnings event — surface provider warnings vendors only log
recordModelWarnings(ctx, [{ type: 'unsupported-setting', setting: 'topK' }]);
```

### Streaming performance — `autotel-genai/streaming`

Streaming latency is two numbers: **time to first chunk** (the wait) and
**throughput** (how fast tokens then arrive). `createStreamTimer` captures both.

```typescript
import { createStreamTimer, recordStreamTiming } from 'autotel-genai/streaming';

const timer = createStreamTimer();
let text = '';
for await (const chunk of stream) {
  timer.chunk(); // first call also marks time-to-first-chunk
  text += chunk;
}
// gen_ai.response.time_to_first_chunk (spec) + .time_to_finish /
// .output_tokens_per_second / .time_per_output_chunk (autotel extensions, seconds)
recordStreamTiming(ctx, timer.finish({ outputTokens }));
```

`computeStreamTiming(...)` is the pure function underneath; it also returns the
inter-chunk gap distribution `{ min, p10, median, avg, p90, max }`.

### Budgets & guardrails — `autotel-genai/guard`

An inline kill-switch that runs _during_ a run. Feed it each step; it accumulates
cost / tokens / loop state and halts when a rule crosses its threshold — aborting
an `AbortSignal` and (by default) throwing a `GEN_AI_GUARD_STOP` structured
error. Deterministic, no LLM in the loop.

```typescript
import { createGenAiBudget, createGenAiGuard, parseGuardRules } from 'autotel-genai/guard';

// Preset: cost / token / tool-call / duration ceilings
const budget = createGenAiBudget({ maxCostUsd: 5, warnAtUsd: 4 });
budget.record({ kind: 'llm', usage: { costUsd } }, ctx); // throws once cost > $5

// Or build rules from a shorthand string (or typed factories)
const guard = createGenAiGuard({
  rules: parseGuardRules('budget:$2,loop:3/10,max-tools:50,timeout:5m'),
  onStop: 'abort', // 'throw' (default) | 'abort' (signal only) | 'silent'
});
guard.record({ kind: 'tool', name: 'search', signature: JSON.stringify(args) });
```

Rule factories: `costCeiling`, `tokenCeiling`, `maxToolCalls`, `maxSteps`,
`maxDuration`, `spinLoop`, `errorLoop`, `contextBudget`. Each fires once. Records
`gen_ai.guard.*` events + `gen_ai.session.*` accumulators when given a `ctx`.

### Vercel AI SDK bridge

The primary AI SDK path is `autotelTelemetry()` from `autotel-genai/observer`.
Register it once and every `generateText` / `streamText` / `embed` call emits a
live canonical `gen_ai.*` span tree with cost, streaming timing, nested tool
execution, and nested provider HTTP spans:

```typescript
import { registerTelemetry } from 'ai';
import { autotelTelemetry, subscribeAiTelemetry } from 'autotel-genai/observer';

registerTelemetry(autotelTelemetry());

const unsubscribe = subscribeAiTelemetry(); // fallback: zero-config ai:telemetry channel
```

Use `subscribeAiTelemetry()` when you cannot add a registration call. It emits
the same `invoke_agent > chat > execute_tool` tree with usage and cost, but not
the per-call streaming timing that only the lifecycle integration sees.

For `LegacyOpenTelemetry`/older versions, or to enrich spans another
integration already emitted, use the legacy bridge:

```typescript
import { autotelEnrich, mapAiSdkAttributes, recordAiSdkCost } from 'autotel-genai/ai-sdk';

const canonical = mapAiSdkAttributes(span.attributes); // ai.* → gen_ai.*
recordAiSdkCost(ctx, span.attributes);                 // sets gen_ai.usage.cost.usd
```

`autotelEnrich()` is for `@ai-sdk/otel`'s `enrichSpan` hook when you want
autotel provenance and `runtimeContext` fields on spans, but it cannot add
cost because the hook gets no usage/model payload.

### Agent governance — `autotel-genai/agent`

Identity, delegation, policy, and audit for agentic workflows (the former
`autotel-agent` package). Records `agent.*`/`delegation.*`/`tool.*`/`policy.*`
governance attributes plus canonical `gen_ai.*` when `ai` metadata is present.

```typescript
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

## Canonical attribute reference (don't deviate)

- Provider: `gen_ai.provider.name` — **not** the deprecated `gen_ai.system`.
- Tokens: `gen_ai.usage.input_tokens` / `output_tokens` / `reasoning.output_tokens`
  / `cache_read.input_tokens` / `cache_creation.input_tokens` — **never**
  `prompt_tokens` / `completion_tokens` / `total_tokens`.
- Finish reasons: `gen_ai.response.finish_reasons` (plural, string array).
- Cost (autotel extension): `gen_ai.usage.cost.usd`.
- Other autotel extensions (clearly non-spec, namespaced under `gen_ai.*`):
  `gen_ai.guard.*` + `gen_ai.session.*` (guard), `gen_ai.response.time_to_finish`
  / `output_tokens_per_second` / `time_per_output_chunk` (streaming),
  `gen_ai.client.warnings` (event). `gen_ai.response.time_to_first_chunk` is spec.
- `gen_ai.request.top_k` is an int; `gen_ai.agent.id` is dropped on internal
  `invoke_agent`/`plan` spans (spec breaking change #242 — `traceGenAI` handles
  this automatically).

The `GEN_AI` / `GEN_AI_OPERATION` / `GEN_AI_PROVIDER` constants in
`autotel-genai/semconv` are the source of truth — use them instead of string
literals.

## Boundaries

- ✅ Always: canonical `gen_ai.*` names from `autotel-genai/semconv`; reuse core
  `trace()` / `TraceContext`; pass `genAiMetricViews()` to your MeterProvider.
- 🚫 Never: legacy `gen.ai.*`, `prompt_tokens`/`completion_tokens`/`total_tokens`,
  `gen_ai.system`, `gen_ai.cost.usd`; never add GenAI code back to core `autotel`.
