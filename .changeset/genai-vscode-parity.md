---
'autotel-devtools': minor
'autotel-vscode': minor
'autotel': patch
---

Bring GenAI parity, editor-integrated DX, and a portable backend layer to `autotel-vscode`, and expose the GenAI normalization layer for any consumer.

- `autotel-devtools` (minor)
  - New public export `autotel-devtools/genai` exposing the pure-TS GenAI normalization layer: `isGenAiSpan`, `toGenAiSpan`, `buildToolResultIndex`, `hydrateToolResults`, `lookupPrice`, `priceCall`, plus types (`GenAiSpan`, `GenAiMessage`, `GenAiMessagePart`, `GenAiToolCall`, `GenAiUsage`, `GenAiCost`, `GenAiOperation`, `GenAiRole`, `GenAiToolDef`). Dual ESM+CJS build with full `.d.ts`.
  - New widget GenAI tab with master/detail layout (`GenAiView`), per-span `ModelHeader` + `ConversationPanel`, expandable tool-call cards with Input/Output split, and an `AgentTimeline` swim-lane view that groups spans by `gen_ai.conversation.id`. Tab live-count badge sourced from a cached `genAiRowsSignal` so normalization runs once at ingest, not per render.
  - Normalizer covers Vercel AI SDK (`experimental_telemetry`, including the wrapper `ai.generateText` span and `ai.toolCall` sibling spans stitched in), Pydantic AI + Logfire (incl. parent `agent run` hydration via `pydantic_ai.all_messages`), OpenAI Agents v2 handoffs, Anthropic with prompt caching, OpenAI v2, Google GenAI / Logfire, and LangChain via `opentelemetry-instrumentation-langchain`.
- `autotel-vscode` (minor)
  - GenAI rendering in the span detail webview — provider chip, model, latency, tokens (with cache %), cost, agent/handoff/conversation metadata, role-colored bubbles, expandable tool-call cards with Input (neutral) / Output (green) sections. All styling uses VSCode CSS variables for native light/dark theme.
  - Editor-integrated DX — `AutotelCodeLensProvider` + `AutotelHoverProvider` aggregate the live trace buffer by `code.filepath:code.lineno` (OTel semconv) and surface `📊 N traces · p50 X · p95 Y · Z% errors` above instrumented functions. Toggle via `autotel.codeLens.enabled`.
  - Pluggable backend connectors — `QueryAdapter` interface + global registry under `src/backends/`. Concrete adapters for **Jaeger**, **Grafana Tempo**, **Honeycomb**, **Datadog APM**, **Pydantic Logfire**, and **SigNoz** — each translates its native shape into the same `SpanData` the local OTLP receiver produces.
  - Commands — `autotel.queryBackend` (pull traces from a configured backend into the same buffer), `autotel.setBackendCredential` / `autotel.clearBackendCredential` (store API tokens in `vscode.SecretStorage`, never in settings), `autotel.openMetrics` (service-aggregated count / p50 / p95 / error-rate + top-10 operations per service), `autotel.openServiceMap` (inline SVG of cross-service edges sized by call count, errored edges red).
  - Config — `autotel.backend.type` (`none` | `jaeger` | `tempo` | `honeycomb` | `datadog` | `logfire` | `signoz`), `autotel.backend.url`, `autotel.backend.dataset`, `autotel.codeLens.enabled`.
- `autotel` (patch)
  - Fix `safeRequire` under ESM consumers. `src/node-require.ts` previously used a `typeof require === 'undefined'` ternary that tsup code-splitting rewrote into a polyglot `__require` stub, causing optional peers (e.g. `@traceloop/node-server-sdk` used by `init({ openllmetry: { enabled: true } })`) to throw `"Dynamic require of X is not supported"` in ESM. Now uses `createRequire(import.meta.url)` unconditionally; esbuild rewrites it correctly for both ESM and CJS output. Also adds a docstring callout on the `sampling` field flagging the default `production()` preset's 10% baseline footgun for one-shot capture scripts.
