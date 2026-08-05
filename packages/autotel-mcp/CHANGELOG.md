# autotel-mcp

## 0.3.0

### Minor Changes

- fb6bee2: Keep telemetry that used to disappear on the way out: flush when a process finishes, drain subscribers, record the GenAI metrics, and read the MCP server's own flags.

  ## `autotel`: flush when the process finishes on its own

  `processHandlers` covers a process that is stopped or that crashes. Neither fires when a script runs to completion: Node drains the event loop and exits, and everything the batch span processor is still holding goes with it. No error, no warning, no spans.

  That is the default shape of a CLI, a cron job, a CI step, a migration and a seed script. It is also how the failure presents: `trace()` records the span, `debug: true` prints it to the console, and the collector stays empty, so the console argues the export worked.

  Autotel now listens for `beforeExit` and flushes there:

  ```ts
  init({ service: 'my-cli' });
  await doWork();
  // event loop drains -> flush -> exit. No shutdown() call needed.
  ```

  Set `flushOnExit: false` if your process manages its own exit and you would rather autotel added no listener.

  Notes:

  - A flush, never a shutdown. `beforeExit` fires on any event-loop drain, not only the last one, so the SDK, the process handlers and the tracer provider stay in place: a process that goes on to do more work keeps its telemetry. Subscribers are drained, since they buffer independently of our queue and are the reason a short-lived process loses events on the way out.
  - One listener, however many times `init()` runs, and one flush however many times Node re-emits `beforeExit`.
  - Bounded by `processHandlers.shutdownTimeoutMs` (default 2s), and the bound is an exit. An exporter that accepts the connection and never answers holds a ref'd socket, so a timeout that only settles a promise would leave the CLI waiting out the exporter's own retry schedule.
  - A signal landing mid-flush queues behind it rather than tearing down the queues it is draining.
  - `beforeExit` does not fire on `process.exit()`, on a signal, or after an uncaught exception. Those remain the job of `processHandlers`, and serverless still wants an explicit `flush()`.

  ## `autotel`: subscribers now get shut down

  `EventQueue.shutdown()` drained its own queue into the subscribers and stopped there. It never called `subscriber.shutdown()`, which the `EventSubscriber` interface documents as the place a subscriber flushes its buffer.

  Subscribers batch too. `LokiSubscriber` holds up to 100 events on a 5 second timer, so a process that exits before that timer fires loses whatever is in the buffer, silently. That is every Lambda, CLI, cron job and script: the exact shape of process that calls `shutdown()` and exits.

  Each subscriber's `shutdown()` is now called after the queue drains, isolated so one failure cannot strand the others. A subscriber that fails to drain is logged and marked unhealthy, because that failure is the data loss this call exists to prevent.

  That call is terminal for the client a subscriber wraps, while the queue is not: `shutdown()` resets it, and the next `track()` builds a fresh queue from the same config. A rebuilt queue therefore drops a subscriber it has already shut down and says so, rather than accepting events into a closed client.

  ## `autotel-genai`: metrics and `error.type` from `traceGenAI`

  `traceGenAI` wrote rich `gen_ai.*` spans and left the metric instruments to you. `genAiMetricViews()` supplied bucket advice for instruments the package never created, so a service using autotel alone got no GenAI metrics at all.

  It now records the canonical instruments on every completed operation:

  - `gen_ai.client.operation.duration`
  - `gen_ai.client.token.usage`, split by `gen_ai.token.type`
  - `gen_ai.client.operation.time_to_first_chunk`
  - `gen_ai.client.cost.usd` (an autotel extension; the spec publishes no cost metric)

  The values come from what the handler already wrote to the span — through the injected `ctx` or through `getActiveTraceContext()` — so `recordGenAiUsage`, `recordLLMCost` and `recordStreamTiming` need no changes and you never report a number twice. Attributes carry the operation, provider, request model, response model and `error.type`. Instruments are rebuilt when the `MeterProvider` changes, so metrics survive a `shutdown()` / `init()` cycle.

  This is on by default and a no-op without a registered `MeterProvider`, so a traces-only setup pays nothing. Set `metrics: false` when something upstream already emits `gen_ai.client.*` and you would double-count:

  ```typescript
  traceGenAI({ provider: 'openai', model: 'gpt-4o', metrics: false });
  ```

  `traceGenAI` also sets `error.type` on a failed operation, using the error's name. The spec requires it, and `gen_ai.client.operation.duration` splits on it, so an error-rate query over that metric was impossible before.

  New exports: `recordGenAiMetrics` for instrumenting a GenAI call some other way, and `GEN_AI_METRIC.COST_USD` for the cost metric name.

  ## `autotel-mcp`: speak the current MCP revision (`2026-07-28`)

  The server was built on `@modelcontextprotocol/sdk` v1, which tops out at protocol `2025-11-25`. It now uses the `@modelcontextprotocol/server` / `@modelcontextprotocol/node` v2 packages and serves `2026-07-28`: no `initialize` handshake, no `Mcp-Session-Id`, `server/discover` for capability discovery, `resultType` on every result, and `subscriptions/listen` in place of the GET stream.

  2025-era clients keep working. Claude Code, Claude Desktop, Cursor and the rest ship the v1 SDK, which opens with the `initialize` handshake; the SDK's stateless legacy path answers them from the same tool definitions, so no MCP client config needs to change. `test/legacy-client.test.ts` drives the real v1 client against the real entry point, over the handshake, `tools/list`, `tools/call` and `resources/list`.

  **Breaking:**

  - `--transport sse` is gone. HTTP+SSE has been deprecated since protocol `2025-03-26` and is scheduled for removal; `--transport http` is Streamable HTTP, which serves both eras from one endpoint.
  - `createApp()` returns `createServer` (a factory) instead of `server` (an instance). There is no handshake and no session to pin an instance to, so the HTTP entry builds one per request and stdio builds one per connection. Anything expensive — the backend, the signal-availability probe — is still built once, at `start()`.

  **Security:** the HTTP endpoint now validates the `Origin` and `Host` headers against localhost, which the spec has required of local servers since `2025-06-18`. Binding to `127.0.0.1` was never the mitigation: a page on any origin can post to it.

  **Tool metadata:** all 41 tools carry `readOnlyHint` / `idempotentHint` annotations — they read telemetry and nothing else — so a client that honours annotations can run an investigation without stopping to ask about each query. `tools/list` and `resources/list` carry a `ttlMs` / `cacheScope` hint (SEP-2549): the catalog is fixed once the backend is probed and identical for every caller, which matters more now that there is no session to amortise the fetch over.

  ## `autotel-mcp`: parse the command-line flags the README has always documented

  `npx autotel-mcp --transport http --port 3000` and `npx autotel-mcp --persist ./autotel.db` appear in the README, in the MCP client config examples, and in the feature list. Nothing read them. Configuration came from the environment only, so those invocations started a stdio server on the default ports and said nothing about it.

  Every environment variable now has a matching flag, and flags win over the environment:

  ```bash
  npx autotel-mcp --transport http --port 3000
  npx autotel-mcp --persist ./autotel.db
  npx autotel-mcp --backend jaeger --jaeger-url http://localhost:16686
  ```

  `--help` and `--version` work. A flag missing its value exits 2 with a message instead of starting up misconfigured. An unknown flag is reported on stderr and ignored: argv was read by nobody until now, so client configs already in the wild carry flags this binary never defined, and refusing to start would break them.

  Credentials stay environment-only, because argv is readable by any process that can list the process table. Passing `--datadog-api-key` is now an error that names `DD_API_KEY` rather than a silent leak. `--datadog-site` is an ordinary flag: a region hostname is not a secret, and `autotel-cli` already exposes it as one.

  `createApp()` takes an options object: `createApp({ argv, env })`, or `createApp({ config })` when you have already resolved one. It reads no argv by default, so an embedder's own command line cannot turn into "unknown option" errors. `loadConfig(argv?, env?)` takes both as parameters for the same reason, and `resolveConfig(parsed, env?)` resolves from an already-parsed command line so a caller that needs `--help`, `--version` or the error list does not parse argv twice and reach two different verdicts about it.

## 0.2.0

### Minor Changes

- 0f518c6: Query hosted observability vendors from `autotel investigate`.

  Until now the investigate backends were all self-hosted or local (Jaeger, Tempo,
  Prometheus, Loki, the built-in collector). Three hosted vendors now work too, as
  trace-only backends:

  - `--backend logfire` — Pydantic Logfire, over the `/v2/query` SQL API
  - `--backend datadog` — Datadog APM, over the v2 spans search API
  - `--backend signoz` — SigNoz, over its trace endpoints

  Each declares `metrics` and `logs` as `unsupported` rather than returning empty
  results, so a caller can tell "this backend cannot answer that" from "there is
  nothing there".

  Credentials come from the environment only — never flags — because argv is
  readable from the process table:

  | Backend   | Base URL                                  | Credentials                             |
  | --------- | ----------------------------------------- | --------------------------------------- |
  | `logfire` | `LOGFIRE_BASE_URL` / `--logfire-base-url` | `LOGFIRE_READ_TOKEN`                    |
  | `datadog` | `DD_SITE` / `--datadog-site`              | `DD_API_KEY` + `DD_APP_KEY`             |
  | `signoz`  | `SIGNOZ_BASE_URL` / `--signoz-base-url`   | `SIGNOZ_API_KEY` (optional self-hosted) |

  `DD_SITE` accepts a bare Datadog site (`uk1.datadoghq.com`) as well as a full API
  URL, since a bare site is what Datadog's own `DD_SITE` holds.

  Two details that are easy to get wrong, both now handled:

  - **Logfire's read and write paths are asymmetric.** Ingest accepts the
    token-routed host `logfire-api.pydantic.dev` and infers the region from the
    token; the query API does not, and needs the region host (`logfire-us` /
    `logfire-eu`) explicitly. A wrong region and a wrong token scope both return an
    indistinguishable bare 401, so the error now names both causes and the fix.
  - **Datadog reads need two credentials.** An org API key alone gets a 403; a
    personal application key is also required. Missing credentials are reported
    before the request is built, so the error names the variable rather than
    failing on URL construction.

  `jsonGet`/`jsonPost` now retry HTTP 429 honouring `Retry-After`. Hosted vendor
  read APIs rate-limit aggressively and an investigation naturally fires bursts;
  nothing else is retried, so a 500 or 404 still reaches the caller unchanged.

### Patch Changes

- 0f518c6: Stop publishing source maps. Every package is roughly half the size it was.

  Published output across all packages drops from 18.7 MiB to 7.9 MiB. Installing
  `autotel` downloads 500 KiB gzipped instead of 1,130 KiB. Nothing about the
  shipped JavaScript or type declarations changed.

  Source maps were 55–65% of every package, because each source byte was emitted
  four times: once as ESM, once as CJS, and again inside each format's map, which
  embedded `sourcesContent`. They never reached a consumer's application bundle —
  bundlers read maps and discard them — so the cost was pure install weight in
  exchange for TypeScript stack traces under `node --enable-source-maps`.

  Best-in-class TypeScript libraries do not make that trade. Of fourteen surveyed,
  twelve publish no maps at all (zod, hono, pino, fastify, vitest, vite, rollup,
  undici, commander, tsdown, react, astro), and not one publishes `.d.ts.map`.
  The OpenTelemetry packages do ship maps at around 50% of their size, which is
  the convention this repo had been following.

  The `.d.ts.map` declaration maps were broken regardless: `sourcesContent: false`
  with sources pointing at `../src/*.ts`, which `files` never published, so they
  resolved to nothing on a consumer's machine.

  Maps are still generated for local development. `tsconfig.json` keeps
  `sourceMap` and `declarationMap` on; only `tsconfig.build.json` disables them,
  so debugging the workspace is unchanged.

  This also fixes the bundle-size gate, which had been amplifying every ordinary
  change by 4×. The three packages that were failing it (`autotel-backends` +43.9%,
  `autotel-mcp` +14.4%, `autotel-schema` +12.0%) were not bloated — that growth was
  legitimate new backend code, quadrupled by the build. The baseline is
  regenerated.

## 0.1.19

### Patch Changes

- 756345d: Skills no longer ship inside the npm package tarballs. They now live at the repo root under `skills/`, grouped into `core/`, `frameworks/`, `integrations/`, and `contributing/`, as a single source of truth discovered by the skills CLI (`npx skills add jagreehal/autotel --skill <name>`). `skills` is removed from each package's `files` field, so installing a package no longer adds its skill to `node_modules`. Install skills explicitly with the CLI instead.

## 0.1.18

### Patch Changes

- 3d9e31c: Relicense from MIT to Apache-2.0. The `license` field now reads `Apache-2.0`, and the package ships the Apache-2.0 `LICENSE`. This changes the licence only; there are no API changes. Prior releases remain available under their original MIT terms. See `NOTICE` and `TRADEMARKS.md` in the repository root for attribution and the "autotel" trademark policy.

## 0.1.17

### Patch Changes

- 4b7ad78: chore: routine dependency updates

  Refresh runtime and peer dependency ranges across published packages (`ncu`, 3-day release-age cooldown).

  The core `autotel` package moves to the latest OpenTelemetry libraries (stable `2.9.x`, experimental `0.220.x`, semantic-conventions `1.42.x`). This required adapting to a breaking change in `@opentelemetry/sdk-logs`: `BatchLogRecordProcessor` and `SimpleLogRecordProcessor` now take a `{ exporter }` options object instead of a positional exporter argument.

  Notable peer range bumps for consumers: `autotel-aws` (AWS SDK `3.1081`), `autotel-cloudflare` (`@cloudflare/workers-types` v5), `autotel-pact` (`@pact-foundation/pact` v17), `autotel-terminal` (`ai` v7).

## 0.1.16

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

## 0.1.13

### Patch Changes

- e7f63f9: Keep signal tools enabled when the startup probe can't reach the backend. The runtime signal probe runs once at MCP startup; if `searchTraces`/`listMetrics`/`searchLogs` threw — because an HTTP backend (Jaeger, Tempo, autotel-devtools) was momentarily down or still starting when the server connected — the catch marked the signal `unsupported`, gating its tools off for the entire session even after the backend recovered.

  Capabilities already declare which signals a backend supports, so a transient probe failure no longer overrides that. A new `unconfirmed` state (`enabled: true`, `hasData: false`) is returned from the probe's catch branches, so trace/metric/log tools stay registered and live queries retry on demand. Only an explicit `unsupported` result from the backend (or a capability that isn't `available`) disables a signal.

## 0.1.12

### Patch Changes

- 0818a9b: Add devtools telemetry backend that reads traces from a running autotel-devtools receiver via its GET /v1/traces read-back API. Extract shared span-mapping utilities (normalizeTagValue, normalizeTags, readNumericTag, inferErrorStatusFromTags) to eliminate duplication across jaeger, tempo, and devtools backends.

## 0.1.11

### Patch Changes

- 4ce86fc: Refresh package dependencies across the workspace and keep generated lockfile state in sync.

  Add OTLP/protobuf ingestion support to `autotel-devtools` for traces, logs, and metrics. The devtools HTTP receiver now accepts both OTLP/JSON and OTLP/protobuf payloads on the existing `/v1/traces`, `/v1/logs`, and `/v1/metrics` endpoints, decodes protobuf payloads with embedded OTLP schemas, and includes interop coverage using the OpenTelemetry protobuf serializers.

## 0.1.10

### Patch Changes

- 3966db0: Make `createRequire(import.meta.url)` survive ESM→CJS rebundling by downstream consumers.

  `packages/autotel/src/node-require.ts` and three other call sites
  (`autotel-backends/src/{datadog,grafana}.ts`, `autotel-mcp/src/version.ts`) used `createRequire(import.meta.url)` directly. That works in:
  - native CJS (autotel's published `.cjs`) — `import.meta.url` is rewritten by tsup
  - native ESM (autotel's published `.js`) — `import.meta.url` is the real URL

  …but **breaks** when a downstream consumer (e.g. CDK's `aws-lambda-nodejs`, which runs esbuild with `format: cjs`) re-bundles the ESM `.js` files into a CJS Lambda output. esbuild rewrites `import.meta` to `{}` in CJS output, so `createRequire(import.meta.url)` collapses to `createRequire(undefined)` and throws `ERR_INVALID_ARG_VALUE` at cold start:

  ```
  TypeError [ERR_INVALID_ARG_VALUE]: The argument 'filename' must be a file URL object,
  file URL string, or absolute path string. Received undefined
    at createRequire (node:internal/modules/cjs/loader:2025:11)
  ```

  All four sites now use the cross-format pattern:

  ```ts
  declare const __filename: string | undefined;
  createRequire(typeof __filename === 'string' ? __filename : import.meta.url);
  ```

  `typeof __filename` is safe against an undeclared identifier (it returns `'undefined'` rather than throwing), so the ESM build evaluates the conditional cleanly and falls through to `import.meta.url`. esbuild's CJS output wrapper provides `__filename` at runtime, so bundled CJS picks that branch.

  This is the third in a series of fixes (after #164 and #166) that make `autotel-aws/lambda` work end-to-end inside a CDK-bundled Lambda. With this patch landed, no consumer-side `define: { 'import.meta.url': '__filename' }` workaround is required.

## 0.1.9

### Patch Changes

- bc6a75c: Add CloudWatch OTLP exporters for `autotel-aws` and wire a richer investigate surface in `autotel-cli` backed by shared `autotel-mcp` modules.
  - `autotel-aws`
    - Add `autotel-aws/cloudwatch` export with SigV4-signed OTLP HTTP exporters for traces, logs, and metrics.
    - Add endpoint/signing helpers and documentation for direct CloudWatch OTLP usage.
  - `autotel-cli`
    - Add `investigate` command groups (`health`, `discover`, `query`, `trace`, `topology`, `diagnose`, `correlate`, `llm`, `semconv`, `score`, `collector`) with JSON envelopes.
    - Improve Commander error handling so parse/validation failures are returned in the CLI JSON error contract.
  - `autotel-mcp`
    - Extract backend selection into a reusable backend factory and export shared query/module helpers used by CLI investigate commands.

## 0.1.8

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

## 0.1.7

### Patch Changes

- 5e146a7: Streamline package surface and align skills with the [Agent Skills specification](https://agentskills.io/specification).
  - Drop `@tanstack/intent` from runtime and dev dependencies, plus the auto-generated `bin/intent.js` shims. Skills still ship under each package's `skills/` directory and are discovered by spec-compliant agents (Claude Code, Cursor, Cline, etc.) via filesystem scan — no consumer-side CLI required.
  - Remove the `autotel/workers` and `autotel/cloudflare` entry points from `autotel`. Cloudflare Workers users should import directly from `autotel-cloudflare` (and its `/logger`, `/sampling`, `/events` subpaths). `autotel` no longer peer-depends on `autotel-cloudflare` or `autotel-edge`.
  - Strip non-spec frontmatter (`type`, `library`, `library_version`, `sources`, `requires`) from all `SKILL.md` files; keep only spec-defined fields (`name`, `description`, optional `license`).
  - Move user-facing skills (`migrate-to-autotel`, `tune-sampling`, `debug-missing-spans`, `build-audit-trails`) into `packages/autotel/skills/` so consumers receive them automatically via npm. Contributor-only skills (`create-autotel-adapter`, `create-autotel-instrumentation`, `create-autotel-exporter`) remain under the repo-root `skills/` directory.
  - Realign `autotel`'s peer dependency ranges to match published versions on npm.
  - Release workflow now refreshes `pnpm-lock.yaml` after `changeset version` so the next Version Packages PR ships with a consistent lockfile.

## 0.1.6

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

## 0.1.5

### Patch Changes

- 5d05a3e: Add Cloudflare Workers support to main `autotel` package. Introduces `autotel/workers` and `autotel/cloudflare` entry points that re-export the functional API and Cloudflare-specific instrumentation from `autotel-cloudflare`, providing better DX for Cloudflare users while keeping the core package modular. Updates package exports, build config, and documentation.

## 0.1.4

### Patch Changes

- c1b5f60: - `autotel-drizzle`: add `db.statement.hash` span attribute so SQL queries can be grouped even when statement text capture is disabled.
  - `autotel-mcp`: improve Jaeger parent span mapping via `references[].refType === "CHILD_OF"`, clamp root-cause percent-of-trace to a sane range, and include backend signal capabilities in `backend_health`.

## 0.1.3

### Patch Changes

- dc4908d: Updated deps

## 0.1.2

### Patch Changes

- abe7674: **autotel-mcp**
  - **LLM cost attribution in USD.** `get_llm_usage`, `get_llm_expensive_traces`, `get_llm_slow_traces`, and `get_llm_model_stats` now compute and return `costUsd` alongside tokens, and `rankExpensiveTraces` sorts by spend rather than token count. Pricing catalog covers current Anthropic (Claude 3/4/4.5/4.6/4.7), OpenAI (GPT-4/4.1/4o, o1/o3), Google Gemini 1.5/2.0/2.5, Mistral, and Llama families; unknown models are tracked as `unpricedRequests` so coverage gaps are visible. Override via `AUTOTEL_LLM_PRICES_JSON=/path/to/prices.json`.
  - **Grafana LLM dashboard as MCP resource.** New `otel://dashboards` index and `otel://dashboards/grafana-llm` payload serve a six-panel Grafana dashboard (request rate, error rate, tokens/sec by type, p50/p95/p99 latency, per-model breakdown) targeting OTel GenAI Prometheus metric names. Agents can hand users the JSON to import directly.
  - **Import convention.** Stripped `.js` extensions from 170 relative imports across `src/` and `test/` to match the no-extension style used by `autotel` core and `autotel-drizzle`. External package subpath imports (e.g. `@modelcontextprotocol/sdk/server/mcp.js`) are unchanged.

  **autotel**
  - **LLM-tuned histogram buckets.** New `GEN_AI_DURATION_BUCKETS_SECONDS` (0.01s–300s, covers reasoning-model tails), `GEN_AI_TOKEN_USAGE_BUCKETS` (1–4M, right-skewed), and `GEN_AI_COST_USD_BUCKETS` (sub-cent–$50) exported from `autotel`. Pass `genAiMetricViews()` to your `MeterProvider` to apply them to the OTel GenAI instrument names (`gen_ai.client.operation.duration`, `gen_ai.client.token.usage`, `gen_ai.client.cost.usd`), or use `llmHistogramAdvice(kind)` for per-instrument advice.
  - **GenAI span event helpers.** New `recordPromptSent`, `recordResponseReceived`, `recordRetry`, `recordToolCall`, and `recordStreamFirstToken` helpers pin event names and attribute keys to the OTel GenAI semantic conventions. Produces timestamped markers (`gen_ai.prompt.sent`, `gen_ai.response.received`, `gen_ai.retry`, `gen_ai.tool.call`, `gen_ai.stream.first_token`) that render as dots on trace timelines in Jaeger / Tempo / Langfuse / Arize.

## 0.1.1

### Patch Changes

- e08acc0: Added otel MCP functionality
