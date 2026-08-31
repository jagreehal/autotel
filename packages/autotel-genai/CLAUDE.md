# autotel-genai

Gold-standard OpenTelemetry **GenAI** instrumentation for LLM calls, tools, and
agents. Canonical `gen_ai.*` semantic conventions aligned to the
`semantic-conventions-genai` snapshot, canonical-only. There is **no** legacy
`gen.ai.*` / `prompt_tokens` surface.

## Your Role

You own the GenAI observability layer that sits on top of core `autotel`. You
understand the OpenTelemetry GenAI semantic conventions and keep this package
exactly aligned with them.

## What lives here

- `src/semconv.ts`: **source of truth**: `gen_ai.*` keys (`GEN_AI`), event
  names (`GEN_AI_EVENT`), operation names (`GEN_AI_OPERATION`), provider enum
  (`GEN_AI_PROVIDER`), token/output/tool types, metric names, and
  `genAiSpanName()` (joins the operation with the already-selected canonical
  identifier).
- `src/cost.ts`: `MODEL_PRICING`, `SERVER_TOOL_PRICING_PER_1K`,
  `estimateLLMCost`, `recordLLMCost`, `unpricedServerTools`.
  Server-hosted tools are billed outside the token counts — an agent that
  searches every step can spend more there than on tokens. `SERVER_TOOL_PRICING_PER_1K`
  covers **only tools providers bill per call** (`web_search`, `file_search`);
  the unit is the entry requirement. A tool billed per container session
  (OpenAI's code interpreter) or by execution time (Anthropic's) has no per-call
  price, and inventing one overstates a 100-call session by two orders of
  magnitude — a confident wrong number is harder to catch than a missing one.
  Such tools are **left out** of the figure, never guessed at zero, and named on
  the span as `gen_ai.usage.cost.unpriced_tools`; a caller who knows their own
  contract prices them via `ModelPricing.serverToolPer1K`. `cacheTokensExclusive` says whether the
  provider reports cache tokens on top of `inputTokens` rather than inside it;
  the default (inside) is what OpenAI and Anthropic do directly, and gateways
  disagree. `tokenSource` labels `autotel.evidence.tokens`.
  `recordLLMCost` always labels `autotel.evidence.cost`: `estimated` when the
  price table answered, `unobservable` when it could not. A price-table figure
  and a provider-billed one are the same attribute; unlabelled, an estimate
  reads as an invoice. Label a reported cost `observed` yourself via
  `recordEvidence` from `autotel/evidence`.
- `src/metrics.ts`: histogram buckets + `genAiMetricViews()`.
- `src/attributes.ts`: typed builders → canonical attribute maps.
- `src/events.ts`: opt-in content attrs (with `recordInputs`/`recordOutputs`
  gating, binary redaction and a size cap) + `inference.operation.details` /
  `evaluation.result` / `client.warnings` events (via `ctx.track`).
  Content is **redacted, never inflated**: inline binary becomes
  `[base64 image/png redacted]` rather than base64 text, because one multimodal
  prompt serialised verbatim is a megabyte-scale attribute that collectors
  truncate mid-string. Whatever survives is capped at
  `DEFAULT_MAX_CONTENT_BYTES` (200KB). Both losses are declared — a cut
  attribute gains `<key>.original_size` and the span is labelled
  `autotel.evidence.input` / `.output` as `truncated` or `redacted`. Silent
  loss is the failure mode; a placeholder that names what stood there is not.
- `src/redaction.ts`: `redactBinaryContent()` / `truncateUtf8()`, pure and
  backend-agnostic. Recognition is **contextual** and that is the whole design:
  a bare base64-shaped string needs 1KB before it is suspected (a 100-char
  alphanumeric run is far more likely a request id), 64 bytes under a key that
  means binary or beside a `mediaType` / `format` hint, and an explicit `text/*`
  media type suppresses redaction outright. Loosening those thresholds redacts
  people's prompts.
- `src/streaming.ts`: streaming-performance helpers (`createStreamTimer`,
  `computeStreamTiming`, `recordStreamTiming`): TTFC, throughput, inter-chunk
  distribution. `time_to_first_chunk` is spec; `time_to_finish` /
  `output_tokens_per_second` / `time_per_output_chunk` are autotel extensions.
- `src/trace.ts`: `traceGenAI()` wrapper + `recordGenAiResponse/Usage`.
- `src/guard.ts`: inline cost/token/loop **kill-switch** runtime
  (`createGenAiGuard`, `createGenAiBudget`, `parseGuardRules`, rule factories).
  Pure, deterministic, no LLM. `stop` rules abort an `AbortSignal` and throw a
  `GEN_AI_GUARD_STOP` structured error; emits `gen_ai.guard.*` events +
  `gen_ai.session.*` accumulators (all marked autotel extensions in semconv.ts).
- `src/ai-sdk-bridge.ts`: Vercel AI SDK interop (`ai.*` → `gen_ai.*`, cost).
- `src/observer/`: `createGenAiObserver()`: an event-stream → `gen_ai.*` span
  adapter (subpath `autotel-genai/observer`). Complements `traceGenAI` for
  frameworks that emit their own lifecycle stream. Reconstructs the span tree
  from flat `*.start`/`*.end` events, force-closes abandoned children, gates
  sensitive content behind an `exportContent` privacy callback, and keeps token
  usage on leaf `chat` spans only so aggregate `agent`/`workflow` spans never
  double-count `gen_ai.usage.*`. Ships framework glue: `createLangChainObserver`
  (LangChain/LangGraph callback handler), `createMastraObserver` (a Mastra
  `ObservabilityExporter`; maps `agent_run`/`model_generation`/`rag_embedding`/
  tool calls/`workflow_*`, drops `model_step`+`model_inference` so usage is not
  double-counted, and reparents the children of dropped plumbing spans. Mastra
  `skipSpan` only adds exclusions; unsupported plumbing always stays dropped
  because the adapter has no canonical mapping for it. Mastra
  dispatches synchronously, so spans nest under the ambient autotel context —
  the reason to prefer it over `@mastra/otel-exporter`, which owns its own
  endpoint and processor and therefore misses `spanEnrichers` and cost. Keep it
  assignable to Mastra's real `ObservabilityExporter` / `TracingEvent`:
  compile-check against `/Users/jreehal/dev/ai/rag-examples/node_modules/@mastra/core`.
  `attributes` is deliberately `unknown` — Mastra's per-type attribute union has
  no member in common with a flattened view, so typing it breaks assignability.
  Its module-scope lookup tables must stay **inert object literals**: static
  keys, literal values, `satisfies` for the types. A computed key, a
  `new Set(...)`, or a `GEN_AI_TOOL_TYPE.X` value is a member expression or call
  a bundler must assume can throw, so it survives tree-shaking and costs every
  app that imports a sibling of this module ~200 bytes gzipped for a Mastra
  adapter it never calls. Verified at 0 bytes over baseline),
  `observeAiSdkResult` (Vercel AI SDK
  result walker, pull-based), and `autotelTelemetry` (Vercel AI SDK `Telemetry`
  integration for `registerTelemetry()`, push-based / live). All dependency-free
  / structurally typed. `autotelTelemetry()` is the keystone AI SDK path: it
  anchors the `chat` span on `onLanguageModelCallStart/End` (both carry `callId`,
  so it is concurrency-safe), `generateObject` / `streamObject` on
  `onObjectStepStart/End` (`gen_ai.output.type = json`), embeddings on
  `onEmbedStart`/`onEmbedEnd` (duration is the real call, not a zero-width
  span), tools become siblings under the `invoke_agent` root, and it adds cost
  - streaming timing the built-in `@ai-sdk/otel` omits. `runtimeContext.userId`
    / `sessionId` stamp `user.id` / `gen_ai.conversation.id`; leftover keys are
    dropped. It also implements the `executeTool`/`executeLanguageModelCall` context runners
    (nested traces. Needs an ambient OTel ContextManager, which real Node apps
    have) and opt-in content capture (`captureContent`, off by default; maps AI SDK
    messages → GenAI SemConv format via `ai-sdk-messages.ts`). `subscribeAiTelemetry`
    (`ai-sdk-channel.ts`) is the zero-config path: it subscribes to the `ai:telemetry`
    Node tracing channel (loaded edge-safely via `process.getBuiltinModule`, no
    static `node:` import), pairs `start`↔`asyncEnd` by message-object identity, and
    emits the same tree with usage+cost but no streaming timing. `autotelEnrich`
    (in `ai-sdk-bridge.ts`) is an `@ai-sdk/otel` `enrichSpan` helper. Provenance +
    runtimeContext mapping only; it **cannot** add cost (the SDK gives `enrichSpan`
    no usage/model and its own attrs win). `rerank` is intentionally unmapped
    (no canonical `gen_ai` operation in v1.42.0). When changing any of these, keep
    them assignable to the real `ai` `Telemetry` interface (compile-check against
    `/Users/jreehal/dev/ai/ai/packages/ai/dist`).
- `src/agent/`: agent identity / delegation / policy / audit governance
  (absorbed from the former `autotel-agent` package). Includes Google SAIF-aligned
  security attrs (`AGENT_SECURITY_ATTR`, `recordHumanApproval`, `recordInputProvenance`,
  plan/memory/render helpers) and pluggable plan-risk classifiers
  (`AgentPlanClassifier`, `runAgentPlanClassifier`, `heuristicPlanRiskClassifier`).
  `recordHumanApproval` stamps `agent.consent.evidence`, defaulting to
  `inferred`: no runtime reports the human's click, so an approval deduced from
  the tool having run must never be citable as a human decision. Callers that
  genuinely witnessed one (the Cloudflare Agents `tool:approval` event) pass
  `evidence: 'observed'`.
  `sequence.ts` is the ordered-sequence detection engine: rules are ordered
  steps within one `sessionId`, matched over `"key=value"` label sets, so it
  needs no OTel SDK and runs over live steps, spans, or a replayed fixture.
  Order is the claim — `untrusted-input-then-exfiltration` reversed does not
  fire — and `correlateBy` keeps "denied then executed" from firing whenever an
  unrelated tool succeeds after a denial. One finding per rule per session,
  ranked most severe first, convertible to security events via
  `sequenceDetectionsToSecurityEvents`. The benign half of `sequence.test.ts` is
  the part that matters: any rule fires on an attack, and a rule that also fires
  on an ordinary session is a noise generator, not a control. Add a benign case
  with every new rule.
  `disposition.ts` closes the loop: a detection nobody answered is an alert, not
  a control. `recordDetectionDisposition` records the triage decision as
  telemetry on the same pipeline as the finding, keeps history append-only
  (`supersedes` rather than edit), and **throws** on `false_positive` /
  `risk_accepted` without a note — an unexplained dismissal is not a
  disposition.
  See [`docs/AGENT-SECURITY-OBSERVABILITY.md`](../../docs/AGENT-SECURITY-OBSERVABILITY.md).

## Invariants

- **Canonical names only.** Every attribute key must come from `GEN_AI.*` in
  `semconv.ts`. No string literals for `gen_ai.*` elsewhere; no `total_tokens`
  (not in the v1.42.0 registry); usage is `input_tokens` / `output_tokens`.
- **Spec fidelity.** Match the snapshot at `/Users/jreehal/dev/temp/semantic-conventions-genai`.
  `gen_ai.request.top_k` and `gen_ai.retrieval.top_k` are ints. Honor breaking
  change #242: drop `gen_ai.agent.id` on _internal_ `invoke_agent` spans
  (`genAiAgentAttributes(…, { internal: true })`). Include `server.address` /
  `server.port` and the `gen_ai.client.operation.exception` event surface.
- **Tree-shaking.** Keep subpath exports (`./cost`, `./metrics`, …) and explicit
  named exports in `index.ts`. No barrel `export *`.
- **Core stays generic.** AI/LLM/GenAI code lives here, never back in `autotel`.
- **The PostHog contract is a test, not a doc.** PostHog ingests plain OTLP and
  builds its `$ai_*` events from canonical names server-side, so the
  integration is an agreement about attribute names with no code in between.
  `src/posthog-contract.test.ts` transcribes that agreement from `@posthog/ai`
  and depends on nothing of PostHog's. Renaming or dropping a canonical
  attribute breaks it there rather than in someone's dashboard.

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
