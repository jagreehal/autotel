---
'autotel': major
'autotel-cloudflare': minor
---

**BREAKING:** Move all GenAI / LLM instrumentation out of core `autotel` into the
dedicated **`autotel-genai`** package (published separately), which emits the
canonical OpenTelemetry GenAI semantic conventions (`gen_ai.*`, semconv v1.42.0).
Core `autotel` is now generic and AI-free.

Removed from `autotel`:

- `traceLLM` / `LLMConfig` (from `autotel` and `autotel/semantic-helpers`).
- `estimateLLMCost`, `recordLLMCost`, `MODEL_PRICING`, `GEN_AI_COST_ATTRIBUTE`,
  `ModelPricing`, `TokenUsage`, `EstimateCostOptions`.
- `genAiMetricViews`, `llmHistogramAdvice`, `GEN_AI_DURATION_BUCKETS_SECONDS`,
  `GEN_AI_TOKEN_USAGE_BUCKETS`, `GEN_AI_COST_USD_BUCKETS`.
- `recordPromptSent`, `recordResponseReceived`, `recordRetry`, `recordToolCall`,
  `recordStreamFirstToken` and their event types.
- The `genAI` attribute builder, `GenAIAttributes`, and the `GenAIAttrs` type
  (these used a non-spec `gen.ai.*` namespace and are not carried over).

`traceDB`, `traceHTTP`, and `traceMessaging` remain in core.

**Migration:** install `autotel-genai` and update imports — attribute names are
now canonical (`gen_ai.*`, `input_tokens`/`output_tokens`, `gen_ai.provider.name`):

```diff
- import { traceLLM, recordLLMCost, genAiMetricViews } from 'autotel';
+ import { traceGenAI } from 'autotel-genai/trace';
+ import { recordLLMCost } from 'autotel-genai/cost';
+ import { genAiMetricViews } from 'autotel-genai/metrics';
```

Agent identity/delegation/policy/audit helpers (formerly the `autotel-agent`
package) now live in `autotel-genai/agent`.

**`autotel-cloudflare`:** the Workers AI binding now emits the canonical
`gen_ai.provider.name` (`cloudflare-workers-ai`) instead of the deprecated
`gen_ai.system`.
