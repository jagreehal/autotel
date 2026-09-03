# autotel-genai

> Gold-standard OpenTelemetry **GenAI** instrumentation for LLM calls, tools, and agents.

`autotel-genai` is the AI layer for [autotel](https://github.com/jagreehal/autotel).
It emits the **canonical `gen_ai.*` semantic conventions** (OpenTelemetry semconv
**v1.42.0**) for everything from a single `chat` call to a multi-agent workflow.
Token usage, cost, latency metrics, content/evaluation events, and an agent
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
import {
  traceGenAI,
  recordGenAiResponse,
  recordGenAiUsage,
} from 'autotel-genai/trace';
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

| Area                | Import                    | Highlights                                                                                                                                                                                            |
| ------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Semconv**         | `autotel-genai/semconv`   | `GEN_AI.*` keys, `GEN_AI_OPERATION`, `GEN_AI_PROVIDER`, `genAiSpanName()`                                                                                                                             |
| **Cost**            | `autotel-genai/cost`      | `estimateLLMCost`, `recordLLMCost`, `MODEL_PRICING` (cache-read/write aware)                                                                                                                          |
| **Metrics**         | `autotel-genai/metrics`   | `genAiMetricViews()` re-buckets the canonical histograms                                                                                                                                              |
| **Attributes**      | `autotel-genai`           | typed builders → canonical attribute maps                                                                                                                                                             |
| **Events**          | `autotel-genai/events`    | opt-in content (binary redacted, size-capped) + `inference.operation.details` / `evaluation.result`                                                                                                   |
| **Trace**           | `autotel-genai/trace`     | `traceGenAI()`, `recordGenAiResponse/Usage`                                                                                                                                                           |
| **Guard**           | `autotel-genai/guard`     | inline cost/token/loop kill-switch: `createGenAiBudget`, `createGenAiGuard`, `parseGuardRules`                                                                                                        |
| **Streaming**       | `autotel-genai/streaming` | TTFC, throughput, inter-chunk distribution: `createStreamTimer`, `recordStreamTiming`                                                                                                                 |
| **AI SDK**          | `autotel-genai/observer`  | `autotelTelemetry()`: `registerTelemetry()` integration: live `gen_ai.*` spans + cost + streaming + nested traces + opt-in content. `subscribeAiTelemetry()`: zero-config `ai:telemetry` channel path |
| **AI SDK (legacy)** | `autotel-genai/ai-sdk`    | `ai.*` → `gen_ai.*` mapping + cost for `LegacyOpenTelemetry`/older versions; `autotelEnrich()` for `@ai-sdk/otel` `enrichSpan`                                                                        |
| **Agents**          | `autotel-genai/agent`     | identity, delegation, policy, audit, privacy, non-repudiation                                                                                                                                         |

### Cost

```ts
import { estimateLLMCost, recordLLMCost } from 'autotel-genai/cost';

estimateLLMCost('gpt-4o', { inputTokens: 1000, outputTokens: 500 }); // 0.0075
recordLLMCost(ctx, 'claude-sonnet-4', {
  inputTokens: 4000,
  cacheReadInputTokens: 3500, // priced at the cached rate
});
```

**Server-side tools are money too.** Web search, code interpreter and file
search are billed per call, outside the token counts. An agent that searches on
every step can spend more there than on tokens, and a cost built from tokens
alone will never show it:

```ts
recordLLMCost(ctx, 'claude-sonnet-4', {
  inputTokens: 4000,
  serverToolCalls: { web_search: 12 }, // SERVER_TOOL_PRICING_PER_1K
});
```

A tool with no price is left out of the figure rather than guessed at zero, and
named on the span as `gen_ai.usage.cost.unpriced_tools` so the gap is visible.

**Cache accounting.** By default cache reads are treated as a subset of
`inputTokens` (what OpenAI and Anthropic report directly) and cache writes as
additive. Gateways and normalised usage objects do not all agree; where yours
reports cache tokens separately, say so — getting it backwards subtracts a pool
that was never in the input, understating exactly the calls that cost most:

```ts
recordLLMCost(ctx, model, { ...usage, cacheTokensExclusive: true });
```

**Where the numbers came from.** `tokenSource: 'observed' | 'estimated'` labels
the counts as `autotel.evidence.tokens`. A locally counted token and a
provider-reported one are the same number on a span; unlabelled, a guess reads
as an invoice.

### Metrics

```ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { genAiMetricViews } from 'autotel-genai/metrics';

const sdk = new NodeSDK({
  serviceName: 'my-agent',
  views: [...genAiMetricViews()],
});
```

Re-buckets `gen_ai.client.operation.duration`, `…time_to_first_chunk`,
`…time_per_output_chunk`, `gen_ai.client.token.usage`, and the autotel
`gen_ai.client.cost.usd` extension for LLM-shaped distributions.

### Guard / budget (kill-switch)

Most tracing tells you what an agent _did_, after the bill. A **guard** runs
_during_ the run: feed it each step, it accumulates cost / tokens / loop state,
and halts the run when a rule crosses its threshold. Aborting an `AbortSignal`
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

Rules can also come from a shorthand string. Cost ceilings, token ceilings,
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
or `silent` (record only). All logic is deterministic. No LLM in the loop.

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

`setGenAiContent` gates input and output independently, replaces inline binary
with a placeholder, and caps what is left:

```ts
import { setGenAiContent, recordModelWarnings } from 'autotel-genai';

setGenAiContent(
  ctx,
  { inputMessages, outputMessages },
  { recordInputs: false, recordOutputs: true },
); // keep prompts out of telemetry

recordModelWarnings(ctx, result.warnings); // surface provider warnings vendors only log
```

**Binary is redacted, not recorded.** A multimodal prompt carries its images,
audio and PDFs inline as base64. Serialised verbatim, one such call is a
megabyte-scale span attribute that collectors truncate mid-string and nobody
reads. The bytes were never the interesting part, so they are replaced by a
placeholder that says what stood there:

```jsonc
// gen_ai.input.messages
[
  {
    "role": "user",
    "parts": [
      { "type": "text", "content": "what is in this photo?" },
      { "type": "input_image", "data": "[base64 image/png redacted]" },
    ],
  },
]
```

Recognition is contextual: a bare alphanumeric string must be 1KB before it is
suspected, but under a key that means binary (`data`, `image_url`,
`inline_data`) or beside a `mediaType` / `format` hint, 64 bytes is enough. An
explicit `text/*` media type settles it the other way and nothing is touched.

Whatever survives is capped at `DEFAULT_MAX_CONTENT_BYTES` (200KB) per
attribute. Both are declared rather than silent — a cut attribute gains
`<attribute>.original_size` and the span is labelled `autotel.evidence.input =
'truncated'` (or `'redacted'`), so a reader can tell a short prompt from a
prompt you only kept the front of.

```ts
setGenAiContent(ctx, content, {
  redactBinary: false, // only when the payload itself is under investigation
  maxContentBytes: 0, // 0 or less: no cap
});
```

`redactBinaryContent()` and `truncateUtf8()` are exported for payloads that
never reach a span — an event body, a log line, your own exporter.

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

**Eval-sandbox incident replay.** When multiple eval agents share a writable
registry (the OpenAI/HuggingFace pattern), use the agent IR helpers below.
See the standalone demo at `agent-eval-sandbox-demo` (sibling to ai-sdk-guardrails).

```ts
import {
  CrossAgentMonitor,
  createHoneyTokenTool,
  crossAgentDetectionsToSecurityEvents,
  detectCrossAgentPattern,
  EVAL_IDENTITY_ATTR,
  querySpansForEvalIncident,
  recordEvalRunIdentity,
} from 'autotel-genai/agent';

// Tag every run so its spans stay separable downstream
// (eval.run_id / eval.task_id / eval.sandbox_id).
recordEvalRunIdentity({ runId, taskId, sandboxId });

// Live: emit agent.shared_channel.detected as tools run
const monitor = new CrossAgentMonitor({ minAgents: 2, ctx });
monitor.record({ agentId: 'eval-a', resource: 'artifactory:/notes' });

// Offline: the same detection over events you collected yourself
const alerts = crossAgentDetectionsToSecurityEvents(
  detectCrossAgentPattern(collectedEvents, { minAgents: 2 }),
);

// Batch IR over an exported span array
const ir = querySpansForEvalIncident(finishedSpans);
ir.crossAgentEvents; // shared-channel alerts
ir.evalRuns; // every EVAL_IDENTITY_ATTR.runId seen

// Honey-token tool: a decoy credential that reports when an agent touches it
const honeyToken = createHoneyTokenTool({
  name: 'readLeakedCredential',
  bait: 'AKIA_HONEY_TOKEN_DO_NOT_USE',
  ctx,
});
```

### Vercel AI SDK

Register `autotelTelemetry()` once and every `generateText` / `streamText` /
`generateObject` / `streamObject` / `embed` call streams a canonical `gen_ai.*`
span tree. Live, as it runs:

```ts
import { registerTelemetry } from 'ai';
import { autotelTelemetry } from 'autotel-genai/observer';

registerTelemetry(autotelTelemetry()); // once, at startup
```

See `apps/example-ai-sdk-observer` for a runnable AI SDK + Ollama demo
(generateText, tool loop, streamText timing, embeddings).

It implements the AI SDK's stable `Telemetry` lifecycle interface (ai v7+), so
it slots in exactly where `@ai-sdk/otel`'s `OpenTelemetry` does. But it also,
on every `chat` span:

- **prices the call** (`gen_ai.usage.cost.usd`) from `MODEL_PRICING`;
- records **streaming throughput** (`time_to_first_chunk`, `time_to_finish`,
  `output_tokens_per_second`);
- keeps token usage on leaf `chat` spans only, so the `invoke_agent` root never
  double-counts.

It is push-based and concurrency-safe (every event carries the SDK `callId`),
and it pulls in **no** dependency on `ai`. The returned object satisfies the
`Telemetry` interface structurally, so the snippet above type-checks as-is —
including under `exactOptionalPropertyTypes: true`.
Embeddings open on `onEmbedStart` so span duration is the real model call.
`rerank` has no canonical `gen_ai` operation and is intentionally not mapped.

**`ToolLoopAgent`.** Agents run the same lifecycle, but their telemetry settings
live on the **constructor**, not on `.generate()`. Passing `telemetry` to
`.generate()` is a type error, and spreading it in type-checks while doing
nothing:

```ts
const agent = new ToolLoopAgent({
  model,
  id: 'support-agent',
  telemetry: { functionId: 'support-agent' }, // names the invoke_agent span
});
```

**Sessions need opting in.** `runtimeContext.userId` / `sessionId` become
`user.id` / `gen_ai.conversation.id` and other keys are dropped — but the SDK
withholds `runtimeContext` from telemetry entirely unless the call names each
key. Without this there is no conversation id on the spans at all:

```ts
telemetry: {
  functionId: 'support-agent',
  includeRuntimeContext: { sessionId: true },
}
```

**Nested traces.** It implements the SDK's `executeTool` / `executeLanguageModelCall`
context runners, so a tool whose `execute` calls `generateText`. And the
provider's own auto-instrumented HTTP spans. Nest under the right span
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
lifecycle `onLanguageModelCallEnd` event carries). Prefer
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
recordAiSdkCost(ctx, span.attributes); // sets gen_ai.usage.cost.usd
```

#### Already using `@ai-sdk/otel`?

Drop `autotelEnrich()` into its `enrichSpan` to stamp autotel provenance and
promote your `runtimeContext` onto every span:

```ts
import { OpenTelemetry } from '@ai-sdk/otel';
import { autotelEnrich } from 'autotel-genai/ai-sdk';

registerTelemetry(new OpenTelemetry({ enrichSpan: autotelEnrich() }));
```

`enrichSpan` **cannot add cost**. The SDK passes it only
`{ spanType, operationId, callId, runtimeContext }` (no usage, no model), and its
own attributes win over custom keys. To get `gen_ai.usage.cost.usd` on the model
span, use `autotelTelemetry()` (it owns span creation). Either way,
[`autotel-devtools`](../autotel-devtools) prices `gen_ai` spans on render, so cost
shows there regardless of which integration emitted them.

#### Local devtools, one line

Point an OTLP exporter at a running `autotel-devtools` receiver and you get a
live GenAI run view. Cost, token breakdown, tool timeline, and a narrated
"Explain run" walkthrough. That works in production too (unlike
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
observe({
  type: 'chat.start',
  id: 'c1',
  parentId: 'a1',
  request: { provider: 'openai', model: 'gpt-4o' },
});
observe({
  type: 'chat.end',
  id: 'c1',
  response: { model: 'gpt-4o' },
  usage: { inputTokens: 412, outputTokens: 87 },
});
observe({ type: 'agent.end', id: 'a1' }); // closes c1 too if it never ended
```

Token usage lands on leaf `chat` spans only. Aggregate `agent`/`workflow`
spans never carry `gen_ai.usage.*`, so summing usage across a trace counts each
call exactly once.

**Framework glue** ships with the observer:

```ts
import {
  createGenAiObserver,
  createLangChainObserver, // LangChain / LangGraph callback handler
  createMastraObserver, // Mastra ObservabilityExporter
  observeAiSdkResult, // Vercel AI SDK result walker
} from 'autotel-genai/observer';

const observe = createGenAiObserver();

// LangChain / LangGraph — one handler, runId/parentRunId → span tree:
await graph.invoke(input, { callbacks: [createLangChainObserver(observe)] });

// Mastra — one exporter on the observability pipeline:
new Mastra({
  agents,
  observability: new Observability({
    configs: {
      autotel: {
        serviceName: 'support-agent',
        exporters: [createMastraObserver(observe)],
      },
    },
  }),
});

// Vercel AI SDK — walk a generateText/streamText result:
observeAiSdkResult(observe, await generateText({ model, prompt }), {
  id: 'gen-1',
  provider: 'openai',
  model: 'gpt-4o',
});
```

See `apps/example-langchain-observer` for a runnable LangGraph + Ollama demo.

Mastra maps `agent_run` → `invoke_agent`, `model_generation` → `chat`,
`rag_embedding` → `embeddings`, every tool-call type → `execute_tool`, and
`workflow_run`/`workflow_step` → `invoke_workflow`. Plumbing (model steps and
chunks, processors, scorers, mappings) is dropped and its children reparent to
the nearest kept ancestor. Pass `skipSpan` to drop additional supported span
types; unsupported plumbing always stays dropped. `model_step` /
`model_inference` are dropped deliberately: their usage is already summed on the
enclosing `model_generation`, so keeping both would double-count
`gen_ai.usage.*`.

`@mastra/otel-exporter` also emits canonical `gen_ai.*`. Prefer this adapter
when you want Mastra's spans to be _autotel's_ spans — Mastra dispatches events
synchronously, so they nest under the request span you already opened, reach
every `init()` destination, pass through your `spanEnrichers` (including
`langfuseCompatibility`), and get priced.

### Prompt versions

`gen_ai.prompt.name` alone cannot tell you which edit moved the numbers. Stamp
the version too, and cost, latency and evaluation score become splittable by
prompt change in whatever backend holds the spans:

```ts
traceGenAI({
  provider: 'openai',
  model: 'gpt-4o',
  workflow: {
    promptName: 'initial-router',
    promptVersion: 7, // or your registry's own id
    promptLabel: 'production',
    promptHash: 'sha256:…', // when there is no registry to version it
  },
});
```

### Grouping traces into sessions

A conversation is more than one trace. Two canonical attributes already carry
that, and neither is GenAI-specific:

- `gen_ai.conversation.id` — the thread this call belongs to.
- `session.id` — the visit it happened in, set by autotel core's `setSession()`
  or stamped on every browser span by `autotel-web`.

Set them and total cost per session, traces per conversation, and
session-level latency are ordinary queries. This is the same hierarchy vendor
LLM-analytics products sell as `$ai_session_id`; here it is spec, so it works
wherever the spans land.

### Sending the same spans to PostHog

PostHog ingests plain OTLP: `PostHogSpanProcessor` from `@posthog/ai/otel`
forwards any span carrying `gen_ai.*` attributes and assembles its `$ai_*`
event server-side. Because this package emits canonical names, no mapping layer
is needed — add the processor and the spans you already have become LLM
analytics:

```ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PostHogSpanProcessor } from '@posthog/ai/otel';

const sdk = new NodeSDK({
  spanProcessors: [new PostHogSpanProcessor({ projectToken: 'phc_…' })],
});
```

`src/posthog-contract.test.ts` pins that agreement, so it cannot quietly stop
being true. For the browser half — session, replay and person joined in both
directions — see `autotel-posthog`.

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
