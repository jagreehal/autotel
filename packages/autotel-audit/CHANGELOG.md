# autotel-audit

## 1.0.2

### Patch Changes

- Updated dependencies [559ec46]
  - autotel@7.1.0

## 1.0.1

### Patch Changes

- Updated dependencies [4c859aa]
  - autotel@7.0.1

## 1.0.0

### Major Changes

- d303348: ## `trace` wraps, `trace.run` runs

  Reaching the span from inside a traced function is back, and nothing about the
  existing `trace()` forms changed to make room for it.

  Every `trace(...)` form returns a **wrapper** and executes nothing, exactly as
  before. `trace.run(...)` is the new immediate form:

  | Call                        | Returns                | Use for                          |
  | --------------------------- | ---------------------- | -------------------------------- |
  | `trace(fn)`                 | wrapper, name inferred | a reusable function              |
  | `trace(name, fn)`           | wrapper, name explicit | a reusable function, stable name |
  | `trace(name)(fn)`           | wrapper, curried       | one config applied to many fns   |
  | `trace.run(name, ctx => r)` | the operation's result | one operation, run right here    |

  ```ts
  // unchanged
  export const createUser = trace('user.create', async (data: NewUser) => {
    return db.users.create(data);
  });

  // new
  const user = await trace.run('user.create', async (ctx) => {
    ctx.setAttribute('user.id', input.id);
    return db.users.create(input);
  });
  ```

  **This is additive. No `trace()` call changes meaning, so there is nothing to
  migrate.** An earlier draft of this change overloaded `trace(name, fn)` to run
  immediately, which would have turned every existing wrapper into a call that
  fires once at import with `data` bound to a `TraceContext` - a break that
  compiles clean and surfaces far from its cause. Keeping the immediate form
  under its own name avoids it entirely.

  Two names also means no call shape is ambiguous, so nothing inspects a
  callback's parameter name to decide what to do. That heuristic is what
  [#166](https://github.com/jagreehal/autotel/issues/166) removed after esbuild
  renamed `ctx` to a single letter, `trace()` fell into the wrong mode, and
  deployed Lambdas crashed handing the runtime a function to serialise. The
  `markAsImmediate()` escape hatch it needed is gone with it.

  `trace(name)` with a single argument returns a wrapper factory, for applying
  one configuration to several functions. `instrument({ key, fn })` remains the
  options form, and `withTracing({ name })(ctx => fn)` the reusable context
  factory. An explicit `ctx.setStatus()` is no longer overwritten by the
  automatic OK, and core `autotel` exposes its baggage helpers on the context.

  `autotel-edge` carries the identical shape, so a call means the same thing on
  both runtimes. Both packages pin it with a regression test asserting that no
  `trace(...)` form runs its function, whatever the parameter is called.

  ### Reaching the span: prefer the ambient `ctx`

  `trace.run`'s context parameter is for when an explicit binding reads better -
  it is not the only way in, and usually not the best one:

  ```ts
  import { trace, ctx } from 'autotel';

  export const createUser = trace('user.create', async (data: NewUser) => {
    ctx.setAttribute('user.id', data.id);
    return db.users.create(data);
  });
  ```

  The ambient `ctx` resolves to the active span at any depth, so a helper several
  frames inside a traced body sees the same span without being handed anything -
  which a context parameter cannot do without being threaded through every call.

  ## Telemetry surfaces carry their own types

  **Breaking:** several public types stop being open dictionaries and name what
  they actually hold.

  - `EventAttributes` values are `EventAttributeValue` - a JSON-serializable
    value - instead of `unknown`. The type always documented this; now it says so.
  - `autotel-schema`'s `SpanShape` is `EmittedSpan`, with attributes typed as
    `Record<string, EmittedAttributeValue>`. `EmittedAttributeValue` is exported
    alongside it: a string, number, boolean, null, or an array of those.
  - Attribute bags across `autotel` - the builders, `mergeAttrs`,
    `safeSetAttributes`, `validateAttribute`, `autoRedactPII` - are OTel's own
    `Attributes` rather than `Record<string, unknown>`.
  - `SentryLinkable`'s event processor is typed against a named `SentryEvent`,
    and `contexts.trace` against `SentryTraceContext`.
  - `traceConsumer` is generic over the message it consumes, so the extractors
    you give it receive your own type instead of `unknown`. `subscribeChannel`
    and `subscribeTracingChannel` are likewise generic in their message.
  - `autotel-cloudflare`'s `instrumentBindings` takes and returns `WorkerEnv`
    (`Record<string, unknown>`) rather than `Record<string, any>`. Reading a
    binding off the result now needs a narrowing step that `any` used to skip.
    `ActorConstructor`'s `env` parameter is `Record<string, unknown>` rather than
    `unknown`, and the type now also carries the class `name` the instrumentation
    reads.
  - `autotel-audit`'s `SUSPICIOUS_REQUEST_PATTERNS` is the shape of the object it
    actually is, not `Record<string, RegExp>`, so its keys are known. Indexing it
    with an arbitrary string no longer type-checks.
  - New exported names for shapes that were previously anonymous:
    `FlatAttributes`, `FlatMetadata`, `CorrelatedAttributes`, `BaggageFieldValue`,
    `YamlValue` / `YamlMapping`, `InstrumentationSwitches`, `TraceDecorator`,
    `WithTraceContext`, and `ImagesLike` in `autotel-cloudflare`.

  **Breaking:** `autotel-edge`'s `toAttributeValue` drops non-finite numbers
  instead of emitting them. OTLP cannot encode `NaN` or `Infinity`, and
  `JSON.stringify` renders both as the string `"null"` - an attribute claiming to
  hold null. The key is now omitted, and one `NaN` likewise stops an array being
  sent as numbers.

  ## PostHog is one package

  **Breaking:** `PostHogSubscriber` moves out of `autotel-subscribers` into
  `autotel-posthog`, which is now the join between autotel traces and PostHog in
  both directions. `autotel-subscribers/posthog` and the root re-export are gone.

  ## Also
  - `session.id` propagation and exception fingerprinting across `autotel`,
    `autotel-web`, `autotel-mcp`, `autotel-cli` and `autotel-devtools`.
  - `TelemetryOptions` accepts an `outbox`, so a tool can queue pending runs
    somewhere other than a file under the telemetry directory, and a test can
    watch what a run appended without mocking the module. Exported as `OutboxLike`.

### Patch Changes

- Updated dependencies [d303348]
  - autotel@7.0.0

## 0.4.15

### Patch Changes

- Updated dependencies [e8f2d0f]
  - autotel@6.5.0

## 0.4.14

### Patch Changes

- Updated dependencies [b37813b]
  - autotel@6.4.1

## 0.4.13

### Patch Changes

- Updated dependencies [09888cd]
  - autotel@6.4.0

## 0.4.12

### Patch Changes

- Updated dependencies [fb6bee2]
  - autotel@6.3.0

## 0.4.11

### Patch Changes

- Updated dependencies [7bad202]
  - autotel@6.2.1

## 0.4.10

### Patch Changes

- 0f518c6: Refresh dependencies to their latest minor and patch releases, most notably the
  OpenTelemetry SDK (`0.220.x` → `0.221.x`, `2.9.x` → `2.10.x`).

  Majors are deliberately held back for a separate change, including TypeScript 7,
  pnpm 11, chalk 6, jsdom 30 and the ESLint toolchain.

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

- Updated dependencies [0f518c6]
- Updated dependencies [0f518c6]
- Updated dependencies [0f518c6]
  - autotel@6.2.0

## 0.4.9

### Patch Changes

- Updated dependencies [85a0e88]
  - autotel@6.1.0

## 0.4.8

### Patch Changes

- Updated dependencies [756345d]
- Updated dependencies [756345d]
  - autotel@6.0.0

## 0.4.7

### Patch Changes

- Updated dependencies [9030f83]
  - autotel@5.0.0

## 0.4.6

### Patch Changes

- Updated dependencies [4f4f074]
- Updated dependencies [4f4f074]
  - autotel@4.3.0

## 0.4.5

### Patch Changes

- 3d9e31c: Relicense from MIT to Apache-2.0. The `license` field now reads `Apache-2.0`, and the package ships the Apache-2.0 `LICENSE`. This changes the licence only; there are no API changes. Prior releases remain available under their original MIT terms. See `NOTICE` and `TRADEMARKS.md` in the repository root for attribution and the "autotel" trademark policy.
- Updated dependencies [3d9e31c]
  - autotel@4.2.5

## 0.4.4

### Patch Changes

- Updated dependencies [4b7ad78]
  - autotel@4.2.4

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
