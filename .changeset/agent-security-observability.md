---
'autotel-audit': minor
'autotel': minor
'autotel-cli': minor
'autotel-genai': minor
'autotel-mcp-instrumentation': minor
'autotel-cloudflare': minor
'autotel-schema': minor
'autotel-devtools': minor
'autotel-adapters': patch
'autotel-backends': patch
'autotel-drizzle': patch
'autotel-edge': patch
'autotel-eventcatalog': patch
'autotel-hono': patch
'autotel-mcp': patch
'autotel-message-contract': patch
'autotel-mongoose': patch
'autotel-pact': patch
'autotel-playwright': patch
'autotel-plugins': patch
'autotel-sentry': patch
'autotel-subscribers': patch
'autotel-tanstack': patch
'autotel-terminal': patch
'autotel-vitest': patch
'autotel-web': patch
---

Google Secure AI Agents observability plus MCP protocol-boundary security observability — additive defense-in-depth across planning, tool use, MCP traffic, triage, and UI surfaces.

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
