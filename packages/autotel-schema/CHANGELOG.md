# autotel-schema

## 3.0.0

### Minor Changes

- 4f4f074: Scenario conformance: flow-level contracts with completion boundaries.

  `autotel-schema` gains a `scenarios` section in `defineContract()` — declare which events one exercised flow must emit, their cardinality (`'exactly 1'`, `'at most 3'`, ranges), required ancestor→descendant topology edges, and a first-class completion boundary (`terminal-event`, `root-span-closed`, `externally-reconciled`). `checkScenario()` polls collected spans until the boundary closes, a definitive violation appears, or the observation budget is spent, and returns one of **three** outcomes: `conformant`, `non-conformant`, or `incomplete` — so infrastructure slowness is never reported as behavioural regression. Absence is definitive only after closure; unexpected errors and exceeded `max` cardinality fail fast while the flow is still open; undeclared events are additive (reported, never failing). `proposeScenario()` drafts a contract from N recorded runs (record → propose → commit).

  `autotel` gains `TestSpanCollector.peekTrace(traceId, rootSpanId?)` — a non-destructive read of a trace's finished spans, so a scenario checker can poll while an async flow is still emitting. Its `SerializedSpan` output feeds `checkScenario()` directly.

### Patch Changes

- Updated dependencies [4f4f074]
- Updated dependencies [4f4f074]
  - autotel@4.3.0

## 2.0.5

### Patch Changes

- 3d9e31c: Relicense from MIT to Apache-2.0. The `license` field now reads `Apache-2.0`, and the package ships the Apache-2.0 `LICENSE`. This changes the licence only; there are no API changes. Prior releases remain available under their original MIT terms. See `NOTICE` and `TRADEMARKS.md` in the repository root for attribution and the "autotel" trademark policy.
- Updated dependencies [3d9e31c]
  - autotel@4.2.5

## 2.0.4

### Patch Changes

- Updated dependencies [4b7ad78]
  - autotel@4.2.4

## 2.0.3

### Patch Changes

- Updated dependencies [830b6a4]
  - autotel@4.2.3

## 2.0.2

### Patch Changes

- Updated dependencies [0b1e332]
  - autotel@4.2.2

## 2.0.1

### Patch Changes

- Updated dependencies [38ae023]
  - autotel@4.2.1

## 2.0.0

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

## 1.0.0

### Patch Changes

- Updated dependencies [12c6b6d]
  - autotel@4.1.0

## 0.2.0

### Minor Changes

- 4cd08bf: Add **`autotel-schema`**, a typed, versioned contract for your telemetry surface.
  With `autotel-pact` (evidence that contracted interactions actually ran) it forms
  autotel's core observability-contract pair. Both use telemetry to answer a
  contract question. `autotel-schema` is the telemetry contract you emit (span
  names + attributes).

  When the main reader of your telemetry is an agent, your span names and
  attribute keys are a public API. This package makes that surface explicit,
  typed, and versionable. The contract model is dependency-free, with no
  OpenTelemetry SDK required (the processor uses structural span types).
  - `defineContract({ service, version, spans, commonAttributes })`: declare the
    spans/attributes your service emits; validated and frozen at load.
  - `validateSpan(span, contract)` and `createSchemaValidationProcessor({ contract, mode })`:
    validate live spans (`missing_required`, `type_mismatch`, `enum_violation`,
    `unknown_attribute` with "did you mean?", `unknown_span`). Fail-open; bounded,
    deduped warnings; off in production unless opted in.
  - `contractToSnapshot`, `serializeSnapshot`, `diffSnapshots`, `hasBreakingChanges`,
    and the `autotel-schema` CLI (`diff` / `check`): gate breaking trace-surface
    changes in CI.
  - `highCardinalityKeys(contract)`: feed a redaction allow-list so the
    high-cardinality fields an agent reader needs survive.
