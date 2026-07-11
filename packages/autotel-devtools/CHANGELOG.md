# autotel-devtools

## 12.2.2

### Patch Changes

- 4b7ad78: chore: routine dependency updates

  Refresh runtime and peer dependency ranges across published packages (`ncu`, 3-day release-age cooldown).

  The core `autotel` package moves to the latest OpenTelemetry libraries (stable `2.9.x`, experimental `0.220.x`, semantic-conventions `1.42.x`). This required adapting to a breaking change in `@opentelemetry/sdk-logs`: `BatchLogRecordProcessor` and `SimpleLogRecordProcessor` now take a `{ exporter }` options object instead of a positional exporter argument.

  Notable peer range bumps for consumers: `autotel-aws` (AWS SDK `3.1081`), `autotel-cloudflare` (`@cloudflare/workers-types` v5), `autotel-pact` (`@pact-foundation/pact` v17), `autotel-terminal` (`ai` v7).

- Updated dependencies [4b7ad78]
  - autotel@4.2.4

## 12.2.1

### Patch Changes

- Updated dependencies [830b6a4]
  - autotel@4.2.3

## 12.2.0

### Minor Changes

- 7c12332: Add first-class coding-agent observability, starting with Claude Code.
  - **New package `autotel-agents`** — a browser-safe domain layer that turns the OpenTelemetry metrics + log events coding agents emit into a session-centric model. Includes an adapter registry (Claude Code + opencode, by instrumentation scope / name prefix), pure session reducers (rollups kept indefinitely, raw timeline ring-buffered), MCP-aware tool parsing (`mcp__server__tool`), and a tool taxonomy that surfaces sub-agents (`Task`), skills (`Skill`), and tool categories. Cost is taken from the agent's reported `cost_usd` and estimated from tokens only as a fallback.
  - **`autotel-devtools`**:
    - New **Agents** tab — sessions list → per-session timeline + rollup, an aggregate strip across sessions, and breakdowns by tool category, MCP server, sub-agent, and skill. Prompts are private by default with a reveal/redact toggle.
    - The OTLP receiver now **parses metric data points** (Sum/Gauge/Histogram, JSON + protobuf) and **agent log events**, reconstructs sessions server-side, and streams them to the widget.
    - New **`npx autotel-devtools claude`** launcher subcommand that starts the receiver and launches Claude Code already wired to it (HTTP/protobuf, 1s export intervals, session id on metrics). `--print-env` emits the env block for MDM / VS Code; `--log-prompts` opts into prompt-text capture.

### Patch Changes

- Updated dependencies [7c12332]
  - autotel-agents@0.2.0

## 12.1.0

### Minor Changes

- 155c2f8: Shareable URLs, cross-navigation, and canonical GenAI tool parts in the
  full-page UI.
  - **URL state sync (full-page only):** the current tab, selected trace/span, the
    traces-list filters (search, status, min-duration, sort), and the GenAI search
    are reflected in the location hash
    (`#tab=genai&trace=<id>&span=<id>&q=…&status=error&min=…&sort=duration:asc&gq=…`),
    so any view — including a filtered list — can be bookmarked or shared by
    copying the URL, and opening such a URL restores it exactly. Uses
    `replaceState` (clean history, no write→read loop) and reacts to manual hash
    edits. The embedded widget never touches the host page's URL.
  - **Navigable span IDs:** in the span detail panel, Trace ID jumps to the
    trace's root span and Parent Span ID navigates to the parent span (the
    currently-selected Span ID stays plain). Copy buttons are unchanged.
  - **GenAI view:** the `trace …` reference in the model header is now a link that
    opens the trace in the Traces waterfall, focused on that span.
  - **Span detail panel:** cross-trace span links (`span.links`) are now clickable
    and open the linked span in the waterfall.
  - **GenAI tool parts:** canonical `gen_ai` `tool_call` / `tool_call_response`
    message parts (whose data lives in `name`/`arguments`/`response`, not
    `content`) now hydrate into tool-call chips and result values instead of
    rendering as empty bubbles, matching how the Vercel `tool-call`/`tool-result`
    shape is handled.

  Internally, the selected span and the traces/GenAI list filters are now global
  signals (previously local component state / a one-shot deep-link), which is what
  lets a single writer serialize the full view into the URL without clobbering.

## 12.0.2

### Patch Changes

- 0b1e332: Refresh the AI SDK guidance across published skills and docs.
  - document `autotelTelemetry()` as the primary Vercel AI SDK integration
  - document `subscribeAiTelemetry()` as the zero-config fallback
  - move `observeAiSdkResult()` and `autotel-genai/ai-sdk` guidance into the legacy/enrichment path
  - update review skills to stop recommending `experimental_telemetry`

- Updated dependencies [0b1e332]
  - autotel@4.2.2

## 12.0.1

### Patch Changes

- Updated dependencies [38ae023]
  - autotel@4.2.1

## 12.0.0

### Minor Changes

- ec47ec8: Google Secure AI Agents observability plus MCP protocol-boundary security observability — additive defense-in-depth across planning, tool use, MCP traffic, triage, and UI surfaces.

  **autotel-mcp-instrumentation**
  - Annotation hints captured as `mcp.tool.*` span attributes (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`, `untrustedContentHint`) to surface malicious-manifest vectors and tool trust profiles.
  - Payload-size signals (`mcp.tool.arguments.size` / `mcp.tool.result.size`) for token-exhaustion and contaminated-output detection without logging content.
  - Output character budgets (`outputCharBudget` + `MCP_CHAR_BUDGETS`) that emit `mcp.security.budget_exceeded` signals and can bridge to unified `security.*` events.
  - Pluggable injection classifier (`securityClassifier`) scanning arguments and results on both client and server, recording `mcp.security.injection.*` signals and bridging suspicious verdicts to `security.*` events without breaking traced calls.
  - `heuristicInjectionClassifier()` as a dependency-free first-pass detector.
  - `spotlight()` to delimit/base64 untrusted content across Node and edge runtimes.
  - `validateToolBudget()` for WebMCP-style text-surface limits.
  - Guard bridge via `guard` config so MCP tool calls count against an `autotel-genai` guard.
  - `applyManifestAssessment()` bridges suspicious manifest verdicts to unified `security.*` events when `bridgeSecurityEvents` is enabled.
  - New `mcp.security.events` counter and `autotel-mcp-instrumentation/security` subpath export.

  **autotel-cli**
  - Add `autotel security mcp` to aggregate MCP security signals: injection verdicts, output-budget breaches, and untrusted-content tool calls.

  **autotel-genai/agent**
  - `AgentPlanClassifier` + `runAgentPlanClassifier()` / `recordPlanRiskAssessment()` with `agent.plan.risk.*` attrs and optional `llm.plan.risk.elevated` security event.
  - `heuristicPlanRiskClassifier()` as a dependency-free first-pass plan-risk tripwire.
  - Export `agentContextFromSpan()` from the agent subpath.

  **autotel-audit**
  - Passive action-chain processor emits `llm.action_chain.suspicious` and stamps unified `security.*` attributes on the destructive span.
  - `llm.manifest.suspicious` and `llm.plan.risk.elevated` added to the suggested security event catalogue.

  **autotel-cloudflare/agents**
  - `tool:approval` events use `recordHumanApproval()` (optional `autotel-genai` peer dependency).

  **autotel-devtools**
  - Agent timeline surfaces consent, policy, injection, guard, security-event, and plan-step badges from the new agent security attributes.

  **autotel-schema**
  - Agent security contract snapshot extended with `agent.plan.risk.*` attributes.

  **autotel**
  - Core `security-schema` remains the shared sink for unified `security.*` events consumed by the agent and MCP observability layers.

  **Packaging**
  - Drop the duplicated `src/` directory from published tarballs across all packages. The shipped `.js.map` sourcemaps already embed original source via `sourcesContent`, so source-level debugging is unchanged while install footprint shrinks ~20–30%.

### Patch Changes

- Updated dependencies [ec47ec8]
  - autotel@4.2.0

## 11.0.0

### Patch Changes

- Updated dependencies [12c6b6d]
  - autotel@4.1.0

## 10.1.0

### Minor Changes

- b77f040: feat(genai): inline guard and streaming telemetry, surfaced in the devtools GenAI tab

  **autotel-genai** gains two subpath exports and two `events` additions:
  - `./guard`: `createGenAiBudget`, `createGenAiGuard`, `parseGuardRules`, and rule factories for cost, token, tool-call, step, and duration ceilings, plus spin-loop, error-loop, and context-window budgets. A stop rule aborts an `AbortSignal` and throws `GEN_AI_GUARD_STOP`. It records `gen_ai.guard.*` events and `gen_ai.session.*` accumulators.
  - `./streaming`: `createStreamTimer`, `computeStreamTiming`, and `recordStreamTiming` for time-to-first-chunk, output throughput, and the inter-chunk gap distribution. Records `gen_ai.response.time_to_first_chunk` plus the `time_to_finish`, `output_tokens_per_second`, and `time_per_output_chunk` extensions.
  - `setGenAiContent` gates input and output capture and base64-encodes binary parts in place of corrupting them through `JSON.stringify`. New `recordModelWarnings` records the `gen_ai.client.warnings` event.

  **autotel-devtools** reads all of it in the GenAI tab:
  - Reads `gen_ai.usage.cost.usd` and shows it in place of the price-table estimate (cost `source: 'reported'`), and counts it in run totals.
  - Reads the streaming attributes and shows a throughput chip with time-to-first-chunk and tokens/sec.
  - Reads `gen_ai.guard.stopped`, the `gen_ai.guard.stop` and `gen_ai.guard.warning` events, and the `gen_ai.session.*` totals. A chip names the rule that fired.
  - Reads the `gen_ai.client.warnings` event and shows a chip with the count. Exports `GenAiStreaming`, `GenAiGuard`, `GenAiSession`, and `GenAiWarning`.

  **fix(skills)**: packages that ship a `skills/` directory now list `skills` in `package.json#files`, so the skill reaches npm and agents discover it from `node_modules`. This covers autotel-genai and twelve other packages: autotel-adapters, autotel-aws, autotel-backends, autotel-cli, autotel-drizzle, autotel-mongoose, autotel-playwright, autotel-plugins, autotel-sentry, autotel-terminal, autotel-vitest, and autotel-web. The `create-autotel-*` contributor skills now point at tsdown instead of tsup and drop the deleted `skills/index.json` step.

## 10.0.0

### Patch Changes

- Updated dependencies [db0cce2]
  - autotel@4.0.0

## 9.0.0

### Patch Changes

- Updated dependencies [140fc76]
  - autotel@3.7.0

## 8.1.1

### Patch Changes

- b8198d9: Fix distributed traces appearing disconnected in the live UI. Spans for a single trace arrive across multiple batches and services, and the previous merge logic dropped every update to an already-known trace (the live widget/dashboard stayed stuck on the first batch) and never recomputed the root span when later batches arrived (so a trace whose downstream service exported first was mislabeled and rooted on a child span).

  The server now recomputes the root span (and service label) on merge and broadcasts the merged trace, and the widget store merges late-arriving spans into existing traces instead of discarding them. End-to-end browser → API → auth → worker traces now connect correctly in both the embedded widget and the standalone dashboard, including the Service Map topology.

## 8.1.0

### Minor Changes

- e6037fb: GenAI view: a "Trace" mode that decomposes a run into a depth-indented tree.

  Alongside List and Timeline, the GenAI tab now has a **Trace** view that breaks the selected run down into what actually happened inside it — each model call decomposed into its reasoning, the tools it called and the text it wrote, with nested sub-agents underneath. Built from the real span tree (`parentSpanId` + GenAI semantics), so it adapts to both common shapes:
  - **Pydantic AI + Logfire** — `invoke_agent → [chat, execute_tool, chat]`: the tool is its own span, shown with its result; the chats are leaf steps and the answer step carries the text.
  - **Wrapper-span runs** — an outer generate span (e.g. `ai.generateText`) that is itself classified as a `chat` renders as a container `group`, its child model calls as steps, and the inline tool call is synthesized under the step that made it.

  Tool calls are deduped two ways so they appear exactly once: against a dedicated `execute_tool` span, and against the same call id replayed across later steps' input history. Clicking any node jumps to that span in the List view.

  New pure, unit-tested helpers exported from the widget internals: `buildRunTrace` and `flattenTrace` (`genai/trace`).

- e6037fb: GenAI view: run-level summary strip and a guided "Explain run" tour.
  - **Run summary strip** — for any multi-span run (conversation group, or trace when there's no conversation id), a compact KPI row above the detail pane shows total cost, input→output tokens, reasoning tokens, model calls, tool executions, sub-agent count, duration and errors. Cost is summed only from table-priced calls and flagged with a trailing `+` when some calls are unpriced (a lower bound, never a fabricated total).
  - **Guided tour** — an "Explain run" button steps through the run's spans in chronological order with plain-language narration ("the model decides what to do", "a tool is real code the agent ran", "the model writes the answer"). Auto-play, prev/next, keyboard control (←/→/Space/Esc) and a progress bar; it drives the existing detail panes as the stage, and clicking a span jumps the narration to that step. Built for demoing what an agent actually did.

  New tree-shakeable helpers exported from the widget internals: `summarizeRun`/`groupRuns` (`genai/summary`) and `explainSpan`/`buildTour` (`genai/narration`), both pure and unit-tested.

  The run summary is accurate across span shapes. Some frameworks emit a wrapping model-call span (e.g. an outer `ai.generateText`) that is itself classified as `chat` and carries aggregate tokens, cost and tool calls that duplicate its child model calls; aggregate/parent spans (those that time-contain another span in the run) are now excluded from model-call, token and cost tallies. Inline tool calls are also deduped by tool-call id, since prior tool calls are often replayed in each turn's input history and the same call otherwise surfaces on several spans. Verified end-to-end against both a Logfire (Python) agent and a step-based JS agent, running on Ollama.

  Fixes a pre-existing units bug in GenAI span timing. `server/otlp.ts` converts OTLP nanosecond timestamps to **milliseconds** at ingestion (absolute nanosecond unix times overflow JS `Number` precision), which is the `SpanData` contract the whole app uses — but the GenAI layer mislabelled these as nanoseconds (`startNs`/`endNs`) and its formatters divided by 1e6 again, collapsing every live GenAI latency and run duration to `0μs`/`0ms`. The normalized fields are now `startMs`/`endMs` (`durationNs` → `durationMs` on `RunSummary`), the GenAI list/detail/timeline/summary formatters treat the value as milliseconds, and the captured test fixtures were converted from nanoseconds to milliseconds to match real ingestion. The unit-test data was stale-but-consistent (also nanoseconds), which is why this never failed a test; it only showed on live data.

  Also surfaces the executed tool name on normalized GenAI spans — `gen_ai.tool.name`/`gen_ai.tool.call.id` now populate a typed `tool: { name, callId }` field (previously only present untyped in `extras.raw`), so `execute_tool` steps read e.g. "Tool: get_user_time" instead of the generic agent name. The narration's planning-vs-responding classification also recognises a tool decision signalled purely via `finish_reasons` (`tool_call`/`tool_calls`/`tool_use`/`function_call`), which is how Ollama-via-Logfire reports it.

### Patch Changes

- e6037fb: GenAI view: token-breakdown labels and named tool steps in the tour.
  - The model detail header now spells out the **cached** and **reasoning** share of token usage inline — `176 (100 cached) → 90 (32 reasoning)` — instead of only a cached percentage, so the reasoning-token count is visible where the call is inspected.
  - The guided tour's planning step now **names the tools** the model requested: "Model calls getWeather (x3)" rather than the generic "Model decides what to do", falling back to the generic title when a provider signals the decision only via a finish reason (no structured tool calls to name).

  New shared formatters in `widget/utils/genaiFormat`: `formatInputTokens`, `formatOutputTokens`, and `summarizeToolCalls` (collapses repeats into `name (xN)`, truncates long lists).

- e6037fb: Guard the receiver's read surface against cross-origin scraping by web pages.

  The captured-telemetry read-back (`GET /v1/traces`), the clear endpoint (`DELETE /v1/traces`) and the live WebSocket (`/ws`) are now origin-checked. Previously every response carried `Access-Control-Allow-Origin: *`, so any website a developer happened to visit could `fetch('http://127.0.0.1:4318/v1/traces')` or open `ws://127.0.0.1:4318/ws` and read their locally captured prompts, responses and tokens.

  Two checks, matching the threat model:
  - A request to a read/stream endpoint carrying a **non-loopback `Origin`** (a cross-origin browser read) is rejected with `403`.
  - When the receiver is bound to a loopback host (the default), a **non-loopback `Host`** (DNS rebinding, where the read looks same-origin and may carry no `Origin`) is also rejected. An explicit non-loopback bind (`--host 0.0.0.0`) is treated as an opt-in to network exposure, so only the `Origin` check applies there.

  OTLP ingestion (`POST /v1/{traces,logs,metrics}`), `widget.js` and `healthz` stay fully open — browser apps on arbitrary dev origins must still send telemetry and load the embeddable widget, which keeps working because it connects from a loopback origin. Server-side reads with no `Origin` (curl, Node `fetch` in Playwright tests) are unaffected.

  New guard helpers are exported from `autotel-devtools/server`: `allowSensitiveRequest`, `isLoopbackHostname`, `hostHeaderIsLoopback`, `originIsLoopback`.

## 8.0.0

### Patch Changes

- Updated dependencies [47a69ac]
  - autotel@3.6.0

## 7.0.0

### Minor Changes

- 1c43d26: Security tab in the devtools widget. Surfaces spans carrying the `security.*` schema (autotel-audit security events and processor-flagged suspicious requests) with severity badges, category/outcome/service chips, a minimum-severity filter, severity counts, and one-click pivot to the owning trace.

### Patch Changes

- 3ab5dc3: chore: update dependencies + migrate workspace to vite 8

  Routine dependency refresh via npm-check-updates (3-day publish cooldown).
  - **Dev tooling:** vitest 4.1.8, `@types/node`, tsx, typescript-eslint 8.60.1, eslint 10.4.1, svelte 5.56, storybook 10.4.2, etc.
  - **Runtime/peer (published packages):** aws-sdk 3.1063, `@tanstack/{react,solid}-start` 1.168.25, hono 4.12.23, `@sentry/node` 10.56, `@cloudflare/workers-types`, react 19.2.7, ai-sdk / ai 6.0.197, `@traceloop/node-server-sdk` 0.27, google-auth-library 10.7, protobufjs 8.6, svelte 5.56.

  **Vite 8:** forced `vite ^8` across the workspace via a pnpm override. autotel was already partly on vite 8 (`@sveltejs/vite-plugin-svelte` 7 and `@vitejs/plugin-react` 6 both require it); storybook (svelte-vite), the astro docs, and the tanstack-start example all build cleanly on vite 8.

  eslint is held at `^9` in `apps/example-nextjs` (a private example) — `eslint-config-next` 16 / `eslint-plugin-react` are not yet eslint-10 compatible. Published packages are unaffected.

- Updated dependencies [1c43d26]
- Updated dependencies [3ab5dc3]
  - autotel@3.5.0

## 6.1.1

### Patch Changes

- bb9a1b7: Restructure the DevTools widget UX and add a configurable TanStack instrument() preset.
  - **autotel-devtools**: extract reusable abstractions (`useListKeyboardNav`, `useZoomPan`, `matchesNeedle`, `SearchInput`), decompose the `Panel` and restore its resize UX, unify the drag mechanic and tab bar across surfaces so no view is unreachable, and collapse the pause-buffer into a stream table.
  - **autotel-tanstack**: add a configurable `instrument()` preset; `auto.ts` now delegates to it.
  - **autotel**: export `isInitialized` from the package entry point.

- Updated dependencies [bb9a1b7]
  - autotel@3.4.2

## 6.1.0

### Minor Changes

- b539582: ### autotel-devtools — detect foreign OTLP collectors on port conflict, plus a first-class identity signal
  - **Foreign-collector detection:** when the requested port is busy and the receiver falls forward to another port, it now probes who holds the original port. If it is another autotel-devtools instance, the warning says so (benign). If it is a _foreign_ process (for example an IDE's built-in OTLP collector), it warns explicitly that apps exporting OTLP to the busy port are reaching that process — not this devtools — and to point the exporter at the bound port or free the original. This removes a silent footgun where the UI sat empty while apps saw export errors.
  - **Identity signal:** every HTTP response now carries an `x-autotel-devtools: <version>` header (exposed via CORS), and `GET /healthz` returns `{ ok, service: "autotel-devtools", version, clients }`. Clients and integrators can positively confirm they are talking to autotel-devtools instead of guessing from the body shape.
  - **Clearer ingest errors:** a failed OTLP POST now echoes the `contentType` it received alongside the message, so a misconfigured exporter (wrong or missing content type) is diagnosable from the 400 response.
  - **New exports:** `probePortHolder()`, `DEVTOOLS_IDENTITY`, and the `PortHolder` type are exported from `autotel-devtools/server`.

## 6.0.1

### Patch Changes

- ea2cb4a: ### autotel-devtools — CLI port shorthand, busy-port fallback, theme fix
  - **Port as a positional:** `npx autotel-devtools 4319` is shorthand for `--port 4319`; an explicit `--port`/`-p` always wins. Invalid ports exit with code 2.
  - **Busy-port fallback:** if the requested port is in use, the receiver walks forward (up to 20 consecutive ports) and binds the first free one, printing a warning with the actual port. Startup URLs and OTLP hints use the bound port.
  - **Bind-phase crash fix:** swallow WebSocketServer `error` re-emissions from `ws` during `EADDRINUSE` recovery so port-fallback probing no longer crashes the process.
  - **Theme in shadow DOM:** apply `data-theme` on the shadow host (via `getRootNode().host`) instead of `document.querySelector('autotel-devtools')`, so light/dark tokens resolve inside the widget stylesheet.

  ### autotel — lazy `node-require` for edge runtimes

  Defer `createRequire()` until the first `safeRequire()` / `requireModule()` / `nodeRequire()` call so merely importing `node-require` (and re-exports such as `track`) no longer throws in runtimes without a module path (e.g. Cloudflare Workers / workerd). Optional lookups still degrade to `undefined` via `safeRequire()`; `nodeRequire.resolve` (and `resolve.paths`) are forwarded lazily.

- Updated dependencies [ea2cb4a]
  - autotel@3.4.1

## 6.0.0

### Minor Changes

- 20a1186: Span inspection: code-location links, database query view, and inline span events.
  - **Code-location linking**: when a span carries `code.*` attributes (both the legacy `code.filepath`/`code.lineno` and current `code.file.path`/`code.line.number` conventions), the span detail panel renders a clickable editor deep-link. The target editor (VS Code / Cursor / WebStorm) is selectable and persisted across sessions.
  - **Database query inspection**: spans with `db.*` attributes get a dedicated panel showing system, operation, table, database name, and row counts, plus the SQL statement with display-only keyword/string highlighting. Highlighting only tokenises — it never reformats or rewrites the query.
  - **Inline span-event popover**: waterfall event markers are now clickable, opening an inline popover with the event name, timestamp, severity, and attributes. Dismissed on outside click or Escape. The marker lane-packing logic was extracted into a tested pure module.

- 20a1186: Cross-view navigation, connection status, and Flow keyboard control.
  - **Deep-link to a span**: a global `selectedSpanIdSignal` plus `openSpanInWaterfall(traceId, spanId)` let any view jump to a specific span in the Traces waterfall. The Flow detail panel and the GenAI span view now have an "Open in Traces" button; the waterfall expands collapsed ancestors and scrolls the target into view.
  - **Connection status**: the receiver connection state (connected / connecting / disconnected) is now shown — a labelled dot in the full-page sidebar and a compact dot in the embedded panel header — so "no data yet" is distinguishable from "not connected".
  - **Flow keyboard navigation**: with the graph focused, arrow keys move between nodes (left/right within a layer, up/down to the nearest node in the adjacent layer), Enter opens the node in Traces, and Esc deselects.

- 8fd868f: Devtools DX pass:
  - **Theming**: functional light/dark/system theme driven by `data-theme` + CSS custom-property tokens (`--at-*` mapped into Tailwind `@theme`), with a theme cycle toggle and `localStorage` persistence. Storybook gains a Theme toolbar so every story is viewable in both modes.
  - **JSON attribute viewer**: span attributes that are JSON objects/arrays (e.g. `gen_ai.input.messages`) now render as a collapsible, syntax-coloured tree instead of one long line. Reliable detection (try-parse, object/array only) falls back to the raw value for scalars and invalid JSON.
  - **Keyboard shortcuts**: centralised the `?` help modal into a single source of truth, fixing a bug where two help dialogs could stack. Context-aware shortcut lists for the trace list and trace detail.
  - **Span detail**: the attributes panel is now vertically resizable; the fullscreen value button is reachable (it previously had no `group` hover ancestor).
  - **Waterfall**: time-axis labels are responsive — marker count adapts to the column width and the first/last labels are edge-aligned, so they no longer collide in a narrow pane.
  - **Sub-millisecond precision**: fixed OTLP parsing truncating durations to whole milliseconds — fast spans (<1ms) now keep microsecond precision instead of showing `0ms`.
  - **Critical path**: the waterfall highlights the span chain that determines total trace latency (toggleable), pointing straight at the bottleneck.
  - **Self time**: span detail shows exclusive duration (span time minus children, interval-unioned) so you can tell a slow span from a slow subtree.
  - **Trace sorting**: sort the trace list by time / duration / span count / service / name / status to surface the slowest or largest traces.
  - **Min-duration filter**: filter the trace list to traces at least N ms long.
  - **Instrumentation scope**: span detail shows the emitting instrumentation name/version (parsed from OTLP `scope`).
  - **Service map redesign**: per-service pastel node fills with soft shadows, bold names, and `N spans · N err` subtitles; connection edges now show always-on labels (`1× · 900ms`, `2× · 50% err · 150ms`) with filled arrowheads and dashed red error edges — keeping the type-coded shapes (DB cylinder, messaging hexagon).
  - **Service map bug fixes**: (1) CLIENT-span connections used `inferResourceName` for the source, which resolved to the _peer_ and collapsed source==target so no edges ever rendered — the caller is now the span's own resource service; (2) SVG presentation attributes were written camelCase (`strokeWidth`, `strokeDasharray`, `markerEnd`, `textAnchor`), which Preact passes through verbatim and SVG ignores, so arrowheads, dashes, stroke widths, and text centring never applied — all converted to kebab-case.
  - **Design system pass**: introduced a typography duality — **Hanken Grotesk** for UI chrome, **JetBrains Mono** reserved for data (IDs, durations, attributes, code) — replacing the previous monospace-everything UI. Reworked the theme tokens into an **OKLCH** system with neutrals subtly tinted toward the brand hue (no pure black/white), and added restrained, reduced-motion-aware entrance animations for modals. Recorded the design context in `.impeccable.md`.
  - **Trace list redesign**: replaced the tall cards with a dense, scannable table — sortable column headers (Service, Operation, Duration, Spans, Time, Status) that drive the multi-axis sort directly, aligned monospace metrics, status badges, and per-service colour pills that match the service-map node colours. The columns are **container-responsive** (Spans + Time drop first) so it stays usable in a narrow docked widget without horizontal scroll.
  - Removed the unused `react-json-view-lite` dependency.

- 20a1186: Add a **Flow** view: a per-trace call graph that unifies AI tool calls, LLM calls and plain functions into one picture of what a run did.
  - New `Flow` tab (full-page + embedded panel) rendering a top-to-bottom node graph with `__start__`/`__end__` bookends, role-coloured nodes (entry / LLM / AI tool / function / db / http), and repeated calls collapsed into a single node with a count and error ratio (e.g. `calculate 4/5`).
  - Selecting a node opens an input/output panel that renders functions and AI tools identically — AI tools from `ai.toolCall.args/result`, plain functions from the `autotel.input`/`autotel.output` capture convention, with sensible fallbacks for db/http.
  - LLM economics: nodes and a per-trace header chip show token counts and USD cost, sourced from the canonical GenAI pricing layer. AI-SDK wrapper aggregates (`ai.streamText`) are counted once rather than double-counted with their `doStream` children.
  - Pure, unit-tested graph layer (`flow/flow.ts`): span classification, I/O extraction, repeat-collapsing graph build, per-node metric aggregation, and BFS/barycenter layout.
  - Shared `JsonField` and token/cost formatters so the Flow view, the GenAI view, and the ToolCallCard render I/O and economics from one place.

- 20a1186: `DevtoolsServer` gains an optional `onData(incremental)` callback, invoked after each ingest with the data just broadcast to WebSocket clients. Lets an embedder (e.g. the VS Code extension) keep its own views in sync while the server owns the buffer, error aggregation and WS fan-out. Listener errors are swallowed so a bad embedder can't break ingestion.
- 8fd868f: Rewrite the devtools widget UI from Preact to Svelte 5.
  - All widget components migrated to Svelte 5 (runes). Reactive state flows through a small signal shim (`signals.svelte.ts`) that preserves the `.value` API on top of runes, consumed by `store.svelte.ts` — so the store and call sites stayed stable across the rewrite.
  - The widget still mounts into a Shadow DOM custom element (`<autotel-devtools>`); the **public surface is unchanged** — server exports, the custom element, the CLI, and `widget.js` all behave as before.
  - **Accessibility**: a cohesive brand-accent `:focus-visible` ring replaces the browser default (which was off-brand and got clipped at scroll-container edges); list rows use an inset ring so it's never cut off; inputs that previously showed no visible focus now do. Clickable rows/SVG nodes gain keyboard activation, and modal backdrops are real `<button>`s.
  - **Visual fixes**: service-map edge labels get a surface-coloured halo so they stay legible over their connection lines; waterfall event markers now align to the bar instead of hanging below it.
  - Unified the tab → view dispatch into a single `TabView` shared by the full-page and embedded-panel surfaces (previously duplicated and drifted).
  - Icons moved from `lucide-svelte` to the Svelte 5-native `@lucide/svelte`.
  - **Tooling**: Vite, Storybook, Vitest, ESLint, and Prettier all moved to Svelte. `.svelte` files are now linted (`eslint-plugin-svelte`, incl. a11y rules) and formatted (`prettier-plugin-svelte`). Storybook stories run as browser tests (play functions) in CI alongside the unit suite, and `build-storybook` validates that every story compiles.

- 20a1186: The fullpage widget now honours a URL-hash deep-link: `#trace=<id>&span=<id>` opens the widget on the Traces waterfall focused on that trace/span once it arrives over the wire. Exposed via a new optional `deepLink` on `mountWidget`'s props and the `requestDeepLink(traceId, spanId?)` store helper. Lets an embedder (e.g. the VS Code extension) point an iframe at `/#trace=…` and land on the right span. (Also removes the unused `?position=` script param.)

### Patch Changes

- 20a1186: Clearer CLI startup banner for embedding the widget. The bundle auto-mounts on load, so the bare `<script src=".../widget.js"></script>` is all that's needed — the banner now says so explicitly (a floating panel appears automatically), and shows the two opt-in variations: `?mode=fullpage` for a full-screen view, or placing `<autotel-devtools></autotel-devtools>` yourself to control location. No behaviour change.
- Updated dependencies [20a1186]
  - autotel@3.4.0

## 5.1.0

### Minor Changes

- 52f8269: Make the trace detail panel resizable. Drag the divider between the timeline and the span detail panel to widen it (handy for long attributes like `gen_ai.input.messages`), double-click to reset, or focus the divider and use the arrow keys. The chosen width is clamped to the container and persisted to `localStorage`.

### Patch Changes

- 52f8269: Fix OTLP/protobuf ingestion failing with `protobuf.Root is not a constructor` in the published bundle.

  `otlp-proto.ts` imported protobufjs with `import * as protobuf`, which under esbuild's CJS→ESM interop left `protobuf.Root`/`protobuf.parse` undefined in the bundled ESM output — the form `npx autotel-devtools` runs. Every protobuf POST (the default for the Python/Java/Go SDKs over `http/protobuf`) was rejected with HTTP 400. Switched to a default import so the constructors resolve in both the ESM and CJS bundles.

  Added a regression guard that loads the built `dist/` bundle in a real Node process and decodes an OTLP/protobuf payload (`scripts/check-dist-esm.mjs`, run via the `otlp-proto.dist.test.ts` suite test and gated on publish through `prepublishOnly`). Source-level and vitest tests could not catch this because vite's loader resolves CJS interop differently than Node.

## 5.0.1

### Patch Changes

- 4ce86fc: Refresh package dependencies across the workspace and keep generated lockfile state in sync.

  Add OTLP/protobuf ingestion support to `autotel-devtools` for traces, logs, and metrics. The devtools HTTP receiver now accepts both OTLP/JSON and OTLP/protobuf payloads on the existing `/v1/traces`, `/v1/logs`, and `/v1/metrics` endpoints, decodes protobuf payloads with embedded OTLP schemas, and includes interop coverage using the OpenTelemetry protobuf serializers.

- Updated dependencies [4ce86fc]
  - autotel@3.3.1

## 5.0.0

### Minor Changes

- 30a485b: ### autotel-web — W3C baggage propagation

  Add end-to-end business-context propagation via W3C baggage.

  New `setBaggage(record)` / `clearBaggage(key?)` runtime API and an `init({ baggage: { initial, allowedOrigins } })` config option let you attach context such as `tenant.id` that travels with every instrumented request as a W3C `baggage` header and is tagged onto every browser-recorded span. On the backend, autotel's `BaggageSpanProcessor` copies the entries onto server spans, so a single attribute (e.g. `tenant.id`) appears on browser and server spans across the whole trace — no more reading the tenant from request URLs in devtools.

  `setBaggage()` merges additively (matching Sentry `setTags` / Datadog `setGlobalContextProperty` ergonomics) and works for values known only at runtime (post-login, tenant switcher). Baggage injection is **fail-closed**: it is sent only to same-origin requests unless a destination is listed in `baggage.allowedOrigins`, and never travels wider than `traceparent` (inherits DNT/GPC/blocked-origin suppression), so customer-identifying values are not leaked to third-party origins. Covers both `fetch` and `XMLHttpRequest`.

  ### autotel-adapters — Express, Fastify, auto-emit

  Add Express and Fastify adapters and emit one canonical wide event per request by default across all adapters.

  `autotel-adapters/express` and `autotel-adapters/fastify` expose `withAutotel(handler, options)` and `useLogger(request)`, matching the existing Next, Nitro, and Cloudflare adapters. Each request opens a span, gets a request-scoped logger, and emits one canonical wide event when the handler settles.

  ```typescript
  import { withAutotel, useLogger } from 'autotel-adapters/express';

  app.get(
    '/orders',
    withAutotel((req, res) => {
      useLogger(req).set({ feature: 'checkout' });
      res.json({ ok: true });
    }),
  );
  ```

  The Express wrapper records thrown errors and forwards them to `next`; the Fastify wrapper records and rethrows for Fastify's error handling.

  **Behavior change:** `autoEmit` now defaults to `true` for every adapter, including the existing Next, Nitro, and Cloudflare wrappers. Each wrapped handler emits one wide event per request. Pass `{ autoEmit: false }` to restore the previous behavior of not emitting automatically.

  ### autotel — PII redaction, catalogs, LLM cost

  **Auto-enable PII redaction in production.** When `attributeRedactor` is left unset and the resolved environment is `production` (`config.environment` or `NODE_ENV`), `init()` now applies the `'default'` redaction preset. Span attributes are scrubbed of emails, phones, SSNs, credit cards, and sensitive keys before any exporter sees them. In non-production environments redaction stays off so local debugging shows real values.

  **Behavior change:** production telemetry that previously exported raw values now has PII redacted by default. Control it:
  - `init({ attributeRedactor: 'strict' })` — stronger preset, applied in every environment.
  - `init({ attributeRedactor: false })` — disable redaction entirely, even in production.
  - `AUTOTEL_REDACT_PII` env var — `off` disables, `default` / `strict` / `pci-dss` selects a preset, `on` forces the default preset on in any environment.

  Precedence: explicit config, then env var, then the production default. The `attributeRedactor` config field now also accepts `false`.

  **Typed error and audit catalogs:** `defineErrorCatalog()` and `defineAuditCatalog()`.

  Group related errors into one catalog and get a refactor-safe builder per code, with autocomplete at every call site and typed message parameters. Each builder produces a `StructuredError` carrying the entry's `message`, `status`, `code`, `why`, `fix`, and `link`; codes default to `${namespace}.${KEY}`.

  ```typescript
  import { defineErrorCatalog } from 'autotel';

  const billing = defineErrorCatalog('billing', {
    PAYMENT_DECLINED: {
      status: 402,
      message: 'Card declined',
      why: '...',
      fix: '...',
    },
    INSUFFICIENT_FUNDS: {
      status: 402,
      message: ({
        available,
        required,
      }: {
        available: number;
        required: number;
      }) => `Insufficient funds: $${available} of $${required}`,
    },
  });

  throw billing.PAYMENT_DECLINED({ cause: stripeError });
  throw billing.INSUFFICIENT_FUNDS({ available: 5, required: 100 });

  if (billing.PAYMENT_DECLINED.match(err)) {
    /* ... */
  }
  ```

  `defineAuditCatalog()` produces typed audit-action descriptors (`action`, `severity`, optional `message`). Helpers `isCatalogError()` and `getCatalogCode()` read the catalog code off any error.

  **Per-model LLM cost estimation:** `estimateLLMCost()`, `recordLLMCost()`, and a `MODEL_PRICING` table.

  Estimate the USD cost of an LLM call from its token usage and record it as the `gen_ai.usage.cost.usd` span attribute, pairing with the existing `gen_ai.client.cost.usd` metric bucket advice.

  ```typescript
  import { trace, recordLLMCost } from 'autotel';

  export const chat = trace((ctx) => async (prompt: string) => {
    const res = await client.messages.create({ model /* ... */ });
    recordLLMCost(ctx, model, {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    });
    return res;
  });
  ```

  `MODEL_PRICING` ships approximate public list prices for common OpenAI, Anthropic, and Gemini models; override or extend per call via `{ pricing }`. Versioned model ids resolve to a base entry by longest-prefix match, and cached input tokens are billed at `cachedInputPer1M` when provided.

  ### autotel-devtools — HTTP read-back and dual-stack loopback
  - **`GET /v1/traces`** returns the traces the receiver has actually captured (`{ traces, count }`), and **`DELETE /v1/traces`** clears captured telemetry. This lets integration/Playwright tests verify the collector _received_ spans by polling it over HTTP — instead of only asserting "the client tried to send", which a browser-level route intercept can fulfil before the request ever reaches a server.
  - **Dual-stack loopback:** when bound to a loopback host, the CLI and `createDevtools()` now listen on **both** `127.0.0.1` and `::1`, so a client connecting via `localhost` reaches the receiver regardless of how the OS resolves `localhost` (macOS prefers IPv6 `::1`). This removes a silent footgun where a dev-server proxy targeting `localhost` saw its spans vanish with no error against an IPv4-only receiver.
  - **Startup self-check:** the CLI prints every bound address, a `curl .../v1/traces` verification hint, and a warning (not a silent failure) if a loopback family can't be bound.
  - New README sections: "Behind a dev-server proxy" (the `pathRewrite` + `127.0.0.1` gotchas) and "Verifying ingestion in tests".

  ### autotel-subscribers — FileSubscriber

  Add `FileSubscriber` (`autotel-subscribers/file`): append tracked events to a file as newline-delimited JSON (NDJSON).

  Useful for AI agents, scripts, evals, and local debugging that want structured events on disk without a hosted backend. Query the file with `jq`, load it into a notebook, or feed it to an agent.

  ```typescript
  import { Event } from 'autotel/events';
  import { FileSubscriber } from 'autotel-subscribers/file';

  const events = new Event('worker', {
    subscribers: [new FileSubscriber({ path: './telemetry/events.ndjson' })],
  });
  ```

  Writes are serialized so concurrent events never interleave. Options: `pretty` for indented JSON, `mkdir` to create parent directories (default on), and `transform` to reshape or drop events before writing.

  ### autotel-terminal — dual-stack loopback

  Bind both loopback families and warn on partial binding.

  When bound to a loopback host, the receiver now listens on **both** `127.0.0.1` and `::1`, so a client (or dev-server proxy) connecting via `localhost` reaches it regardless of how the OS resolves `localhost` (macOS prefers IPv6 `::1`). Previously the CLI bound IPv4-only, so a `localhost` proxy could silently send spans into a black hole. The startup line now prints every bound address and warns (rather than failing silently) if a loopback family can't be bound. Added a README "Behind a dev-server proxy" section documenting the `pathRewrite` + `127.0.0.1` gotchas.

### Patch Changes

- Updated dependencies [30a485b]
  - autotel@3.3.0

## 4.0.0

### Patch Changes

- Updated dependencies [9fbbc3a]
  - autotel@3.2.0

## 3.0.1

### Patch Changes

- Updated dependencies [3966db0]
  - autotel@3.1.1

## 3.0.0

### Patch Changes

- Updated dependencies [614d414]
  - autotel@3.1.0

## 2.1.0

### Minor Changes

- ee60622: Bring GenAI parity, editor-integrated DX, and a portable backend layer to `autotel-vscode`, and expose the GenAI normalization layer for any consumer.
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

### Patch Changes

- Updated dependencies [ee60622]
  - autotel@3.0.7

## 2.0.6

### Patch Changes

- Updated dependencies [8d5d84d]
  - autotel@3.0.6

## 2.0.5

### Patch Changes

- 1a8bedd: Updated dependencies
- Updated dependencies [1a8bedd]
  - autotel@3.0.5

## 2.0.4

### Patch Changes

- 3a21282: Live-tail filter and pause/resume for autotel-devtools, full-state snapshot export/import, an `Autotel: Open Devtools UI` webview in the VS Code extension, and a small ergonomics fix that aligns `span()` with `trace()` across `autotel` and `autotel-edge`.

  **`autotel` and `autotel-edge` — `span()` accepts a string name**

  `span()` now mirrors `trace()` and accepts a span name as the first argument for the common case where no extra attributes are needed. Existing `span({ name, attributes }, fn)` calls are unchanged.

  ```ts
  // Before — only the object form was available
  await span({ name: 'payment.charge' }, async () => charge(order));

  // Now — string shorthand, same calling convention as trace('name', fn)
  await span('payment.charge', async () => charge(order));
  ```

  **`autotel-devtools` — live-tail controls and snapshots**
  - **Pause / resume** on the Traces and Logs tabs. While paused, incoming traces and logs go into a buffer; the resume button surfaces a `+N` count so you can see what's queued. Resume flushes the buffer (no data loss); `Drop buffer` discards it if you don't want it.
  - **Filtering** on Traces (text query against service / span name / trace id / correlation id, plus an `All / Errors / OK` status filter) and on Logs (text query against message / resource / trace id, plus an `All / Errors / Warn+ / Info` severity filter). The header count flips to `X of Y` when a filter is active.
  - **Full snapshot export / import** via a new bar above the tab content. `Download snapshot` writes a versioned JSON file containing traces, logs, errors and metrics. `Load snapshot` reads one back and switches the widget into a frozen "snapshot mode" (live updates suppressed, amber banner with `Exit` to return to live).
  - New Storybook coverage for the paused-with-buffer state on Traces / Logs and for the SnapshotBar's live and snapshot modes. CI now also runs `build-storybook` as part of `pnpm quality`.

  **`autotel-vscode` — embed the devtools UI**
  - New `Autotel: Open Devtools UI` command opens a webview panel beside the editor with an iframe of a running `autotel-devtools` instance. Uses `vscode.env.asExternalUri` so it works over SSH / Codespaces / dev containers.
  - New `autotel.devtools.url` setting; falls back to `http://<receiver.host>:<receiver.port>` if unset.
  - The previously-introduced static instrumentation tree and entity-graph webview have been removed because they didn't pull weight against the live OTLP view. Net deletion of ~1k LOC and one workspace package (`autotel-entity-indexer`).

  **`autotel-mcp` — bind-to-random-port support**
  - `OtlpReceiver.start()` now resolves the actual bound port after `listen()` so passing `port: 0` works for tests and dev setups that need OS-assigned ports. New `getPort()` accessor exposes the resolved port.

  **Internal**
  - `autotel-devtools` CLI tests now spawn the built `dist/cli.js` directly under the current Node binary, which is ~10× faster and removes the `npx tsx` dependency from the CI test path.

- Updated dependencies [3a21282]
  - autotel@3.0.4

## 2.0.3

### Patch Changes

- 5e146a7: Streamline package surface and align skills with the [Agent Skills specification](https://agentskills.io/specification).
  - Drop `@tanstack/intent` from runtime and dev dependencies, plus the auto-generated `bin/intent.js` shims. Skills still ship under each package's `skills/` directory and are discovered by spec-compliant agents (Claude Code, Cursor, Cline, etc.) via filesystem scan — no consumer-side CLI required.
  - Remove the `autotel/workers` and `autotel/cloudflare` entry points from `autotel`. Cloudflare Workers users should import directly from `autotel-cloudflare` (and its `/logger`, `/sampling`, `/events` subpaths). `autotel` no longer peer-depends on `autotel-cloudflare` or `autotel-edge`.
  - Strip non-spec frontmatter (`type`, `library`, `library_version`, `sources`, `requires`) from all `SKILL.md` files; keep only spec-defined fields (`name`, `description`, optional `license`).
  - Move user-facing skills (`migrate-to-autotel`, `tune-sampling`, `debug-missing-spans`, `build-audit-trails`) into `packages/autotel/skills/` so consumers receive them automatically via npm. Contributor-only skills (`create-autotel-adapter`, `create-autotel-instrumentation`, `create-autotel-exporter`) remain under the repo-root `skills/` directory.
  - Realign `autotel`'s peer dependency ranges to match published versions on npm.
  - Release workflow now refreshes `pnpm-lock.yaml` after `changeset version` so the next Version Packages PR ships with a consistent lockfile.

- Updated dependencies [5e146a7]
  - autotel@3.0.3

## 2.0.2

### Patch Changes

- Updated dependencies [5999cb9]
  - autotel@3.0.2

## 2.0.1

### Patch Changes

- 5d05a3e: Add Cloudflare Workers support to main `autotel` package. Introduces `autotel/workers` and `autotel/cloudflare` entry points that re-export the functional API and Cloudflare-specific instrumentation from `autotel-cloudflare`, providing better DX for Cloudflare users while keeping the core package modular. Updates package exports, build config, and documentation.
- Updated dependencies [5d05a3e]
  - autotel@3.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [b1f3704]
  - autotel@3.0.0

## 1.0.3

### Patch Changes

- dc4908d: Updated deps
- Updated dependencies [dc4908d]
  - autotel@2.26.3

## 1.0.2

### Patch Changes

- Updated dependencies [abe7674]
  - autotel@2.26.2

## 1.0.1

### Patch Changes

- Updated dependencies [dc471ef]
  - autotel@2.26.1

## 1.0.0

### Patch Changes

- Updated dependencies [8003fad]
  - autotel@2.26.0
