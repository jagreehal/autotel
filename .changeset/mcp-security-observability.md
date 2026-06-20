---
'autotel-mcp-instrumentation': minor
'autotel-cli': minor
'autotel': minor
'autotel-cloudflare': minor
---

Add MCP security observability and CLI investigation — the protocol-boundary half of the agentic-web defense-in-depth model (aligned with Chrome/Google's WebMCP security guidance). All additive, dependency-free, and off-by-default where it could be noisy.

**autotel-mcp-instrumentation**

- **Annotation hints** captured as `mcp.tool.*` span attributes (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`, `untrustedContentHint`) — surfaces the "malicious manifest" vector and a tool's trust profile.
- **Payload-size signals** (`mcp.tool.arguments.size` / `mcp.tool.result.size`) for token-exhaustion / contaminated-output detection (sizes only, no content).
- **Output character budgets** (`outputCharBudget` + `MCP_CHAR_BUDGETS`) that emit a `mcp.security.budget_exceeded` event when tool output overflows.
- **Pluggable injection classifier** (`securityClassifier`) scanning arguments (server + client) and results (the contaminated-output vector), recording `mcp.security.injection.*` signals + a `mcp.security.injection_suspected` event. Failures never break the traced call.
- **`heuristicInjectionClassifier()`** — a dependency-free first-pass detector.
- **`spotlight()`** — delimit/base64 untrusted-content demarcation helper (runtime-agnostic: `Buffer`→`btoa` fallback, runs on Workers/edge).
- **`validateToolBudget()`** — check a tool's text surface against WebMCP limits.
- **Guard bridge** — a `guard` config option (duck-typed `GuardLike`, no genai dependency) records each tool call as a step against an `autotel-genai` guard, so the kill-switch enforces against MCP traffic (detection → enforcement).
- New `mcp.security.events` counter and `autotel-mcp-instrumentation/security` subpath export.

**autotel-cli**

- Add `autotel security mcp` — aggregates the MCP protocol-boundary security signals emitted by `autotel-mcp-instrumentation`: prompt-injection classifier verdicts (`mcp.security.injection.*`), output character-budget breaches (`mcp.security.budget.exceeded`), and untrusted-content tool calls (`mcp.tool.untrusted_content`). Returns injection counts by verdict/source/tool, budget breaches by tool, and untrusted-content tool-call totals — one JSON document, same backend model as the other `investigate` commands.
