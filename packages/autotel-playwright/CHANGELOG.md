# Changelog

## 0.4.43

### Patch Changes

- Updated dependencies [830b6a4]
  - autotel@4.2.3

## 0.4.42

### Patch Changes

- Updated dependencies [0b1e332]
  - autotel@4.2.2

## 0.4.41

### Patch Changes

- Updated dependencies [38ae023]
  - autotel@4.2.1

## 0.4.40

### Patch Changes

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

- Updated dependencies [ec47ec8]
  - autotel@4.2.0

## 0.4.39

### Patch Changes

- Updated dependencies [12c6b6d]
  - autotel@4.1.0

## 0.4.38

### Patch Changes

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

## 0.4.37

### Patch Changes

- Updated dependencies [db0cce2]
  - autotel@4.0.0

## 0.4.36

### Patch Changes

- Updated dependencies [140fc76]
  - autotel@3.7.0

## 0.4.35

### Patch Changes

- 0e944ed: Add missing license metadata to package manifests.
- Updated dependencies [47a69ac]
  - autotel@3.6.0

## 0.4.34

### Patch Changes

- Updated dependencies [1c43d26]
- Updated dependencies [3ab5dc3]
  - autotel@3.5.0

## 0.4.31

### Patch Changes

- Updated dependencies [bb9a1b7]
  - autotel@3.4.2

## 0.4.30

### Patch Changes

- Updated dependencies [ea2cb4a]
  - autotel@3.4.1

## 0.4.29

### Patch Changes

- Updated dependencies [20a1186]
  - autotel@3.4.0

## 0.4.28

### Patch Changes

- 4ce86fc: Refresh package dependencies across the workspace and keep generated lockfile state in sync.

  Add OTLP/protobuf ingestion support to `autotel-devtools` for traces, logs, and metrics. The devtools HTTP receiver now accepts both OTLP/JSON and OTLP/protobuf payloads on the existing `/v1/traces`, `/v1/logs`, and `/v1/metrics` endpoints, decodes protobuf payloads with embedded OTLP schemas, and includes interop coverage using the OpenTelemetry protobuf serializers.

- Updated dependencies [4ce86fc]
  - autotel@3.3.1

## 0.4.27

### Patch Changes

- Updated dependencies [30a485b]
  - autotel@3.3.0

## 0.4.26

### Patch Changes

- Updated dependencies [9fbbc3a]
  - autotel@3.2.0

## 0.4.25

### Patch Changes

- Updated dependencies [3966db0]
  - autotel@3.1.1

## 0.4.24

### Patch Changes

- Updated dependencies [614d414]
  - autotel@3.1.0

## 0.4.23

### Patch Changes

- Updated dependencies [ee60622]
  - autotel@3.0.7

## 0.4.22

### Patch Changes

- Updated dependencies [8d5d84d]
  - autotel@3.0.6

## 0.4.21

### Patch Changes

- 1a8bedd: Updated dependencies
- Updated dependencies [1a8bedd]
  - autotel@3.0.5

## 0.4.20

### Patch Changes

- Updated dependencies [3a21282]
  - autotel@3.0.4

## 0.4.19

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

## 0.4.18

### Patch Changes

- Updated dependencies [5999cb9]
  - autotel@3.0.2

## 0.4.17

### Patch Changes

- Updated dependencies [5d05a3e]
  - autotel@3.0.1

## 0.4.16

### Patch Changes

- Updated dependencies [b1f3704]
  - autotel@3.0.0

## 0.4.15

### Patch Changes

- dc4908d: Updated deps
- Updated dependencies [dc4908d]
  - autotel@2.26.3

## 0.4.14

### Patch Changes

- Updated dependencies [abe7674]
  - autotel@2.26.2

## 0.4.13

### Patch Changes

- Updated dependencies [dc471ef]
  - autotel@2.26.1

## 0.4.12

### Patch Changes

- 8003fad: feat: migrate autotel-devtools into monorepo and upgrade to TypeScript 6.0
  - migrate `autotel-devtools` (standalone OTLP receiver + Preact web UI) into the monorepo with tsup server build and Vite IIFE widget build
  - add `devtools` support to `autotel.init()` for local `autotel-devtools` usage, including optional embedded startup and shutdown cleanup
  - improve `autotel-web` browser span export behavior by avoiding exporter recursion, feature-detecting `sendBeacon`, and reading HTTP methods from `Request` objects
  - narrow the `autotel-edge` factory marker fix to source code so downstream bundlers do not misoptimize required initializers
  - upgrade all packages to TypeScript 6.0: add `tsconfig.build.json` with `ignoreDeprecations: "6.0"` for tsup DTS generation, add explicit `"types": ["node"]` where missing, set `rootDir` where needed
  - fix Astro docs content collection config for Starlight loader API change
  - fix Playwright version mismatch between autotel-playwright and example-playwright-e2e
  - add `@tanstack/intent` to autotel runtime dependencies (required by published bin)

- Updated dependencies [8003fad]
  - autotel@2.26.0

## 0.4.11

### Patch Changes

- Updated dependencies [f4ac1c3]
  - autotel@2.25.5

## 0.4.10

### Patch Changes

- 2a36104: Add E2E test mode to `auto.ts`: when `E2E=1`, initializes with `InMemorySpanExporter` instead of OTLP and sets `globalThis.__testSpanExporter` for HTTP inspection. Add `createTestSpansHandlers()` and `SerializedSpan` to `autotel-tanstack/testing` for building a zero-boilerplate test-spans HTTP endpoint in Playwright E2E setups.

## 0.4.9

### Patch Changes

- Updated dependencies [32e088f]
  - autotel@2.25.4

## 0.4.8

### Patch Changes

- Updated dependencies [3a5b723]
  - autotel@2.25.3

## 0.4.7

### Patch Changes

- 7d77567: Add opt-in OTLP log export and improve terminal UX.

  **autotel**
  - Add `logs: true` option to `init()` that auto-configures `BatchLogRecordProcessor` + `OTLPLogExporter` from the endpoint — no manual imports needed. Defaults to `false` (opt-in) to preserve existing behavior and upstream `OTEL_LOGS_EXPORTER` handling.
  - Add `resolveLogsFlag()` with `AUTOTEL_LOGS` env var override, matching the `metrics` pattern.
  - Move `@opentelemetry/exporter-logs-otlp-http` and `@opentelemetry/sdk-logs` from optional peer deps to regular dependencies.
  - Export `RedactingLogRecordProcessor` from `posthog-logs.ts` for reuse by the auto-configured log pipeline.

  **autotel-terminal**
  - AI panel: show configuration guidance when no provider is detected; only enter input mode when a provider is available.
  - AI panel: Escape now closes the panel entirely (not just exits input mode).
  - Add `f` key for typeable traceId filter with Tab autocomplete against known trace IDs.
  - Add Tab-to-traceId autocomplete in `/` search mode (4+ character prefix match).
  - Add Escape to exit search mode (in addition to existing `/` toggle and Enter).

- Updated dependencies [7d77567]
  - autotel@2.25.2

## 0.4.6

### Patch Changes

- Updated dependencies [c6010e1]
  - autotel@2.25.1

## 0.4.5

### Patch Changes

- Updated dependencies [04c370a]
  - autotel@2.25.0

## 0.4.4

### Patch Changes

- Updated dependencies [3438fe4]
  - autotel@2.24.1

## 0.4.3

### Patch Changes

- Updated dependencies [88b4eab]
- Updated dependencies [88b4eab]
  - autotel@2.24.0

## 0.4.2

### Patch Changes

- Updated dependencies [65b2fc9]
  - autotel@2.23.1

## 0.4.1

### Patch Changes

- Updated dependencies [eb28f60]
- Updated dependencies [f772504]
  - autotel@2.23.0

## 0.4.0

### Minor Changes

- 1155c72: - **autotel-backends**: Add Grafana backend; export and type updates.
  - **autotel, autotel-\***: Dependency bumps, docs/comment updates, and version alignment across the monorepo.

### Patch Changes

- Updated dependencies [1155c72]
  - autotel@2.22.0

## 0.3.0

### Minor Changes

- c710c71: Add option to hide free/busy times (or selected attributes) in console export and related exporters.

### Patch Changes

- Updated dependencies [c710c71]
  - autotel@2.21.0

## 0.2.1

### Patch Changes

- e57aacb: - Run test body and propagation.inject inside the test span context so trace context is active and W3C headers are correct.
  - On test failure, mark the test span as error and record the exception before rethrowing.
  - Add tests for error recording and context propagation.

## 0.2.0

### Minor Changes

- 6b67787: - **autotel**: Export `getTraceContext`, `isTracing`, `enrichWithTraceContext`, and `resolveTraceUrl` from trace-helpers; export `OtelTraceContext` type; add `resolveTraceUrl(template, traceId)` for trace URL templates (supports `OTEL_TRACE_URL_TEMPLATE` env var); add `autotel/test-span-collector` entry point.
  - **autotel-playwright**: New package. Playwright fixture: one OTel span per test, injects W3C trace context into `page` and `requestWithTrace` for requests to your API; `step()` helper for child spans; optional `autotel-playwright/reporter` for runner-side spans.
  - **autotel-vitest**: New package. Vitest fixture: one OTel span per test so instrumented code under test appears as child spans; optional reporter for suite/test spans; re-exports autotel/testing utilities.

### Patch Changes

- Updated dependencies [6b67787]
  - autotel@2.20.0

## 0.1.0

- Initial release: Playwright fixture that creates one OTel span per test and injects W3C trace context into requests matching `API_BASE_URL` / `AUTOTEL_PLAYWRIGHT_API_ORIGIN`. Exports `test`, `expect`, `createGlobalSetup`, and `AUTOTEL_ATTRIBUTE_ANNOTATION`.

## Unreleased

- **requestWithTrace** fixture: optional fixture that wraps the built-in `request` (APIRequestContext). Requests made with `requestWithTrace.get()`, `.post()`, etc. to URLs matching the API base get trace context and `x-test-name` injected, so Node-side API calls from tests attach to the same test span.
- **step(name, fn)** helper: runs an async function as a named step and creates a child span (`step:${name}`) under the test span for step-level granularity in the same trace.
- **OtelReporter** (`autotel-playwright/reporter`): optional Playwright reporter that creates one span per test and one per step (as children) in the runner process. Use with `reporter: [['list'], [OtelReporter]]` and ensure `init()` is called in globalSetup.
