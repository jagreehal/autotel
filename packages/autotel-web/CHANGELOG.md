# autotel-web

## 1.12.6

### Patch Changes

- 3d9e31c: Relicense from MIT to Apache-2.0. The `license` field now reads `Apache-2.0`, and the package ships the Apache-2.0 `LICENSE`. This changes the licence only; there are no API changes. Prior releases remain available under their original MIT terms. See `NOTICE` and `TRADEMARKS.md` in the repository root for attribution and the "autotel" trademark policy.

## 1.12.5

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

## 1.12.4

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

## 1.12.1

### Patch Changes

- 4ce86fc: Refresh package dependencies across the workspace and keep generated lockfile state in sync.

  Add OTLP/protobuf ingestion support to `autotel-devtools` for traces, logs, and metrics. The devtools HTTP receiver now accepts both OTLP/JSON and OTLP/protobuf payloads on the existing `/v1/traces`, `/v1/logs`, and `/v1/metrics` endpoints, decodes protobuf payloads with embedded OTLP schemas, and includes interop coverage using the OpenTelemetry protobuf serializers.

## 1.12.0

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

## 1.11.6

### Patch Changes

- 1a8bedd: Updated dependencies

## 1.11.5

### Patch Changes

- 5e146a7: Streamline package surface and align skills with the [Agent Skills specification](https://agentskills.io/specification).
  - Drop `@tanstack/intent` from runtime and dev dependencies, plus the auto-generated `bin/intent.js` shims. Skills still ship under each package's `skills/` directory and are discovered by spec-compliant agents (Claude Code, Cursor, Cline, etc.) via filesystem scan — no consumer-side CLI required.
  - Remove the `autotel/workers` and `autotel/cloudflare` entry points from `autotel`. Cloudflare Workers users should import directly from `autotel-cloudflare` (and its `/logger`, `/sampling`, `/events` subpaths). `autotel` no longer peer-depends on `autotel-cloudflare` or `autotel-edge`.
  - Strip non-spec frontmatter (`type`, `library`, `library_version`, `sources`, `requires`) from all `SKILL.md` files; keep only spec-defined fields (`name`, `description`, optional `license`).
  - Move user-facing skills (`migrate-to-autotel`, `tune-sampling`, `debug-missing-spans`, `build-audit-trails`) into `packages/autotel/skills/` so consumers receive them automatically via npm. Contributor-only skills (`create-autotel-adapter`, `create-autotel-instrumentation`, `create-autotel-exporter`) remain under the repo-root `skills/` directory.
  - Realign `autotel`'s peer dependency ranges to match published versions on npm.
  - Release workflow now refreshes `pnpm-lock.yaml` after `changeset version` so the next Version Packages PR ships with a consistent lockfile.

## 1.11.4

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

## 1.11.3

### Patch Changes

- 5d05a3e: Add Cloudflare Workers support to main `autotel` package. Introduces `autotel/workers` and `autotel/cloudflare` entry points that re-export the functional API and Cloudflare-specific instrumentation from `autotel-cloudflare`, providing better DX for Cloudflare users while keeping the core package modular. Updates package exports, build config, and documentation.

## 1.11.2

### Patch Changes

- dc4908d: Updated deps

## 1.11.1

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

## 1.11.0

### Minor Changes

- 88b4eab: Add error tracking with PostHog integration
  - **autotel-web**: Rich error capture in full mode - stack trace parsing (Chrome/Firefox/Safari), exception chains via error.cause, per-type rate limiting, configurable suppression rules, manual `captureException()` API, and automatic PostHog detection to avoid double-capture
  - **autotel**: New `posthog: { url }` init option and `POSTHOG_LOGS_URL` env var for zero-config OTLP log export to PostHog
  - **autotel-subscribers**: `captureException()` on PostHogSubscriber for sending errors via PostHog capture API, auto-detection of error spans in the event pipeline, and PostHog `$exception_list` formatting

- 88b4eab: Add PII redaction to all PostHog export paths. Two-layer approach: regex value scanning
  for emails, phones, credit cards, JWTs in error messages and stack traces, plus slow-redact
  path-based redaction for known sensitive fields in structured event attributes.
  - Extract `createStringRedactor()` utility from core `AttributeRedactingProcessor`
  - Add `RedactingLogRecordProcessor` wrapper for PostHog OTLP logs
  - Add redactor support to `posthog-error-formatter` (exception.value, abs_path)
  - Add `redactPaths` and `stringRedactor` options to `PostHogSubscriber`
  - Duplicate string redactor in `autotel-web` for browser error tracking
  - Wire `attributeRedactor` from `init()` through to all PostHog paths automatically

## 1.10.1

### Patch Changes

- 65b2fc9: - Bug fixes and dependency updates across packages.
  - example-vitest: API tests use a random port (when `API_BASE_URL`/`PORT` unset) to avoid EADDRINUSE on port 3000.

## 1.10.0

### Minor Changes

- 1155c72: - **autotel-backends**: Add Grafana backend; export and type updates.
  - **autotel, autotel-\***: Dependency bumps, docs/comment updates, and version alignment across the monorepo.

## 1.9.0

### Minor Changes

- c710c71: Add option to hide free/busy times (or selected attributes) in console export and related exporters.

## 1.8.0

### Minor Changes

- d1bd8cd: - **autotel-sentry**: README updates : clarify Sentry SDK + OTel scenario, link to Sentry OTLP docs, note that Sentry ingestion request spans are not sent, fix `SentrySpanProcessor` backtick typo, add spec-volatility note.
  - **autotel-backends**: Preserve caught error in Google Cloud config : attach original error as `cause` when throwing the user-facing error so the `preserve-caught-error` lint rule is satisfied.

## 1.7.1

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

## 1.7.0

### Minor Changes

- c68a580: - **autotel**: Add correlation ID support for event-driven observability (stable join key across events, logs, and spans via AsyncLocalStorage; optional baggage propagation). Add events configuration for `init()`: `includeTraceContext`, `traceUrl`, and baggage enrichment with allow/deny and transforms. Event queue and event subscriber now attach correlation ID and trace context to events. New `autotel/correlation-id` and `autotel/events-config` types used internally; init accepts `events` option.
  - **autotel-subscribers**: EventSubscriber base class and adapters (PostHog, Mixpanel, Amplitude) updated to use `autotel/event-subscriber` types and AutotelEventContext; graceful shutdown and payload normalization aligned with new event context and correlation ID.
  - **autotel-edge**, **autotel-cloudflare**, **autotel-aws**, **autotel-backends**, **autotel-tanstack**, **autotel-terminal**, **autotel-plugins**, **autotel-cli**, **autotel-mcp**, **autotel-web**: Version bumps for compatibility with autotel core.

## 1.6.1

### Patch Changes

- acfd0de: Add comprehensive test coverage for Datadog backend configuration, including validation, direct cloud ingestion, agent mode, and OTLP logs export functionality.

## 1.6.0

### Minor Changes

- 47c70fb: Update dependencies across all packages:
  - **OpenTelemetry**: Update to v2.5.0 (core packages) and v0.211.0 (SDK packages)
  - **AWS SDK**: Update all client packages from v3.972.0 to v3.975.0
  - **TypeScript ESLint**: Update from v8.53.1 to v8.54.0
  - **Turbo**: Update from v2.7.5 to v2.7.6
  - **Vitest**: Update from v4.0.17 to v4.0.18
  - **@types/node**: Update from v25.0.9 to v25.0.10
  - **Cloudflare Workers Types**: Update from v4.20260120.0 to v4.20260124.0

## 1.5.0

### Minor Changes

- 8256dac: Add comprehensive awaitly integration example demonstrating workflow instrumentation with autotel OpenTelemetry. The new `awaitly-example` app showcases successful workflows, error handling, decision tracking, cache behavior, and visualization features. Updated prettier to 3.8.1 across all packages.

## 1.4.1

### Patch Changes

- 3e12422: Update dependencies across all packages:
  - OpenTelemetry packages: 0.208.0 → 0.210.0
  - OpenTelemetry SDK packages: 2.2.0 → 2.4.0
  - import-in-the-middle: 2.0.1 → 2.0.4
  - pino: 10.1.0 → 10.1.1
  - TypeScript ESLint: 8.52.0 → 8.53.0
  - vitest: 4.0.16 → 4.0.17
  - @types/node: 25.0.3 → 25.0.8

## 1.4.0

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

## 1.3.0

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

## 1.2.0

### Minor Changes

- 79f49aa: Updated example

## Released

Initial release as `autotel-web` (renamed from `autotel-web`).
