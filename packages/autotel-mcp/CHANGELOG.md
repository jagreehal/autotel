# autotel-mcp

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
