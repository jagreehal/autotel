# autotel-genai

## 0.3.10

### Patch Changes

- Updated dependencies [85a0e88]
  - autotel@6.1.0
  - autotel-audit@0.4.9

## 0.3.9

### Patch Changes

- 756345d: Skills no longer ship inside the npm package tarballs. They now live at the repo root under `skills/`, grouped into `core/`, `frameworks/`, `integrations/`, and `contributing/`, as a single source of truth discovered by the skills CLI (`npx skills add jagreehal/autotel --skill <name>`). `skills` is removed from each package's `files` field, so installing a package no longer adds its skill to `node_modules`. Install skills explicitly with the CLI instead.
- Updated dependencies [756345d]
- Updated dependencies [756345d]
  - autotel@6.0.0
  - autotel-audit@0.4.8

## 0.3.8

### Patch Changes

- 9030f83: Correctness fixes, strict-TS type repairs across the public API, and a
  dependency refresh. Test files are now type-checked in every package
  (`tsconfig.json` no longer excludes `*.test.ts`), which surfaced and fixed a
  batch of real public-type bugs.

  **Added (autotel):**

  - Add `autotel/slo` with rolling-window SLI tracking, error-budget snapshots,
    baseline/lookahead forecasts, OpenTelemetry metrics, span attributes, and
    dual-window burn-rate alert evaluation.
  - Add `autotel/analysis` with `compareCohorts()`: the core analysis loop as a
    pure function. Give it the events you are investigating plus a comparable
    baseline and it ranks the field/value pairs that separate them. Accepts wide
    events, `TestSpan.attributes`, or backend rows. Fields whose values never
    repeat are skipped, since a request id cannot name a cohort.
  - Add `DeterministicSampler` to `autotel/sampling` for consistent sampling.
    `RandomSampler` rolls per process, so an API can keep a trace its worker
    drops; hashing a key that travels with the request makes every service agree.
  - Add `KeyTargetRateSampler` to `autotel/sampling` for per-key target rates.
    It counts traffic per key over a rolling window and gives each key its own
    rate, so rare operations survive a skewed workload while busy ones get
    thinned. Key cardinality is bounded by `maxKeys`.
  - Add the optional `Sampler.sampleRate()` hook, recorded on spans as
    `autotel.sampling.rate` ("1 in N") by both `trace()` and the SDK-level
    sampler, so `COUNT * rate` estimates the true population. Written only when
    N exceeds 1.

  **Breaking (autotel), `trace()` is now deterministic and plain-only.**

  The parameter-name / execution-based heuristic that guessed whether a function
  was a factory has been removed (it executed user code during wrapper
  construction and misclassified functions whose first parameter was named
  `context`). `trace(name?, fn)` now always wraps a PLAIN function that receives
  its real arguments; no context is injected and the function is never inspected.

  - Reach the active span with the new ambient `getActiveTraceContext()`
    (returns the `TraceContext`), `getActiveSpan()`, or a no-arg
    `getRequestLogger()`:
    ```ts
    const getUser = trace('getUser', async (id: string) => {
      getActiveTraceContext()?.setAttribute('user.id', id);
      return db.users.find(id);
    });
    ```
  - The explicit `(ctx) => (...args) => result` factory form moved to
    `withTracing({ name })(factory)` (unchanged behavior; it was always the
    canonical factory API).
  - The "immediate execution" form `trace((ctx) => value)` and `markAsImmediate`
    are removed. Run once and get the value by calling the wrapper: `trace(fn)()`.
  - `traceStep()` is now plain-handler only (`traceStep(cfg)(handler)`); reach the
    step span via `getActiveTraceContext()`.
  - `autotel-edge` gains the same `getActiveTraceContext()` accessor.

  **Breaking (autotel-edge / autotel-cloudflare), same `trace()` redesign.**

  `autotel-edge` had a parallel copy of the same factory heuristic; it is removed
  too, so edge's `trace(name?, fn)` is now plain-only and deterministic. Matching
  `autotel`. The `(ctx) => (...args) => result` factory form moves to
  `withTracing({ name })(factory)`, and the immediate-execution form
  `trace((ctx) => value)` / `markAsImmediate` are gone. Reach the span via the
  ambient `getActiveTraceContext()`. `autotel-cloudflare` re-exports edge's API
  (including `withTracing` and `getActiveTraceContext`), so the same migration
  applies to Workers consumers. As a bonus, `attributesFromResult` now receives
  the resolved (`Awaited`) result, so async functions can annotate it directly.
  Native Cloudflare spans are also available through `getActiveTraceContext()`,
  and wrappers now wait for Promise-returning non-`async` functions before ending
  their span or deriving result attributes.

  **Breaking (autotel, type-level and span names):**

  - Semantic span names now follow current OTel semconv: messaging spans drop the
    system prefix (`kafka.publish orders` → `publish orders`), and
    `traceDB`/`traceHTTP`/`traceMessaging` name spans from semconv
    (`SELECT users`, `GET /users/{id}`) instead of the wrapped function name.
    Dashboards or alerts keyed on the old span names need updating. Legacy and
    stable attribute aliases are emitted side by side.
  - `traceWorkflow`, `traceStep`, `traceDistributedWorkflow`,
    `traceDistributedStep`, `traceProducer`, `traceConsumer`, and
    `ParkingLot.traceCallback` moved their `TArgs`/`TReturn` generics from the
    outer config call onto the returned function so inference finally works.
    Call sites that passed explicit type arguments to the outer call
    (`traceProducer<[Order], void>(cfg)`) now error. Drop the type arguments;
    they are inferred from your factory.
  - `trace('name', () => value)` is now typed as the wrapper it always was at
    runtime (previously mis-typed as immediate execution).

  **Fixed (autotel):**

  - `instrument()` and the factory helpers now accept concretely-typed functions
    under `strict` TypeScript (`strictFunctionTypes`). Previously any typed
    function failed the `InstrumentableFunction` constraint.
  - The `ctx` proxy export is typed as `TraceContext` instead of `{}`.
  - `captureConsole()` now captures the raw argument-array shape Node actually
    publishes on `console.*` diagnostics channels. Real console calls previously
    produced empty log bodies.
  - `customAttributes` hooks on producer/consumer configs accept full OTel
    `Attributes` (optional values included), matching the documented examples.

  **Fixed (other packages):**

  - **autotel-edge**: a service-only `EdgeConfig` (no exporter, no
    spanProcessors) is now a valid type, the runtime always supported it, and
    `parseConfig` warns once when spans have nowhere to export.
  - **autotel-cloudflare**: `instrumentDO`'s generic constraint no longer causes
    multi-minute `tsc` hangs for consumers whose `DurableObjectState` type isn't
    reference-identical to the ambient one.
  - **autotel-mcp-instrumentation**: `extractOtelContextFromMeta` /
    `activateTraceContext` accept the `McpTraceMeta` produced by
    `injectOtelContextToMeta` (the documented round trip now type-checks), and
    `validateToolBudget` accepts custom numeric budgets.
  - **autotel-cli**: the `COMMANDS` manifest entries for the `telemetry` commands
    carry the full `CommandSpec` shape (network/writesFiles/supportsJson etc.).
  - **example-prisma**: migrate the SQLite datasource and client construction to
    Prisma 7's config-file and driver-adapter APIs so client generation and
    example type-checking work again.

  - **autotel**: add an optional `isError` predicate to `trace()`. When it returns
    `false`, the thrown value is treated as expected control flow. The span is
    marked OK, no exception is recorded, and the value is rethrown untouched.
    Backwards-compatible: with no `isError`, every throw is still an error.

  - **autotel-tanstack**: stop recording TanStack Router `redirect()` / `notFound()`
    as span errors. These are throw-based control-flow signals, not application
    errors. The loader, server-function, middleware, and handler wrappers recorded
    them (and reported them to the error store), and marking the span OK inside the
    wrapper wasn't enough. `trace()`'s own rejection handler overwrote it with
    ERROR. All seven trace sites now pass `isError: isRealError`, and a shared
    `isControlFlowSignal` helper recognises both current shapes (`redirect()` throws
    a `Response` with `.options`, `notFound()` throws `{ isNotFound: true }`) and
    the legacy `RedirectError` / `NotFoundError` names.

  - **autotel-telemetry**: drop permanently-rejected outbox batches instead of
    retrying forever. The HTTP drain threw on any non-2xx, so the caller skipped
    `purge()` and the batch stayed buffered; because every run resends the whole
    outbox first, one batch the server permanently rejects silently blocked all
    future telemetry for the tool. The drain now drops permanent 4xx batches and
    still retries on transient failures (408, 425, 429, 5xx, network errors).

  - **autotel** and **autotel-backends**: construct `BatchLogRecordProcessor` /
    `SimpleLogRecordProcessor` with the `{ exporter }` options object required by
    `@opentelemetry/sdk-logs` 0.220 (a positional exporter is silently ignored and
    drops all logs). Affects the PostHog log path, and the Datadog and Grafana
    cloud backends. Also refreshes OpenTelemetry and other dependencies to their
    latest compatible versions.

  - **autotel**: make wrapper APIs easier to use and test. `instrument()` now
    accepts `{ key, fn }` for one function as well as `{ functions }` batches;
    database, HTTP, and messaging semantic helpers accept direct functions;
    helper factories validate malformed callbacks with actionable errors; semantic
    spans use stable names, current attribute aliases, and appropriate span kinds.
    Workflow steps now support `StepContext` factories and context-aware
    compensation. Async root wrappers wait for event and provider flushing before
    settling, and explicit `init({ service })` names retain precedence over
    `OTEL_SERVICE_NAME` during NodeSDK resource detection. The trace collector adds
    trace IDs, hierarchy, events, links, kinds, trace-level queries, and
    `expectSpan()`.

  - **autotel-genai**: avoid invoking tracing factories during wrapper
    construction and report malformed factories clearly.

  **Fixed (autotel), sampling key hash distribution.**

  The hash behind `UserIdSampler` and consistent sampling let a shared prefix
  dominate its output. Keys such as `user_1000` through `user_9999` all landed
  between 0.34 and 0.59, so `UserIdSampler` at a 10% rate sampled none of them
  and at 50% sampled far too many. FNV-1a with a murmur3 finalizer replaced it,
  so a configured rate now holds for prefixed keys. The set of users
  `UserIdSampler` selects changes as a result.

  **Changed (autotel), optional resource detectors load synchronously.**

  `initInstrumentation()` loaded the AWS, GCP, and container resource detectors
  with `await import()` inside `try/catch {}`. It now uses `safeRequire`, which
  returns `undefined` when the optional package is absent and rethrows anything
  else. A detector package that is installed but broken now surfaces its error
  instead of being silently skipped. Detection behaviour is unchanged when the
  packages are present or absent.

  **Changed (autotel), `RedactingLogRecordProcessor.onEmit` is typed.**

  The signature was `(logRecord: any, context?: any)` and is now
  `(logRecord: SdkLogRecord, context?: Context)`. The `any` had been hiding a
  real type error in the attribute redaction path.

  **Fixed (autotel-cli), `autotel trace` emitted code that did not parse.**

  The codemod's function-declaration branches dropped the closing paren of the
  `trace(` call, so every `function foo() {}` it rewrote became
  `const foo = trace('foo', function foo() {};` and stopped compiling. Modifiers
  were mishandled too: `async` was prepended to the generated `const`, producing
  `async const`, and `export`/`async` were not stripped before the parameter
  list. Arrow functions and class methods were unaffected.

  The golden fixtures encoded the broken output, so the suite asserted it as
  correct. They are regenerated, and a new test parses every codemod output with
  the TypeScript parser and fails on any diagnostic, which is the check that
  would have caught this.

  **Fixed, broken import paths across docs, skills, and examples.**

  Auditing every documented `autotel/*` import against the package's `exports`
  found four paths that do not exist, all of them copy-pasteable:

  - `autotel/metrics` → `autotel/metric` (migration guide, Datadog guide, both
    the docs site and `docs/`)
  - `autotel/events` → `autotel/event`, in 22 files
  - `autotel/events-adapter` → `autotel/event-subscriber`
  - `autotel/workers` → `autotel-cloudflare`, in the agent skill

  The exported class is `Event`; `Events` never existed, so every
  `new Events(...)` in the subscriber docs and examples would have thrown. Fixed
  in 20 files. `Metrics` was likewise wrong for `Metric`.

- Updated dependencies [9030f83]
  - autotel@5.0.0
  - autotel-audit@0.4.7

## 0.3.7

### Patch Changes

- Updated dependencies [4f4f074]
- Updated dependencies [4f4f074]
  - autotel@4.3.0
  - autotel-audit@0.4.6

## 0.3.6

### Patch Changes

- 3d9e31c: Relicense from MIT to Apache-2.0. The `license` field now reads `Apache-2.0`, and the package ships the Apache-2.0 `LICENSE`. This changes the licence only; there are no API changes. Prior releases remain available under their original MIT terms. See `NOTICE` and `TRADEMARKS.md` in the repository root for attribution and the "autotel" trademark policy.
- Updated dependencies [3d9e31c]
  - autotel@4.2.5
  - autotel-audit@0.4.5

## 0.3.5

### Patch Changes

- Updated dependencies [4b7ad78]
  - autotel@4.2.4
  - autotel-audit@0.4.4

## 0.3.4

### Patch Changes

- Updated dependencies [830b6a4]
  - autotel@4.2.3
  - autotel-audit@0.4.3

## 0.3.3

### Patch Changes

- e2ed007: Fix corrupt `autotel-genai` build that broke importing `autotel-genai/agent`.

  rolldown 1.1.0 (via tsdown) inlined every static property read of a re-exported
  `as const` object (e.g. `AGENT_PLAN_RISK_ATTR`), dropped the now-unreferenced
  declaration, yet kept the symbol in a chunk's export list — producing
  `SyntaxError: Export 'X' is not defined in module` at import time. The breakage
  was non-deterministic across platforms, surfacing in CI as
  `agentContextFromSpan is not a function` in `autotel-cloudflare`.

  Tree-shaking is disabled for this package as a workaround (~10KB of retained
  internal code; consumer tree-shaking is unaffected since subpath exports remain).

## 0.3.2

### Patch Changes

- 0b1e332: Refresh the AI SDK guidance across published skills and docs.
  - document `autotelTelemetry()` as the primary Vercel AI SDK integration
  - document `subscribeAiTelemetry()` as the zero-config fallback
  - move `observeAiSdkResult()` and `autotel-genai/ai-sdk` guidance into the legacy/enrichment path
  - update review skills to stop recommending `experimental_telemetry`

- Updated dependencies [0b1e332]
  - autotel@4.2.2
  - autotel-audit@0.4.2

## 0.3.1

### Patch Changes

- Updated dependencies [38ae023]
  - autotel@4.2.1
  - autotel-audit@0.4.1

## 0.3.0

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
  - autotel-audit@0.4.0
  - autotel@4.2.0

## 0.2.1

### Patch Changes

- Updated dependencies [12c6b6d]
  - autotel@4.1.0
  - autotel-audit@0.3.2

## 0.2.0

### Minor Changes

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

- ac8e7c3: Add `autotel-genai/observer`: an event-stream adapter that turns a framework's lifecycle events into canonical `gen_ai.*` spans.

  `createGenAiObserver()` reconstructs the span tree from flat `*.start`/`*.end` events and prices token usage. It force-closes abandoned child spans, and keeps prompt and tool content off spans unless you pass an `exportContent` callback. Token usage lands on leaf `chat` spans only, so aggregate `agent` and `workflow` spans never double-count `gen_ai.usage.*`.

  Two framework adapters ship with it:
  - `createLangChainObserver()`: a LangChain/LangGraph callback handler. `runId`/`parentRunId` map onto the span tree, and the adapter skips LangGraph plumbing chains and reparents their children to the nearest kept node.
  - `observeAiSdkResult()`: walks a Vercel AI SDK `generateText`/`streamText` result into chat and tool spans.

  Both adapters are dependency-free, typed structurally against the framework shapes.
