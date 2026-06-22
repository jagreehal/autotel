# autotel-cloudflare

## 4.0.3

### Patch Changes

- Updated dependencies [e2ed007]
  - autotel-genai@0.3.3

## 4.0.2

### Patch Changes

- Updated dependencies [0b1e332]
  - autotel-genai@0.3.2

## 4.0.1

### Patch Changes

- autotel-genai@0.3.1

## 4.0.0

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
  - autotel-genai@0.3.0
  - autotel-edge@3.17.1

## 3.1.0

### Minor Changes

- 12c6b6d: Add MCP security observability and CLI investigation — the protocol-boundary half of the agentic-web defense-in-depth model (aligned with Chrome/Google's WebMCP security guidance). All additive, dependency-free, and off-by-default where it could be noisy.

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

## 3.0.0

### Minor Changes

- ae90c02: feat(cloudflare): seamless integration with Cloudflare native tracing

  `trace()` / `span()` / `enterSpan()` now automatically nest inside Cloudflare's
  native trace waterfall when a Worker has native tracing enabled
  (`observability.traces.enabled`), and Cloudflare exports them to your configured
  destination — no exporter code, no duplicate binding spans. autotel falls back
  to its own OTLP pipeline on other runtimes, when native tracing is off, or
  locally (e.g. streaming to autotel-devtools).
  - **autotel-edge**: new runtime-agnostic native-tracing seam
    (`withNativeTracer` / `getActiveNativeTracer`, `NativeTracer` /
    `NativeSpanHandle`), a new `enterSpan(name, cb)` convenience, and a
    `nativeTracing: 'auto' | 'on' | 'off'` config option (default `'auto'`).
  - **autotel-cloudflare**: auto-detects `ctx.tracing`, wires it into the handler
    wrappers (`instrument` / `wrapModule` / `defineWorkerFetch` /
    `wrapDurableObject`), and defers binding instrumentation + export to the
    platform when native tracing is active. New `autotel-cloudflare/native` entry
    exporting `isNativeTracingAvailable` / `getNativeTracerFromCtx`.

  See `docs/CLOUDFLARE-NATIVE-TRACING.md`.

### Patch Changes

- Updated dependencies [ae90c02]
- Updated dependencies [ae90c02]
  - autotel-edge@3.17.0

## 2.19.0

### Minor Changes

- db0cce2: **BREAKING:** Move all GenAI / LLM instrumentation out of core `autotel` into the
  dedicated **`autotel-genai`** package (published separately), which emits the
  canonical OpenTelemetry GenAI semantic conventions (`gen_ai.*`, semconv v1.42.0).
  Core `autotel` is now generic and AI-free.

  Removed from `autotel`:
  - `traceLLM` / `LLMConfig` (from `autotel` and `autotel/semantic-helpers`).
  - `estimateLLMCost`, `recordLLMCost`, `MODEL_PRICING`, `GEN_AI_COST_ATTRIBUTE`,
    `ModelPricing`, `TokenUsage`, `EstimateCostOptions`.
  - `genAiMetricViews`, `llmHistogramAdvice`, `GEN_AI_DURATION_BUCKETS_SECONDS`,
    `GEN_AI_TOKEN_USAGE_BUCKETS`, `GEN_AI_COST_USD_BUCKETS`.
  - `recordPromptSent`, `recordResponseReceived`, `recordRetry`, `recordToolCall`,
    `recordStreamFirstToken` and their event types.
  - The `genAI` attribute builder, `GenAIAttributes`, and the `GenAIAttrs` type
    (these used a non-spec `gen.ai.*` namespace and are not carried over).

  `traceDB`, `traceHTTP`, and `traceMessaging` remain in core.

  **Migration:** install `autotel-genai` and update imports — attribute names are
  now canonical (`gen_ai.*`, `input_tokens`/`output_tokens`, `gen_ai.provider.name`):

  ```diff
  - import { traceLLM, recordLLMCost, genAiMetricViews } from 'autotel';
  + import { traceGenAI } from 'autotel-genai/trace';
  + import { recordLLMCost } from 'autotel-genai/cost';
  + import { genAiMetricViews } from 'autotel-genai/metrics';
  ```

  Agent identity/delegation/policy/audit helpers (formerly the `autotel-agent`
  package) now live in `autotel-genai/agent`.

  **`autotel-cloudflare`:** the Workers AI binding now emits the canonical
  `gen_ai.provider.name` (`cloudflare-workers-ai`) instead of the deprecated
  `gen_ai.system`.

## 2.18.19

### Patch Changes

- Updated dependencies [140fc76]
  - autotel-edge@3.16.15

## 2.18.18

### Patch Changes

- 3ab5dc3: chore: update dependencies + migrate workspace to vite 8

  Routine dependency refresh via npm-check-updates (3-day publish cooldown).
  - **Dev tooling:** vitest 4.1.8, `@types/node`, tsx, typescript-eslint 8.60.1, eslint 10.4.1, svelte 5.56, storybook 10.4.2, etc.
  - **Runtime/peer (published packages):** aws-sdk 3.1063, `@tanstack/{react,solid}-start` 1.168.25, hono 4.12.23, `@sentry/node` 10.56, `@cloudflare/workers-types`, react 19.2.7, ai-sdk / ai 6.0.197, `@traceloop/node-server-sdk` 0.27, google-auth-library 10.7, protobufjs 8.6, svelte 5.56.

  **Vite 8:** forced `vite ^8` across the workspace via a pnpm override. autotel was already partly on vite 8 (`@sveltejs/vite-plugin-svelte` 7 and `@vitejs/plugin-react` 6 both require it); storybook (svelte-vite), the astro docs, and the tanstack-start example all build cleanly on vite 8.

  eslint is held at `^9` in `apps/example-nextjs` (a private example) — `eslint-config-next` 16 / `eslint-plugin-react` are not yet eslint-10 compatible. Published packages are unaffected.

## 2.18.15

### Patch Changes

- 4ce86fc: Refresh package dependencies across the workspace and keep generated lockfile state in sync.

  Add OTLP/protobuf ingestion support to `autotel-devtools` for traces, logs, and metrics. The devtools HTTP receiver now accepts both OTLP/JSON and OTLP/protobuf payloads on the existing `/v1/traces`, `/v1/logs`, and `/v1/metrics` endpoints, decodes protobuf payloads with embedded OTLP schemas, and includes interop coverage using the OpenTelemetry protobuf serializers.

- Updated dependencies [4ce86fc]
  - autotel-edge@3.16.12

## 2.18.14

### Patch Changes

- 8d5d84d: Clarify edge vs Node entry points and tighten Cloudflare logger packaging.
  - **`autotel-cloudflare`**: Move `autotel-edge` to a required peer dependency (devDependency for this package’s tests) so Workers apps declare the edge foundation explicitly. Import execution-logger helpers from `autotel-edge/logger` instead of the root export. Document a logs-only quickstart via `autotel-cloudflare/logger`, a `nodejs_compat` compatibility matrix per subpath, and cross-links to related packages.
  - **`autotel-edge`**: Re-export `TraceContext` from `autotel-edge/logger` for execution-logger consumers. Add See also links in the README.
  - **`autotel-drizzle`**: Document Drizzle `>= 0.45.2` peer requirement, Node-only scope, and D1-on-Workers guidance via `autotel-cloudflare/bindings`. Add See also links.
  - **`autotel`**: Add an entry-point map (Node vs Cloudflare vs edge) and See also links in the README.

- Updated dependencies [8d5d84d]
  - autotel-edge@3.16.11

## 2.18.12

### Patch Changes

- 1a8bedd: Updated dependencies
- Updated dependencies [1a8bedd]
  - autotel-edge@3.16.10

## 2.18.11

### Patch Changes

- Updated dependencies [3a21282]
  - autotel-edge@3.16.9

## 2.18.10

### Patch Changes

- 5e146a7: Streamline package surface and align skills with the [Agent Skills specification](https://agentskills.io/specification).
  - Drop `@tanstack/intent` from runtime and dev dependencies, plus the auto-generated `bin/intent.js` shims. Skills still ship under each package's `skills/` directory and are discovered by spec-compliant agents (Claude Code, Cursor, Cline, etc.) via filesystem scan — no consumer-side CLI required.
  - Remove the `autotel/workers` and `autotel/cloudflare` entry points from `autotel`. Cloudflare Workers users should import directly from `autotel-cloudflare` (and its `/logger`, `/sampling`, `/events` subpaths). `autotel` no longer peer-depends on `autotel-cloudflare` or `autotel-edge`.
  - Strip non-spec frontmatter (`type`, `library`, `library_version`, `sources`, `requires`) from all `SKILL.md` files; keep only spec-defined fields (`name`, `description`, optional `license`).
  - Move user-facing skills (`migrate-to-autotel`, `tune-sampling`, `debug-missing-spans`, `build-audit-trails`) into `packages/autotel/skills/` so consumers receive them automatically via npm. Contributor-only skills (`create-autotel-adapter`, `create-autotel-instrumentation`, `create-autotel-exporter`) remain under the repo-root `skills/` directory.
  - Realign `autotel`'s peer dependency ranges to match published versions on npm.
  - Release workflow now refreshes `pnpm-lock.yaml` after `changeset version` so the next Version Packages PR ships with a consistent lockfile.

- Updated dependencies [5e146a7]
  - autotel-edge@3.16.8

## 2.18.9

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
  - autotel-edge@3.16.7

## 2.18.8

### Patch Changes

- 5d05a3e: Add Cloudflare Workers support to main `autotel` package. Introduces `autotel/workers` and `autotel/cloudflare` entry points that re-export the functional API and Cloudflare-specific instrumentation from `autotel-cloudflare`, providing better DX for Cloudflare users while keeping the core package modular. Updates package exports, build config, and documentation.
- Updated dependencies [5d05a3e]
  - autotel-edge@3.16.6

## 2.18.7

### Patch Changes

- dc4908d: Updated deps
- Updated dependencies [dc4908d]
  - autotel-edge@3.16.5

## 2.18.6

### Patch Changes

- b764a97: Added web api headers get

## 2.18.5

### Patch Changes

- dc471ef: Enhanced request logger with fork support for async background work, execution logger for edge runtimes, structured errors with internal context, init locking for framework plugins, silent/minLevel logging, and attribute redaction for PII compliance.
- Updated dependencies [dc471ef]
  - autotel-edge@3.16.4

## 2.18.4

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
  - autotel-edge@3.16.3

## 2.18.3

### Patch Changes

- 91f6468: Modified module wrapper

## 2.18.2

### Patch Changes

- Updated dependencies [e6ef4e6]
  - autotel-edge@3.16.2

## 2.18.1

### Patch Changes

- Updated dependencies [99a8d84]
  - autotel-edge@3.16.1

## 2.18.0

### Minor Changes

- 04c370a: This release rolls out a monorepo-wide refresh across the Autotel package family with coordinated minor updates.

  Highlights:
  - Align package internals and workspace metadata for the next release wave.
  - Improve reliability of test and quality workflows used across packages.
  - Keep package behavior and public APIs consistent while shipping incremental enhancements across the ecosystem.

### Patch Changes

- Updated dependencies [04c370a]
  - autotel-edge@3.16.0

## 2.17.1

### Patch Changes

- 65b2fc9: - Bug fixes and dependency updates across packages.
  - example-vitest: API tests use a random port (when `API_BASE_URL`/`PORT` unset) to avoid EADDRINUSE on port 3000.
- Updated dependencies [65b2fc9]
  - autotel-edge@3.15.1

## 2.17.0

### Minor Changes

- eb28f60: **autotel**
  - **Request logger**: `getRequestLogger(ctx?, options?)` with `set()`, `info()`, `warn()`, `error()`, `getContext()`, and `emitNow(overrides?)`. Optional `onEmit` callback for manual fan-out. Writes to span attributes/events so canonical log lines still emit one wide event per request.
  - **Structured errors**: `createStructuredError()`, `getStructuredErrorAttributes()`, `recordStructuredError()`. Supports `message`, `why`, `fix`, `link`, `code`, `status`, `cause`, `details`.
  - **parseError**: `parseError(error)` returns `{ message, status, why?, fix?, link?, code?, details?, raw }` for frontend/API consumers. Export from main entry and `autotel/parse-error`.
  - **Drain pipeline**: `createDrainPipeline()` for batching, retry with backoff, flush, and shutdown. Use with `canonicalLogLines.drain`. Export from main entry and `autotel/drain-pipeline`.
  - **Canonical log lines**: `shouldEmit`, `drain`, `onDrainError`, `keep` (declarative tail sampling), and `pretty` (tree-formatted dev output) options. Adds `duration` (formatted) field alongside `duration_ms`. Respects `autotel.log.level` span attribute for explicit level. New types `CanonicalLogLineEvent`, `KeepCondition`.
  - **formatDuration**: `formatDuration(ms)` formats milliseconds as human-readable strings (`45ms`, `1.2s`, `1m 5s`).

### Patch Changes

- Updated dependencies [eb28f60]
  - autotel-edge@3.15.0

## 2.16.0

### Minor Changes

- 37190fd: **autotel-cloudflare**
  - Bindings instrumentation: add caching and fix `this` binding for wrapped proxies
  - Improve bindings coverage for AI, Vectorize, Hyperdrive, Queue Producer, Analytics Engine, Images, Rate Limiter, and Browser Rendering
  - Enhance instrument wrapper and fetch instrumentation
  - Add bindings cache and this-binding tests

  **autotel-edge**
  - Add `DataSafetyConfig` for sensitive attribute control: `redactQueryParams`, `captureDbStatement` (D1 SQL: full/obfuscated/off), `emailHeaderAllowlist`

### Patch Changes

- Updated dependencies [37190fd]
  - autotel-edge@3.14.0

## 2.15.0

### Minor Changes

- 1155c72: - **autotel-backends**: Add Grafana backend; export and type updates.
  - **autotel, autotel-\***: Dependency bumps, docs/comment updates, and version alignment across the monorepo.

### Patch Changes

- Updated dependencies [1155c72]
  - autotel-edge@3.13.0

## 2.14.0

### Minor Changes

- 32e3cd9: Add first-class Cloudflare Workflows instrumentation.
  - `autotel-edge` now exports `WorkflowTrigger` and includes it in the `Trigger` union.
  - `autotel-cloudflare` `instrumentWorkflow()` now passes a workflow trigger into config resolution and emits spans for `run`, `step.do`, and `step.sleep` with `workflow.instance_id` and cold start attributes.

### Patch Changes

- Updated dependencies [32e3cd9]
  - autotel-edge@3.12.0

## 2.13.0

### Minor Changes

- c558982: Add full Cloudflare native observability parity.
  - **New binding instrumentations**: AI, Vectorize, Hyperdrive, Queue Producer, Analytics Engine, Images, Rate Limiter, and Browser Rendering
  - **`setAttr()` helper**: Guards against undefined/null attribute values when setting span attributes
  - **Auto-detection rewrite**: Uses `hasExactMethods()` and `isWrapped()` guards with most-specific-first ordering (fixes R2/KV detection bug)
  - **`extractCfAttributes()`**: Extracts 14 `cloudflare.*` request attributes (colo, ray_id, geo, ASN, TLS, etc.)
  - **Exports**: Explicit named exports for tree-shaking
  - **Tests**: 88 new tests (173 total)

## 2.12.0

### Minor Changes

- c710c71: Add option to hide free/busy times (or selected attributes) in console export and related exporters.

### Patch Changes

- Updated dependencies [c710c71]
  - autotel-edge@3.11.0

## 2.11.0

### Minor Changes

- d1bd8cd: - **autotel-sentry**: README updates : clarify Sentry SDK + OTel scenario, link to Sentry OTLP docs, note that Sentry ingestion request spans are not sent, fix `SentrySpanProcessor` backtick typo, add spec-volatility note.
  - **autotel-backends**: Preserve caught error in Google Cloud config : attach original error as `cause` when throwing the user-facing error so the `preserve-caught-error` lint rule is satisfied.

### Patch Changes

- Updated dependencies [d1bd8cd]
  - autotel-edge@3.10.0

## 2.10.1

### Patch Changes

- ecf920e: Add OpenTelemetry MCP semantic conventions and operation duration metrics.

  **autotel-mcp**
  - New subpath export `autotel-mcp/semantic-conventions`: `MCP_SEMCONV`, `MCP_METHODS`, `MCP_METRICS`, `MCP_DURATION_BUCKETS` per [OTel MCP semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/).
  - New subpath export `autotel-mcp/metrics`: `recordClientOperationDuration`, `recordServerOperationDuration` for client/server operation duration histograms.
  - Server and client instrumentation updated to use the semantic conventions for span attributes and to record operation duration metrics.

  **Example apps** (`example-mcp-client`, `example-mcp-server`, `awaitly-example`) updated to use the new conventions and metrics.

  **Dependency updates** (from npm-check-updates)
  - ESLint: `@eslint/js` 10.0.1, `eslint` 10.0.0.
  - `dotenv` 17.2.4.
  - `@types/node` 25.2.2 across multiple packages.
  - `@aws-sdk` clients, `mongoose`, `@modelcontextprotocol/sdk` updated for compatibility and latest features.
  - Peer dependencies adjusted in `autotel-cloudflare` and `autotel-mcp` to match latest versions.

- Updated dependencies [ecf920e]
  - autotel-edge@3.9.1

## 2.10.0

### Minor Changes

- c68a580: - **autotel**: Add correlation ID support for event-driven observability (stable join key across events, logs, and spans via AsyncLocalStorage; optional baggage propagation). Add events configuration for `init()`: `includeTraceContext`, `traceUrl`, and baggage enrichment with allow/deny and transforms. Event queue and event subscriber now attach correlation ID and trace context to events. New `autotel/correlation-id` and `autotel/events-config` types used internally; init accepts `events` option.
  - **autotel-subscribers**: EventSubscriber base class and adapters (PostHog, Mixpanel, Amplitude) updated to use `autotel/event-subscriber` types and AutotelEventContext; graceful shutdown and payload normalization aligned with new event context and correlation ID.
  - **autotel-edge**, **autotel-cloudflare**, **autotel-aws**, **autotel-backends**, **autotel-tanstack**, **autotel-terminal**, **autotel-plugins**, **autotel-cli**, **autotel-mcp**, **autotel-web**: Version bumps for compatibility with autotel core.

### Patch Changes

- Updated dependencies [c68a580]
  - autotel-edge@3.9.0

## 2.9.1

### Patch Changes

- acfd0de: Add comprehensive test coverage for Datadog backend configuration, including validation, direct cloud ingestion, agent mode, and OTLP logs export functionality.
- Updated dependencies [acfd0de]
  - autotel-edge@3.8.1

## 2.9.0

### Minor Changes

- 47c70fb: Update dependencies across all packages:
  - **OpenTelemetry**: Update to v2.5.0 (core packages) and v0.211.0 (SDK packages)
  - **AWS SDK**: Update all client packages from v3.972.0 to v3.975.0
  - **TypeScript ESLint**: Update from v8.53.1 to v8.54.0
  - **Turbo**: Update from v2.7.5 to v2.7.6
  - **Vitest**: Update from v4.0.17 to v4.0.18
  - **@types/node**: Update from v25.0.9 to v25.0.10
  - **Cloudflare Workers Types**: Update from v4.20260120.0 to v4.20260124.0

### Patch Changes

- Updated dependencies [47c70fb]
  - autotel-edge@3.8.0

## 2.8.2

### Patch Changes

- Updated dependencies [8256dac]
  - autotel-edge@3.7.0

## 2.8.1

### Patch Changes

- 3e12422: Update dependencies across all packages:
  - OpenTelemetry packages: 0.208.0 → 0.210.0
  - OpenTelemetry SDK packages: 2.2.0 → 2.4.0
  - import-in-the-middle: 2.0.1 → 2.0.4
  - pino: 10.1.0 → 10.1.1
  - TypeScript ESLint: 8.52.0 → 8.53.0
  - vitest: 4.0.16 → 4.0.17
  - @types/node: 25.0.3 → 25.0.8
- Updated dependencies [3e12422]
  - autotel-edge@3.6.1

## 2.8.0

### Minor Changes

- 8831cf8: Add canonical log lines (wide events) feature to automatically emit spans as comprehensive log records. Implements the "canonical log line" pattern: one log line per request with all context, making logs queryable as structured data instead of requiring string search.

  **autotel:**
  - New `canonicalLogLines` option in `init()` config
  - `CanonicalLogLineProcessor` for automatic span-to-log conversion
  - Supports root spans only, custom message format, min level filtering
  - Works with any logger (Pino, Winston) or OTel Logs API
  - Attribute redaction support for sensitive data

### Patch Changes

- Updated dependencies [8831cf8]
  - autotel-edge@3.6.0

## 2.7.0

### Minor Changes

- 723c889: ### autotel-terminal
  - Improve keyboard input handling with stdin detection for better compatibility in non-TTY environments
  - Add unique React keys to prevent rendering conflicts when spans have duplicate IDs
  - Gracefully handle environments where raw mode is not supported

  ### autotel-cloudflare
  - Update `@cloudflare/workers-types` dependency to latest version

  ### autotel-subscribers
  - Update `@cloudflare/workers-types` dependency to latest version

## 2.6.0

### Minor Changes

- e5337b0: Add new span processors, exporters, terminal dashboard, and type-safe attributes module

  **autotel:**
  - Add `PrettyConsoleExporter` for colorized, hierarchical trace output in the terminal
  - Add `FilteringSpanProcessor` for filtering spans by custom criteria
  - Add `SpanNameNormalizer` for normalizing span names (removing IDs, hashes, etc.)
  - Add `AttributeRedactingProcessor` for redacting sensitive span attributes
  - Export new processors via `autotel/processors` and `autotel/exporters`
  - Add new `autotel/attributes` module with type-safe attribute helpers:
    - Key builders: `attrs.user.id()`, `attrs.http.method()`, etc.
    - Object builders: `attrs.user.data()`, `attrs.db.client.data()`, etc.
    - Attachers: `setUser()`, `httpServer()`, `identify()`, `setError()`, etc.
    - PII guardrails: `safeSetAttributes()` with redaction, hashing, and validation
    - Domain helpers: `transaction()` for business transactions
    - Resource merging: `mergeServiceResource()` for enriching resources
  - Fix ESLint config to disable `unicorn/number-literal-case` (conflicts with Prettier)

  **autotel-terminal (new package):**
  - React-ink powered terminal dashboard for viewing traces in real-time
  - Live span streaming with pause/resume functionality
  - Error filtering and statistics display
  - Auto-wires to existing tracer provider

  **autotel-subscribers:**
  - Fix `AmplitudeSubscriber` to correctly use Amplitude SDK pattern where `init()`, `track()`, and `flush()` are separate module exports

  **Examples:**
  - Add Next.js example app
  - Add TanStack Start example app

### Patch Changes

- Updated dependencies [e5337b0]
  - autotel-edge@3.5.0

## 2.6.0

### Minor Changes

- 86ae1a8: Add new span processors, exporters, and terminal dashboard

  **autotel:**
  - Add `PrettyConsoleExporter` for colorized, hierarchical trace output in the terminal
  - Add `FilteringSpanProcessor` for filtering spans by custom criteria
  - Add `SpanNameNormalizer` for normalizing span names (removing IDs, hashes, etc.)
  - Add `AttributeRedactingProcessor` for redacting sensitive span attributes
  - Export new processors via `autotel/processors` and `autotel/exporters`

  **autotel-terminal (new package):**
  - React-ink powered terminal dashboard for viewing traces in real-time
  - Live span streaming with pause/resume functionality
  - Error filtering and statistics display
  - Auto-wires to existing tracer provider

  **autotel-subscribers:**
  - Fix `AmplitudeSubscriber` to correctly use Amplitude SDK pattern where `init()`, `track()`, and `flush()` are separate module exports

  **Examples:**
  - Add Next.js example app
  - Add TanStack Start example app

### Patch Changes

- Updated dependencies [86ae1a8]
  - autotel-edge@3.4.0

## 2.5.0

### Minor Changes

- e904227: ### autotel

  Add event-driven observability and workflow tracing features:
  - **`autotel/messaging`** - First-class support for message-based systems with `traceProducer` and `traceConsumer` helpers. Auto-sets SpanKind, semantic attributes (`messaging.system`, `messaging.destination.name`), and trace header propagation.
  - **`autotel/business-baggage`** - Type-safe baggage schemas with built-in guardrails for cross-service context propagation. Includes PII redaction, high-cardinality hashing, size limits, and enum validation.
  - **`autotel/workflow`** - Workflow and saga tracing with `traceWorkflow` and `traceStep`. Supports compensation handlers that run in reverse order on failure, step linking, and WeakMap-based state isolation.

  ### autotel-tanstack
  - Fix Vite build configuration to externalize `autotel` for client bundles (SSR compatibility)

  ### autotel-aws
  - Add CDK infrastructure example with LocalStack support for the AWS Lambda example app

### Patch Changes

- Updated dependencies [e904227]
  - autotel-edge@3.3.0

## 2.4.1

### Patch Changes

- Updated dependencies [bc0e668]
  - autotel-edge@3.2.1

## 2.4.0

### Minor Changes

- bb7c547: Add support for array attributes in trace context

  Extended `setAttribute` and `setAttributes` methods to support array values (string[], number[], boolean[]) in addition to primitive values, aligning with OpenTelemetry's attribute specification. This allows setting attributes like tags, scores, or flags as arrays.

### Patch Changes

- Updated dependencies [bb7c547]
  - autotel-edge@3.2.0

## 2.3.0

### Minor Changes

- 79f49aa: Updated example

### Patch Changes

- Updated dependencies [79f49aa]
  - autotel-edge@3.1.0

## 2.2.0

### Minor Changes

- ec3b0c7: Add YAML configuration support and zero-config auto-instrumentation
  - **YAML Configuration**: Configure autotel via `autotel.yaml` files with environment variable substitution
  - **Zero-config setup**: New `autotel/auto` entry point for automatic initialization from YAML or environment variables
  - **ESM loader registration**: New `autotel/register` entry point for easier ESM instrumentation setup without NODE_OPTIONS
  - **Improved CommonJS compatibility**: Better support for CommonJS plugins and instrumentations

## Released

Initial release as `autotel-cloudflare` (renamed from `autotel-cloudflare`).
