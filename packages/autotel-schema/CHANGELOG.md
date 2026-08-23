# autotel-schema

## 11.0.1

### Patch Changes

- Updated dependencies [4c859aa]
  - autotel@7.0.1

## 11.0.0

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

## 10.0.0

### Patch Changes

- Updated dependencies [e8f2d0f]
  - autotel@6.5.0

## 9.0.1

### Patch Changes

- Updated dependencies [b37813b]
  - autotel@6.4.1

## 9.0.0

### Patch Changes

- Updated dependencies [09888cd]
  - autotel@6.4.0

## 8.0.0

### Patch Changes

- Updated dependencies [fb6bee2]
  - autotel@6.3.0

## 7.0.1

### Patch Changes

- Updated dependencies [7bad202]
  - autotel@6.2.1

## 7.0.0

### Minor Changes

- 0f518c6: Score whether a GenAI trace still tells the whole agent story.

  **`scoreGenAiCompleteness(spans)`** scores one trace 0–10 across the ten fields
  root-cause analysis actually needs: LLM input and output, model name, token
  usage, cost, per-span latency, tool call arguments and results, an intact span
  tree, and a plausible span count. Half a point where a field is present but
  partial — token usage recorded in one direction only, tool calls whose results
  never landed, parent ids that resolve to no span, a single-span trace.

  These are the fields agent-observability platforms are themselves benchmarked
  on; a trace that loses them is unanalysable regardless of which backend it lands
  in. Dependency-free like the rest of the package, and it takes the same
  `ScenarioSpan` input as `scenario.ts`, so a `test-span-collector` trace feeds
  straight in.

  ```typescript
  import { scoreGenAiCompleteness, formatCompleteness } from 'autotel-schema';

  const result = scoreGenAiCompleteness(collector.peekTrace(traceId));
  if (result.score < 8) throw new Error(formatCompleteness(result));
  ```

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

- Updated dependencies [0f518c6]
- Updated dependencies [0f518c6]
- Updated dependencies [0f518c6]
  - autotel@6.2.0

## 6.0.0

### Patch Changes

- Updated dependencies [85a0e88]
  - autotel@6.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [756345d]
- Updated dependencies [756345d]
  - autotel@6.0.0

## 4.0.0

### Patch Changes

- Updated dependencies [9030f83]
  - autotel@5.0.0

## 3.0.0

### Minor Changes

- 4f4f074: Scenario conformance: flow-level contracts with completion boundaries.

  `autotel-schema` gains a `scenarios` section in `defineContract()` — declare which events one exercised flow must emit, their cardinality (`'exactly 1'`, `'at most 3'`, ranges), required ancestor→descendant topology edges, and a first-class completion boundary (`terminal-event`, `root-span-closed`, `externally-reconciled`). `checkScenario()` polls collected spans until the boundary closes, a definitive violation appears, or the observation budget is spent, and returns one of **three** outcomes: `conformant`, `non-conformant`, or `incomplete` — so infrastructure slowness is never reported as behavioural regression. Absence is definitive only after closure; unexpected errors and exceeded `max` cardinality fail fast while the flow is still open; undeclared events are additive (reported, never failing). `proposeScenario()` drafts a contract from N recorded runs (record → propose → commit).

  `autotel` gains `TestSpanCollector.peekTrace(traceId, rootSpanId?)` — a non-destructive read of a trace's finished spans, so a scenario checker can poll while an async flow is still emitting. Its `SerializedSpan` output feeds `checkScenario()` directly.

### Patch Changes

- Updated dependencies [4f4f074]
- Updated dependencies [4f4f074]
  - autotel@4.3.0

## 2.0.5

### Patch Changes

- 3d9e31c: Relicense from MIT to Apache-2.0. The `license` field now reads `Apache-2.0`, and the package ships the Apache-2.0 `LICENSE`. This changes the licence only; there are no API changes. Prior releases remain available under their original MIT terms. See `NOTICE` and `TRADEMARKS.md` in the repository root for attribution and the "autotel" trademark policy.
- Updated dependencies [3d9e31c]
  - autotel@4.2.5

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

## 1.0.0

### Patch Changes

- Updated dependencies [12c6b6d]
  - autotel@4.1.0

## 0.2.0

### Minor Changes

- 4cd08bf: Add **`autotel-schema`**, a typed, versioned contract for your telemetry surface.
  With `autotel-pact` (evidence that contracted interactions actually ran) it forms
  autotel's core observability-contract pair. Both use telemetry to answer a
  contract question. `autotel-schema` is the telemetry contract you emit (span
  names + attributes).

  When the main reader of your telemetry is an agent, your span names and
  attribute keys are a public API. This package makes that surface explicit,
  typed, and versionable. The contract model is dependency-free, with no
  OpenTelemetry SDK required (the processor uses structural span types).
  - `defineContract({ service, version, spans, commonAttributes })`: declare the
    spans/attributes your service emits; validated and frozen at load.
  - `validateSpan(span, contract)` and `createSchemaValidationProcessor({ contract, mode })`:
    validate live spans (`missing_required`, `type_mismatch`, `enum_violation`,
    `unknown_attribute` with "did you mean?", `unknown_span`). Fail-open; bounded,
    deduped warnings; off in production unless opted in.
  - `contractToSnapshot`, `serializeSnapshot`, `diffSnapshots`, `hasBreakingChanges`,
    and the `autotel-schema` CLI (`diff` / `check`): gate breaking trace-surface
    changes in CI.
  - `highCardinalityKeys(contract)`: feed a redaction allow-list so the
    high-cardinality fields an agent reader needs survive.
