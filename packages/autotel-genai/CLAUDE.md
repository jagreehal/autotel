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
- `src/events.ts` — opt-in content attrs (with `recordInputs`/`recordOutputs`
  gating + base64-safe binary serialisation) + `inference.operation.details` /
  `evaluation.result` / `client.warnings` events (via `ctx.track`).
- `src/streaming.ts` — streaming-performance helpers (`createStreamTimer`,
  `computeStreamTiming`, `recordStreamTiming`): TTFC, throughput, inter-chunk
  distribution. `time_to_first_chunk` is spec; `time_to_finish` /
  `output_tokens_per_second` / `time_per_output_chunk` are autotel extensions.
- `src/trace.ts` — `traceGenAI()` wrapper + `recordGenAiResponse/Usage`.
- `src/guard.ts` — inline cost/token/loop **kill-switch** runtime
  (`createGenAiGuard`, `createGenAiBudget`, `parseGuardRules`, rule factories).
  Pure, deterministic, no LLM. `stop` rules abort an `AbortSignal` and throw a
  `GEN_AI_GUARD_STOP` structured error; emits `gen_ai.guard.*` events +
  `gen_ai.session.*` accumulators (all marked autotel extensions in semconv.ts).
- `src/ai-sdk-bridge.ts` — Vercel AI SDK interop (`ai.*` → `gen_ai.*`, cost).
- `src/observer/` — `createGenAiObserver()`: an event-stream → `gen_ai.*` span
  adapter (subpath `autotel-genai/observer`). Complements `traceGenAI` for
  frameworks that emit their own lifecycle stream. Reconstructs the span tree
  from flat `*.start`/`*.end` events, force-closes abandoned children, gates
  sensitive content behind an `exportContent` privacy callback, and keeps token
  usage on leaf `chat` spans only so aggregate `agent`/`workflow` spans never
  double-count `gen_ai.usage.*`. Ships framework glue: `createLangChainObserver`
  (LangChain/LangGraph callback handler), `observeAiSdkResult` (Vercel AI SDK
  result walker, pull-based), and `autotelTelemetry` (Vercel AI SDK `Telemetry`
  integration for `registerTelemetry()`, push-based / live) — all dependency-free
  / structurally typed. `autotelTelemetry()` is the keystone AI SDK path: it
  anchors the `chat` span on `onLanguageModelCallStart/End` (both carry `callId`,
  so it is concurrency-safe), tools become siblings under the `invoke_agent`
  root, and it adds cost + streaming timing the built-in `@ai-sdk/otel` omits.
  It also implements the `executeTool`/`executeLanguageModelCall` context runners
  (nested traces — needs an ambient OTel ContextManager, which real Node apps
  have) and opt-in content capture (`captureContent`, off by default; maps AI SDK
  messages → GenAI SemConv format via `ai-sdk-messages.ts`). `subscribeAiTelemetry`
  (`ai-sdk-channel.ts`) is the zero-config path: it subscribes to the `ai:telemetry`
  Node tracing channel (loaded edge-safely via `process.getBuiltinModule`, no
  static `node:` import), pairs `start`↔`asyncEnd` by message-object identity, and
  emits the same tree with usage+cost but no streaming timing. `autotelEnrich`
  (in `ai-sdk-bridge.ts`) is an `@ai-sdk/otel` `enrichSpan` helper — provenance +
  runtimeContext mapping only; it **cannot** add cost (the SDK gives `enrichSpan`
  no usage/model and its own attrs win). `rerank` is intentionally unmapped
  (no canonical `gen_ai` operation in v1.42.0). When changing any of these, keep
  them assignable to the real `ai` `Telemetry` interface (compile-check against
  `/Users/jreehal/dev/ai/ai/packages/ai/dist`).
- `src/agent/` — agent identity / delegation / policy / audit governance
  (absorbed from the former `autotel-agent` package). Includes Google SAIF-aligned
  security attrs (`AGENT_SECURITY_ATTR`, `recordHumanApproval`, `recordInputProvenance`,
  plan/memory/render helpers) and pluggable plan-risk classifiers
  (`AgentPlanClassifier`, `runAgentPlanClassifier`, `heuristicPlanRiskClassifier`).
  See [`docs/AGENT-SECURITY-OBSERVABILITY.md`](../../docs/AGENT-SECURITY-OBSERVABILITY.md).

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
