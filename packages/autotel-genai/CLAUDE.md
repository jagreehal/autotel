# autotel-genai

Gold-standard OpenTelemetry **GenAI** instrumentation for LLM calls, tools, and
agents. Canonical `gen_ai.*` semantic conventions aligned to the
`semantic-conventions-genai` snapshot, canonical-only — there is **no** legacy
`gen.ai.*` / `prompt_tokens` surface.

## Your Role

You own the GenAI observability layer that sits on top of core `autotel`. You
understand the OpenTelemetry GenAI semantic conventions and keep this package
exactly aligned with them.

## What lives here

- `src/semconv.ts` — **source of truth**: `gen_ai.*` keys (`GEN_AI`), event
  names (`GEN_AI_EVENT`), operation names (`GEN_AI_OPERATION`), provider enum
  (`GEN_AI_PROVIDER`), token/output/tool types, metric names, and
  `genAiSpanName()` (joins the operation with the already-selected canonical
  identifier).
- `src/cost.ts` — `MODEL_PRICING`, `estimateLLMCost`, `recordLLMCost`.
- `src/metrics.ts` — histogram buckets + `genAiMetricViews()`.
- `src/attributes.ts` — typed builders → canonical attribute maps.
- `src/events.ts` — opt-in content attrs + `inference.operation.details` /
  `evaluation.result` events (via `ctx.track`).
- `src/trace.ts` — `traceGenAI()` wrapper + `recordGenAiResponse/Usage`.
- `src/ai-sdk-bridge.ts` — Vercel AI SDK interop (`ai.*` → `gen_ai.*`, cost).
- `src/agent/` — agent identity / delegation / policy / audit governance
  (absorbed from the former `autotel-agent` package).

## Invariants

- **Canonical names only.** Every attribute key must come from `GEN_AI.*` in
  `semconv.ts`. No string literals for `gen_ai.*` elsewhere; no `total_tokens`
  (not in the v1.42.0 registry); usage is `input_tokens` / `output_tokens`.
- **Spec fidelity.** Match the snapshot at `/Users/jreehal/dev/temp/semantic-conventions-genai`.
  `gen_ai.request.top_k` and `gen_ai.retrieval.top_k` are ints. Honor breaking
  change #242: drop `gen_ai.agent.id` on *internal* `invoke_agent` spans
  (`genAiAgentAttributes(…, { internal: true })`). Include `server.address` /
  `server.port` and the `gen_ai.client.operation.exception` event surface.
- **Tree-shaking.** Keep subpath exports (`./cost`, `./metrics`, …) and explicit
  named exports in `index.ts`. No barrel `export *`.
- **Core stays generic.** AI/LLM/GenAI code lives here, never back in `autotel`.

## Commands

```bash
pnpm --filter autotel-genai build
pnpm --filter autotel-genai test
pnpm --filter autotel-genai type-check
pnpm --filter autotel-genai lint
```

## Boundaries

- ✅ Always: add new `gen_ai.*` keys to `semconv.ts` first; keep builders pure;
  re-use core `trace()` / `TraceContext`.
- ⚠️ Ask first: changing the cost model, adding dependencies, new subpath exports.
- 🚫 Never: reintroduce legacy `gen.ai.*` names, emit non-registry attributes
  without marking them an autotel extension, break tree-shaking.
