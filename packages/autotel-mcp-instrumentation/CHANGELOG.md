# autotel-mcp

## 50.0.0

### Minor Changes

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

## 49.0.0

### Major Changes

- 31fd178: Support MCP `2026-07-28` (stateless) alongside the 2025-era protocol

  The protocol dropped the `initialize`/`initialized` handshake (SEP-2575) and the
  `Mcp-Session-Id` header (SEP-2567). One `instrumentMcpServer` /
  `instrumentMcpClient` call now covers both eras: the wrappers stay duck-typed
  Proxies, so era is detected per request and no SDK is imported at runtime.

  **Fixed: server spans were silently orphaned on the v2 SDK.** Neither era puts
  `_meta` in a handler's first argument — both SDKs validate `arguments` and hand
  the request metadata over on the context argument — but the v2 shape nests it at
  `ctx.mcpReq._meta` rather than v1's `extra._meta`. Every `2026-07-28` server span
  was starting a new trace instead of continuing the client's. The context is now
  located by shape rather than position, which also fixes resource handlers
  (`(uri, ctx)` and `(uri, variables, ctx)`).

  **Era-dependent attributes are read off the request instead of from config:**

  - `mcp.protocol.version` — from each request's
    `io.modelcontextprotocol/protocolVersion` envelope key on `2026-07-28`. There
    is no handshake left to pin it to.
  - `mcp.session.id` — from a 2025-era request (server) or `client.transport`
    (client). Absent on `2026-07-28`, which has no sessions.

  **Fixed: a handler with no input schema is called as `(ctx)` on both SDKs**, so
  treating `args[0]` as the arguments serialised the whole context. With
  `captureToolArgs: true` behind OAuth that put `http.authInfo.token` into
  `gen_ai.tool.call.arguments` and shipped it to the telemetry backend. The
  payload is now only read when the context was not found at that position.
  (Pre-existing; surfaced while adding the context lookup.)

  **Breaking:**

  - `MCP_METRICS.CLIENT_SESSION_DURATION` / `SERVER_SESSION_DURATION` and
    `MCP_METHODS.INITIALIZE` removed — nothing recorded them, and `2026-07-28` has
    nothing for them to measure.
  - `McpInstrumentationConfig.sessionId` is now a _fallback_, consulted only when
    the request carries no session of its own. Existing configs keep working; the
    value is simply outranked by the live one where there is one. It remains the
    only source for legacy stdio, whose transport has no session at all, and is
    ignored by sessionless 2026-07-28 requests.
  - Peer dependencies are now `@modelcontextprotocol/server` /
    `@modelcontextprotocol/client` ^2.0.0 **and** `@modelcontextprotocol/sdk`
    ^1.30.0, all optional. Install whichever you build against.

  **Added:**

  - `mcp.input_required` on the span and the duration metric when a `2026-07-28`
    handler returns `inputRequired(...)` instead of a result, so a multi-round-trip
    pause is not counted as completed work and the client's retry does not read as
    a duplicate call. The span status is left UNSET rather than OK — a pause is
    neither success nor failure. Detected with the SDK's own
    `resultType === 'input_required'` discriminator, so a result that legitimately
    carries a `requestState`/`inputRequests` field is not mistaken for a pause. The
    key is not under `mcp.tool.*` because `prompts/get` and `resources/read` can
    pause too, and a tool-namespaced label would split their duration series.
  - `MCP_METHODS.SERVER_DISCOVER`; the v2 client's `discover()` is traced as a
    discovery operation, in place of `initialize`.
  - Client wrappers forward trailing arguments verbatim, so v1's
    `callTool(params, resultSchema?, options?)` and v2's `callTool(params, options?)`
    both pass through untouched.

  **Examples migrated to 2026-07-28.** `example-mcp-server` now builds its server
  from a factory behind `serveStdio`, and `example-mcp-client` uses the v2 client
  with `versionNegotiation: 'auto'`. Both gained a `type-check` script — CI was
  not type-checking either app before.

  The server example also stopped writing spans to stdout. On a stdio MCP server
  stdout _is_ the protocol wire, so `ConsoleSpanExporter` corrupts it; the example
  now ships a small stderr exporter and says why.

### Minor Changes

- 31fd178: Group MCP failures by cause, and stop re-classifying unchanged manifests every request

  **Fixed: a client span stayed OK when the tool it called reported failure.**
  `isError: true` arrives inside a well-formed result, so nothing throws and the
  call was being marked successful — leaving the caller's half of the trace
  claiming success while the server's own span already said ERROR. `callTool` now
  sets `error.type=tool_error` and an ERROR status on that result, matching the
  server, and its duration metric carries the error too.

  **Fixed (behaviour change): the guard bridge was told every non-throwing call
  succeeded.** The recorded step hardcoded `error: false`, so a tool reporting
  `isError` counted as a success and an error-loop rule could never accumulate on
  the failure mode MCP tools actually use. The step now carries the tool's own
  verdict. **If you pass a `guard`, expect it to trip on runs it previously let
  through** — that is the point, but it is a live enforcement change, not just a
  reporting one.

  **Added: `mcp.failure.category` and `mcp.failure.fingerprint`.** `error.type`
  already said a call failed; nothing said whether ten failures were one bug ten
  times or ten separate bugs. Every failure path is covered on both sides of the
  trace — a handler or a call that throws, and an `isError` result produced or
  received — including `resources/read` and `prompts/get`, whose transport
  failures reject rather than returning `isError`. Both ends fingerprint identical
  text identically, so one bug is one group whichever side recorded it.

  The fingerprint is a hash of the failure text with run-specific values removed
  (UUIDs, long hex runs, every digit run, quoted values), so two occurrences of one
  cause agree on it across processes. That is the property that matters on a
  stateless deployment: with no session to accumulate against, correlation has to
  happen on something every span already carries, and this is on the span whichever
  instance served the call.

  - Classification runs on the **raw** text, never the normalised form —
    normalisation replaces digit runs, which would erase the `401`/`503` the
    channel patterns key on. Channels are ordered most-specific-first, so
    `504 Gateway Timeout` reads as `timeout` rather than `dependency`.
  - Only the category reaches the duration metric. The fingerprint is one series
    per distinct bug and stays on the span, where the volume is already per-call.
  - A failure with no text gets neither attribute. Fingerprinting the empty string
    would collapse every unrelated silent failure into one group, which reads as a
    single high-frequency bug that does not exist.
  - `classifyFailure`, `fingerprintFailure`, `normalizeFailureMessage`,
    `extractFailureText` and `failureTextFromError` are exported, so the same
    grouping can be applied to failures this package does not wrap.

  **Fixed: a `securityClassifier` was billed once per request instead of once per
  manifest.** Manifest assessment happens at registration time, and `2026-07-28`
  builds a server per request — so `instrumentMcpServer` runs per request too, and
  every request re-classified descriptions that had not changed. With an LLM-backed
  classifier that is per-request latency and spend on a constant. Assessments are
  now memoised at module scope, the only scope that outlives the per-request server.

  The memo is keyed by classifier first, then by the normalised manifest surface:
  two configs may disagree about the same text, and a shared verdict would
  attribute one classifier's security finding to the other. A changed description
  re-classifies, so a redeploy that edits a manifest is still caught.

## 48.0.0

### Patch Changes

- Updated dependencies [e8f2d0f]
  - autotel@6.5.0

## 47.0.0

### Patch Changes

- Updated dependencies [09888cd]
  - autotel@6.4.0

## 46.0.0

### Patch Changes

- Updated dependencies [fb6bee2]
  - autotel@6.3.0

## 45.0.0

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

## 44.0.0

### Patch Changes

- Updated dependencies [85a0e88]
  - autotel@6.1.0

## 43.0.0

### Patch Changes

- 756345d: Skills no longer ship inside the npm package tarballs. They now live at the repo root under `skills/`, grouped into `core/`, `frameworks/`, `integrations/`, and `contributing/`, as a single source of truth discovered by the skills CLI (`npx skills add jagreehal/autotel --skill <name>`). `skills` is removed from each package's `files` field, so installing a package no longer adds its skill to `node_modules`. Install skills explicitly with the CLI instead.
- Updated dependencies [756345d]
- Updated dependencies [756345d]
  - autotel@6.0.0

## 42.0.0

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

## 41.0.0

### Patch Changes

- Updated dependencies [4f4f074]
- Updated dependencies [4f4f074]
  - autotel@4.3.0

## 40.0.1

### Patch Changes

- 3d9e31c: Relicense from MIT to Apache-2.0. The `license` field now reads `Apache-2.0`, and the package ships the Apache-2.0 `LICENSE`. This changes the licence only; there are no API changes. Prior releases remain available under their original MIT terms. See `NOTICE` and `TRADEMARKS.md` in the repository root for attribution and the "autotel" trademark policy.
- Updated dependencies [3d9e31c]
  - autotel@4.2.5

## 40.0.0

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

## 39.0.0

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

### Patch Changes

- Updated dependencies [12c6b6d]
  - autotel@4.1.0

## 38.0.0

### Patch Changes

- Updated dependencies [db0cce2]
  - autotel@4.0.0

## 37.0.0

### Patch Changes

- Updated dependencies [140fc76]
  - autotel@3.7.0

## 36.0.0

### Patch Changes

- Updated dependencies [47a69ac]
  - autotel@3.6.0

## 35.0.0

### Patch Changes

- Updated dependencies [1c43d26]
- Updated dependencies [3ab5dc3]
  - autotel@3.5.0

## 34.0.0

### Patch Changes

- Updated dependencies [20a1186]
  - autotel@3.4.0

## 33.0.1

### Patch Changes

- 4ce86fc: Refresh package dependencies across the workspace and keep generated lockfile state in sync.

  Add OTLP/protobuf ingestion support to `autotel-devtools` for traces, logs, and metrics. The devtools HTTP receiver now accepts both OTLP/JSON and OTLP/protobuf payloads on the existing `/v1/traces`, `/v1/logs`, and `/v1/metrics` endpoints, decodes protobuf payloads with embedded OTLP schemas, and includes interop coverage using the OpenTelemetry protobuf serializers.

- Updated dependencies [4ce86fc]
  - autotel@3.3.1

## 33.0.0

### Patch Changes

- Updated dependencies [30a485b]
  - autotel@3.3.0

## 32.0.0

### Patch Changes

- Updated dependencies [9fbbc3a]
  - autotel@3.2.0

## 31.0.0

### Patch Changes

- Updated dependencies [614d414]
  - autotel@3.1.0

## 30.0.4

### Patch Changes

- 1a8bedd: Updated dependencies
- Updated dependencies [1a8bedd]
  - autotel@3.0.5

## 30.0.3

### Patch Changes

- 5e146a7: Streamline package surface and align skills with the [Agent Skills specification](https://agentskills.io/specification).
  - Drop `@tanstack/intent` from runtime and dev dependencies, plus the auto-generated `bin/intent.js` shims. Skills still ship under each package's `skills/` directory and are discovered by spec-compliant agents (Claude Code, Cursor, Cline, etc.) via filesystem scan — no consumer-side CLI required.
  - Remove the `autotel/workers` and `autotel/cloudflare` entry points from `autotel`. Cloudflare Workers users should import directly from `autotel-cloudflare` (and its `/logger`, `/sampling`, `/events` subpaths). `autotel` no longer peer-depends on `autotel-cloudflare` or `autotel-edge`.
  - Strip non-spec frontmatter (`type`, `library`, `library_version`, `sources`, `requires`) from all `SKILL.md` files; keep only spec-defined fields (`name`, `description`, optional `license`).
  - Move user-facing skills (`migrate-to-autotel`, `tune-sampling`, `debug-missing-spans`, `build-audit-trails`) into `packages/autotel/skills/` so consumers receive them automatically via npm. Contributor-only skills (`create-autotel-adapter`, `create-autotel-instrumentation`, `create-autotel-exporter`) remain under the repo-root `skills/` directory.
  - Realign `autotel`'s peer dependency ranges to match published versions on npm.
  - Release workflow now refreshes `pnpm-lock.yaml` after `changeset version` so the next Version Packages PR ships with a consistent lockfile.

- Updated dependencies [5e146a7]
  - autotel@3.0.3

## 30.0.2

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

## 30.0.1

### Patch Changes

- 5d05a3e: Add Cloudflare Workers support to main `autotel` package. Introduces `autotel/workers` and `autotel/cloudflare` entry points that re-export the functional API and Cloudflare-specific instrumentation from `autotel-cloudflare`, providing better DX for Cloudflare users while keeping the core package modular. Updates package exports, build config, and documentation.
- Updated dependencies [5d05a3e]
  - autotel@3.0.1

## 30.0.0

### Patch Changes

- Updated dependencies [b1f3704]
  - autotel@3.0.0

## 29.0.1

### Patch Changes

- dc4908d: Updated deps
- Updated dependencies [dc4908d]
  - autotel@2.26.3

## 29.0.0

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
  - autotel@2.26.0

## 28.0.2

### Patch Changes

- 7d77567: Add opt-in OTLP log export and improve terminal UX.

  **autotel**
  - Add `logs: true` option to `init()` that auto-configures `BatchLogRecordProcessor` + `OTLPLogExporter` from the endpoint — no manual imports needed. Defaults to `false` (opt-in) to preserve existing behavior and upstream `OTEL_LOGS_EXPORTER` handling.
  - Add `resolveLogsFlag()` with `AUTOTEL_LOGS` env var override, matching the `metrics` pattern.
  - Move `@opentelemetry/exporter-logs-otlp-http` and `@opentelemetry/sdk-logs` from optional peer deps to regular dependencies.
  - Export `RedactingLogRecordProcessor` from `posthog-logs.ts` for reuse by the auto-configured log pipeline.

  **autotel-terminal**
  - AI panel: show configuration guidance when no provider is detected; only enter input mode when a provider is available.
  - AI panel: Escape now closes the panel entirely (not just exits input mode).
  - Add `f` key for typeable traceId filter with Tab autocomplete against known trace IDs.
  - Add Tab-to-traceId autocomplete in `/` search mode (4+ character prefix match).
  - Add Escape to exit search mode (in addition to existing `/` toggle and Enter).

- Updated dependencies [7d77567]
  - autotel@2.25.2

## 28.0.1

### Patch Changes

- c6010e1: Improve package compatibility and tooling consistency across the monorepo.
  - Add CommonJS build output/exports where missing (including `autotel` entrypoints and backend/MCP package builds) to improve `require()` interoperability.
  - Roll forward shared dependency versions across affected packages/apps to keep examples and libraries aligned on the same toolchain.

- Updated dependencies [c6010e1]
  - autotel@2.25.1

## 28.0.0

### Minor Changes

- 04c370a: This release rolls out a monorepo-wide refresh across the Autotel package family with coordinated minor updates.

  Highlights:
  - Align package internals and workspace metadata for the next release wave.
  - Improve reliability of test and quality workflows used across packages.
  - Keep package behavior and public APIs consistent while shipping incremental enhancements across the ecosystem.

### Patch Changes

- Updated dependencies [04c370a]
  - autotel@2.25.0

## 27.0.0

### Patch Changes

- Updated dependencies [88b4eab]
- Updated dependencies [88b4eab]
  - autotel@2.24.0

## 26.0.1

### Patch Changes

- 65b2fc9: - Bug fixes and dependency updates across packages.
  - example-vitest: API tests use a random port (when `API_BASE_URL`/`PORT` unset) to avoid EADDRINUSE on port 3000.
- Updated dependencies [65b2fc9]
  - autotel@2.23.1

## 26.0.0

### Patch Changes

- Updated dependencies [eb28f60]
- Updated dependencies [f772504]
  - autotel@2.23.0

## 25.0.0

### Minor Changes

- 1155c72: - **autotel-backends**: Add Grafana backend; export and type updates.
  - **autotel, autotel-\***: Dependency bumps, docs/comment updates, and version alignment across the monorepo.

### Patch Changes

- Updated dependencies [1155c72]
  - autotel@2.22.0

## 24.0.0

### Minor Changes

- c710c71: Add option to hide free/busy times (or selected attributes) in console export and related exporters.

### Patch Changes

- Updated dependencies [c710c71]
  - autotel@2.21.0

## 23.0.0

### Patch Changes

- Updated dependencies [6b67787]
  - autotel@2.20.0

## 22.0.0

### Minor Changes

- d1bd8cd: - **autotel-sentry**: README updates : clarify Sentry SDK + OTel scenario, link to Sentry OTLP docs, note that Sentry ingestion request spans are not sent, fix `SentrySpanProcessor` backtick typo, add spec-volatility note.
  - **autotel-backends**: Preserve caught error in Google Cloud config : attach original error as `cause` when throwing the user-facing error so the `preserve-caught-error` lint rule is satisfied.

### Patch Changes

- Updated dependencies [d1bd8cd]
  - autotel@2.19.0

## 21.1.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [ecf920e]
  - autotel@2.18.1

## 21.0.0

### Patch Changes

- Updated dependencies [23ed022]
  - autotel@2.18.0

## 20.0.0

### Patch Changes

- Updated dependencies [e62eb75]
  - autotel@2.17.0

## 19.0.0

### Patch Changes

- Updated dependencies [8a6769a]
  - autotel@2.16.0

## 18.0.0

### Minor Changes

- c68a580: - **autotel**: Add correlation ID support for event-driven observability (stable join key across events, logs, and spans via AsyncLocalStorage; optional baggage propagation). Add events configuration for `init()`: `includeTraceContext`, `traceUrl`, and baggage enrichment with allow/deny and transforms. Event queue and event subscriber now attach correlation ID and trace context to events. New `autotel/correlation-id` and `autotel/events-config` types used internally; init accepts `events` option.
  - **autotel-subscribers**: EventSubscriber base class and adapters (PostHog, Mixpanel, Amplitude) updated to use `autotel/event-subscriber` types and AutotelEventContext; graceful shutdown and payload normalization aligned with new event context and correlation ID.
  - **autotel-edge**, **autotel-cloudflare**, **autotel-aws**, **autotel-backends**, **autotel-tanstack**, **autotel-terminal**, **autotel-plugins**, **autotel-cli**, **autotel-mcp**, **autotel-web**: Version bumps for compatibility with autotel core.

### Patch Changes

- Updated dependencies [c68a580]
  - autotel@2.15.0

## 17.0.1

### Patch Changes

- acfd0de: Add comprehensive test coverage for Datadog backend configuration, including validation, direct cloud ingestion, agent mode, and OTLP logs export functionality.
- Updated dependencies [acfd0de]
  - autotel@2.14.1

## 17.0.0

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
  - autotel@2.14.0

## 16.0.0

### Minor Changes

- 8256dac: Add comprehensive awaitly integration example demonstrating workflow instrumentation with autotel OpenTelemetry. The new `awaitly-example` app showcases successful workflows, error handling, decision tracking, cache behavior, and visualization features. Updated prettier to 3.8.1 across all packages.

### Patch Changes

- Updated dependencies [8256dac]
  - autotel@2.13.0

## 15.0.1

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
  - autotel@2.12.1

## 15.0.0

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
  - autotel@2.12.0

## 14.0.0

### Patch Changes

- Updated dependencies [92206af]
  - autotel@2.11.0

## 13.0.0

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
  - autotel@2.10.0

## 12.0.0

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
  - autotel@2.10.0

## 11.0.0

### Patch Changes

- Updated dependencies [05f2d95]
  - autotel@2.9.0

## 10.0.0

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
  - autotel@2.8.0

## 9.0.0

### Patch Changes

- bc0e668: feat: Add AWS and TanStack Start instrumentation packages

  ## New Packages

  ### autotel-aws

  OpenTelemetry instrumentation for AWS services - ergonomic, vendor-agnostic observability.

  **Features:**
  - **Lambda Handler Instrumentation** - `wrapHandler()` with automatic cold start detection
  - **Zero-Config Mode** - `import 'autotel-aws/lambda/auto'` reads from env vars
  - **AWS SDK v3 Auto-Instrumentation** - `autoInstrumentAWS()` patches all SDK clients globally
  - **Per-Client Instrumentation** - `instrumentSDK()` for selective tracing
  - **SQS Producer/Consumer** - End-to-end distributed tracing with automatic context propagation
  - **SNS Publisher** - Automatic context injection for pub/sub tracing
  - **Kinesis Producer/Consumer** - Stream processing with trace context in records
  - **Step Functions Executor/Worker** - State machine orchestration with distributed tracing
  - **EventBridge Publisher** - Event-driven architecture tracing
  - **X-Ray Compatibility** - `setXRayAnnotation()` and `setXRayMetadata()` for X-Ray users
  - **Middy Middleware** - `tracingMiddleware()` for Middy-based handlers
  - **Lambda Layer** - Pre-built layer for easy deployment
  - **Service-Specific Semantic Helpers** - `traceS3()`, `traceDynamoDB()`, `traceKinesis()`, etc.

  **Tree-shakeable entry points:** `/lambda`, `/lambda/auto`, `/sdk`, `/s3`, `/dynamodb`, `/sqs`, `/sns`, `/kinesis`, `/step-functions`, `/eventbridge`, `/xray`, `/testing`, `/attributes`

  ### autotel-tanstack

  OpenTelemetry instrumentation for TanStack Start - automatic tracing for server functions, middleware, and route loaders.

  **Features:**
  - **Zero-Config Option** - `import 'autotel-tanstack/auto'` to enable tracing via env vars
  - **Middleware-Based API** - `tracingMiddleware()` and `functionTracingMiddleware()` align with TanStack patterns
  - **Server Function Tracing** - Automatic spans for `createServerFn()` with argument/result capture
  - **Route Loader Tracing** - `traceLoader()` and `traceBeforeLoad()` for route instrumentation
  - **Handler Wrapper** - `wrapStartHandler()` for complete request tracing with full control
  - **Browser Support** - Separate browser builds with no-op implementations
  - **Testing Utilities** - `createTestHarness()` for test assertions

  **Supported frameworks:** @tanstack/react-start and @tanstack/solid-start

  **Tree-shakeable entry points:** `/auto`, `/middleware`, `/server-functions`, `/loaders`, `/context`, `/handlers`, `/testing`, `/debug-headers`, `/metrics`, `/error-reporting`

  ## Fixes
  - **autotel-backends**: Align config property name (`otlpHeaders` → `headers`) with core autotel API
  - **autotel-edge**: Remove unnecessary type cast in dummy context
  - **autotel-mcp**: Fix internal import paths

- Updated dependencies [bc0e668]
  - autotel@2.7.0

## 8.0.0

### Patch Changes

- Updated dependencies [2ae2ece]
  - autotel@2.6.0

## 7.0.0

### Patch Changes

- Updated dependencies [745ab4c]
  - autotel@2.5.0

## 6.0.0

### Patch Changes

- Updated dependencies [31edf41]
  - autotel@2.4.0

## 5.0.0

### Patch Changes

- Updated dependencies [38f0462]
  - autotel@2.4.0

## 4.0.0

### Patch Changes

- Updated dependencies [bb7c547]
  - autotel@2.3.0

## 3.0.0

### Minor Changes

- 79f49aa: Updated example

### Patch Changes

- Updated dependencies [79f49aa]
  - autotel@2.2.0

## Released

Initial release as `autotel-mcp` (renamed from `autotel-mcp`).
