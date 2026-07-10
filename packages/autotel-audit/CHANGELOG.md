# autotel-audit

## 0.4.3

### Patch Changes

- Updated dependencies [830b6a4]
  - autotel@4.2.3

## 0.4.2

### Patch Changes

- Updated dependencies [0b1e332]
  - autotel@4.2.2

## 0.4.1

### Patch Changes

- Updated dependencies [38ae023]
  - autotel@4.2.1

## 0.4.0

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

## 0.3.2

### Patch Changes

- Updated dependencies [12c6b6d]
  - autotel@4.1.0

## 0.3.1

### Patch Changes

- Updated dependencies [db0cce2]
  - autotel@4.0.0

## 0.3.0

### Minor Changes

- 140fc76: Best-effort agent/audit instrumentation, OpenTelemetry-portable context, and LLM telemetry
  - **Best-effort by default — observability never throws into business logic.**
    `withAudit`, `withAgentAction`, `withAgentToolCall`, `recordPolicyDecision`, and
    `securityEvent` / `withSecurity` no longer throw when there is no active trace
    context. A new `onMissingContext: 'throw' | 'warn' | 'skip'` option (default
    `'warn'`) controls the behaviour: run the handler un-audited and warn once, run
    silently, or opt back into fail-fast. This makes the 0.x agent layer safe to
    drop into a production hot path with no surrounding `trace()` and no `try`/`catch`.
  - **OpenTelemetry-portable context.** `autotel-agent` / `autotel-audit` resolve
    trace context from any active OpenTelemetry span, not only inside autotel's own
    `trace()`. The wrappers now compose inside `@effect/opentelemetry`, a vanilla
    NodeSDK, and `autotel-cloudflare`-instrumented `fetch` handlers and Cloudflare
    **Workflows** (`instrumentWorkflow` `step.do` callbacks).
  - **LLM cost & token telemetry (autotel-agent).** Agent actions / tool calls can
    carry `ai` metadata (`{ model, operation?, usage?, finishReasons?, pricing? }`);
    autotel-agent records OpenTelemetry GenAI attributes (`gen_ai.request.model`,
    `gen_ai.usage.{input,output,total}_tokens`, and the estimated
    `gen_ai.usage.cost.usd`) reusing `estimateLLMCost` / `MODEL_PRICING` from the
    main `autotel` package. `options.extractUsage(result)` pulls token counts from
    the handler result.
  - **Cloudflare Workflow context propagation (autotel-edge).**
    `WorkerTracerProvider.register()` now registers its AsyncLocalStorage context
    manager with the global OpenTelemetry API (`setGlobalContextManager`). Without
    this the active span was lost after the first `await`, so `trace.getActiveSpan()`
    returned `undefined` inside handlers / Workflow steps — the root cause of
    agent/audit failing to compose there.
  - **Workers-idiomatic `node:` imports.** `autotel-agent` and `autotel-audit` keep
    the `node:` prefix on built-in imports (e.g. `node:crypto`) in their published
    bundles, so they no longer silently rely on the Workers `nodejs_compat` alias.
  - **New `autotel` helpers:** `getRequestLoggerSafe()` (returns the request logger
    or `null` instead of throwing), `createNoopRequestLogger()`, and
    `hasRequestContext()`.

### Patch Changes

- Updated dependencies [140fc76]
  - autotel@3.7.0

## 0.2.1

### Patch Changes

- Updated dependencies [47a69ac]
  - autotel@3.6.0

## 0.2.0

### Minor Changes

- 1c43d26: Add typed security events (OWASP A09-aligned): `securityEvent()`, `withSecurity()`, `hashIdentifier()`, and a zero-code `createSecuritySignalProcessor()`.

  Security events emit a stable `security.*` attribute schema (`security.event`, `security.category`, `security.outcome`, `security.severity`), are exempt from tail sampling by default, never emit values under credential-shaped keys (reusing autotel core's `REDACTOR_PATTERNS.sensitiveKey`), and feed the `autotel.security.events` counter so security teams can alert on rates. `hashIdentifier()` provides stable one-way digests so PII-bearing identifiers (emails, IPs) can be correlated across events without being logged raw.

  `createSecuritySignalProcessor()` derives security signals from existing HTTP spans with no per-route code: flags suspicious request paths (traversal, `.env`/`.git` probes, SQLi/XSS probes) and force-keeps them through tail sampling, counts denied responses (401/403/429) into `autotel.security.http.denied`, and detects per-client auth-failure bursts via a bounded sliding window (`autotel.security.anomaly` + `onSignal` callback).

### Patch Changes

- Updated dependencies [1c43d26]
- Updated dependencies [3ab5dc3]
  - autotel@3.5.0

## 0.1.14

### Patch Changes

- Updated dependencies [bb9a1b7]
  - autotel@3.4.2

## 0.1.13

### Patch Changes

- Updated dependencies [ea2cb4a]
  - autotel@3.4.1

## 0.1.12

### Patch Changes

- Updated dependencies [20a1186]
  - autotel@3.4.0

## 0.1.11

### Patch Changes

- 4ce86fc: Refresh package dependencies across the workspace and keep generated lockfile state in sync.

  Add OTLP/protobuf ingestion support to `autotel-devtools` for traces, logs, and metrics. The devtools HTTP receiver now accepts both OTLP/JSON and OTLP/protobuf payloads on the existing `/v1/traces`, `/v1/logs`, and `/v1/metrics` endpoints, decodes protobuf payloads with embedded OTLP schemas, and includes interop coverage using the OpenTelemetry protobuf serializers.

- Updated dependencies [4ce86fc]
  - autotel@3.3.1

## 0.1.10

### Patch Changes

- Updated dependencies [30a485b]
  - autotel@3.3.0

## 0.1.9

### Patch Changes

- Updated dependencies [9fbbc3a]
  - autotel@3.2.0

## 0.1.8

### Patch Changes

- Updated dependencies [3966db0]
  - autotel@3.1.1

## 0.1.7

### Patch Changes

- Updated dependencies [614d414]
  - autotel@3.1.0

## 0.1.6

### Patch Changes

- Updated dependencies [ee60622]
  - autotel@3.0.7

## 0.1.5

### Patch Changes

- Updated dependencies [8d5d84d]
  - autotel@3.0.6

## 0.1.4

### Patch Changes

- 1a8bedd: Updated dependencies
- Updated dependencies [1a8bedd]
  - autotel@3.0.5

## 0.1.3

### Patch Changes

- Updated dependencies [3a21282]
  - autotel@3.0.4

## 0.1.2

### Patch Changes

- Updated dependencies [5e146a7]
  - autotel@3.0.3

## 0.1.1

### Patch Changes

- 5999cb9: Add audit logging capabilities and enhance documentation:
  - **New `autotel-audit` package**: Structured audit logging with compliance-ready features
    - `withAudit()` for wrapping operations with audit metadata and automatic outcome tagging
    - `forceKeepAuditEvent()` to bypass tail-drop sampling for critical audit trails
    - `setAuditAttributes()` for normalized `audit.*` span attributes
    - Type-safe metadata schemas and backend integration support
  - **Documentation enhancements**:
    - Comprehensive integration guide for audit logging
    - Framework-specific setup examples (Express, Fastify, NestJS, Next.js, TanStack)
    - API reference with compliance and sampling strategies
    - Updated documentation site navigation
  - **Runtime helpers and edge improvements**: Enhanced execution logging and request handling across edge runtimes and frameworks

- Updated dependencies [5999cb9]
  - autotel@3.0.2
