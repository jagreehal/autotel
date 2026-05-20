---
'autotel-devtools': minor
'autotel': minor
'autotel-hono': minor
'autotel-cli': minor
---

Bring GenAI parity, editor-integrated DX, and a portable backend layer to `autotel-vscode`, and expose the GenAI normalization layer for any consumer.

- `autotel-devtools`
  - New public export `autotel-devtools/genai` exposing the pure-TS GenAI normalization layer: `isGenAiSpan`, `toGenAiSpan`, `buildToolResultIndex`, `hydrateToolResults`, `lookupPrice`, `priceCall`, plus types (`GenAiSpan`, `GenAiMessage`, `GenAiMessagePart`, `GenAiToolCall`, `GenAiUsage`, `GenAiCost`, `GenAiOperation`, `GenAiRole`, `GenAiToolDef`).
  - Same module powers the existing widget GenAI tab and the new VSCode rendering — single normalizer across surfaces, dual ESM+CJS build with full `.d.ts`.
- `autotel-vscode`
  - **GenAI rendering in span detail webview**: provider chip, model, latency, tokens (with cache %), cost, agent/handoff/conversation metadata, role-colored bubbles, expandable tool-call cards with separate INPUT (neutral) and OUTPUT (green) sections. All styling uses VSCode CSS variables for native light/dark theme support.
  - **Editor-integrated DX**: `AutotelCodeLensProvider` and `AutotelHoverProvider` aggregate the live trace buffer by `code.filepath:code.lineno` (OTel semconv) and surface `📊 N traces · p50 X · p95 Y · Z% errors` above instrumented functions and on hover. New `autotel.codeLens.enabled` setting.
  - **Pluggable backend connectors**: `QueryAdapter` interface + global registry under `src/backends/`. Concrete adapters for **Jaeger**, **Grafana Tempo**, **Honeycomb**, **Datadog APM**, **Pydantic Logfire**, and **SigNoz** — each translating its native span shape into the same `SpanData` the local receiver produces, so every view (tree, span detail, GenAI render, CodeLens, hover, metrics, service map) lights up against remote data with zero extra wiring.
  - **Remote query**: `autotel.queryBackend` picks a service via QuickPick, pulls traces from the configured backend, and ingests them into the same buffer the local OTLP receiver feeds.
  - **Credential management**: `autotel.setBackendCredential` / `autotel.clearBackendCredential` commands store API tokens in `vscode.SecretStorage`, never in settings.
  - **Metrics panel** (`autotel.openMetrics`): service-aggregated count, p50, p95, error rate, plus top-10 operations per service. Auto-refreshes on ingest.
  - **Service map panel** (`autotel.openServiceMap`): inline SVG graph of cross-service edges derived from spans whose parent and child live in different services. Edge thickness scales with call count, errored edges turn red, plus a tabular edge breakdown with calls / p95 / error rate.
  - New config: `autotel.backend.type` (`none` | `jaeger` | `tempo` | `honeycomb` | `datadog` | `logfire` | `signoz`), `autotel.backend.url`, `autotel.backend.dataset`, `autotel.codeLens.enabled`.
  - Test coverage: 27 tests across new CodeLens aggregation, adapter registry contract, Jaeger / Tempo / Honeycomb fetch behaviour, and existing extension flows.
