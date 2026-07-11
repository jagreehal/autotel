# autotel-message-contract

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

## 1.0.0

### Patch Changes

- Updated dependencies [12c6b6d]
  - autotel@4.1.0

## 0.2.0

### Minor Changes

- 4cd08bf: Add **`autotel-message-contract`**, brokerless message contract testing. An
  optional, standalone, test-time package adjacent to autotel's
  observability-contract pair (`autotel-schema`, the telemetry contract you emit;
  `autotel-pact`, evidence that contracted interactions actually ran). It extends
  the idea beyond telemetry to serialized payload compatibility across versions,
  and needs no runtime observability to be useful (`autotel` is an optional peer).

  Pin the serialized shape of the messages your code sends and stores (events,
  commands, queue payloads, HTTP bodies) and prove old and new versions stay
  compatible, as ordinary unit tests with the contract committed as an approved
  file beside the test. No broker, no schema registry, nothing to run in Docker.
  - `messageContract().given(msg).whenSerialized().thenContractIsUnchanged()`:
    snapshot the serialized output using your app's own serializer; fail with a
    diff when the shape drifts. Update with `AUTOTEL_CONTRACT_UPDATE=1`.
  - `.whenDeserializedAs(reader).thenBackwardCompatible()` / `.thenForwardCompatible()`:
    prove a newer reader still reads older bytes, and a reader is a
    Standard Schema (Zod/Valibot/ArkType) or a plain parse function.
  - `autotel-message-contract/serializer`: the `MessageSerializer` interface and a
    deterministic `jsonSerializer`; pass your own to pin the exact bytes you ship.

  The package covers message serialization only. For type or API surface pinning,
  use a dedicated tool like api-extractor.
