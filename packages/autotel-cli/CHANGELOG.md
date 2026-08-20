# autotel-cli

## 0.16.0

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
  - autotel-mcp@0.5.0

## 0.15.3

### Patch Changes

- Updated dependencies [b37813b]
  - autotel-mcp@0.4.1

## 0.15.2

### Patch Changes

- Updated dependencies [09888cd]
  - autotel-mcp@0.4.0

## 0.15.1

### Patch Changes

- Updated dependencies [fb6bee2]
  - autotel-mcp@0.3.0

## 0.15.0

### Minor Changes

- 0f518c6: Measure ingest-to-queryable lag, and send to Logfire and Langfuse.

  **`autotel health --otlp-endpoint <url>`** writes one probe span and polls the
  read backend until it comes back, reporting `freshness.timeToQueryableSeconds`.

  This is the number that decides whether a write-then-read loop works at all.
  Hosted backends differ by two orders of magnitude in ingest lag, and on a slow
  one an agent that writes and immediately reads sees nothing and concludes the
  operation produced no telemetry. Reachability alone doesn't distinguish those.

  - The probe span is serialized by `@opentelemetry/otlp-transformer`, so the
    payload is whatever the spec says rather than hand-built JSON.
  - It sends OTLP **protobuf** by default — the encoding every OTLP/HTTP receiver
    must accept, and the only one some vendors take. The built-in collector parses
    JSON and is switched automatically; `--otlp-encoding json|protobuf` overrides.
    A rejected payload reports which encoding was sent and which to try.
  - Auth for hosted endpoints comes from the standard
    `OTEL_EXPORTER_OTLP_HEADERS` (`Authorization=<token>`), so no token reaches
    argv. Note this is the **write** credential, which for most vendors is a
    different token from the read one the query backend uses.
  - `--freshness-timeout-ms` bounds the wait (default 120000).

  **New backend presets** in `autotel-backends`:

  ```typescript
  import { createLogfireConfig } from 'autotel-backends/logfire';
  import { createLangfuseConfig } from 'autotel-backends/langfuse';
  ```

  Both force OTLP/HTTP, since neither vendor accepts gRPC and most OTel SDKs
  default to it. `createLogfireConfig` defaults to Logfire's token-routed ingest
  host so a token from one data region can't fail against another region's
  endpoint, and sends the write token bare — its query API wants
  `Bearer <read-token>` instead, a different credential in a different format.
  `createLangfuseConfig` builds basic auth from the public/secret key pair and
  opts into v4 ingestion, which keeps traces queryable promptly.

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

- 0f518c6: Report a rate-limited backend as retryable.

  A 429 that outlasted the HTTP layer's retry budget was returned as
  `AUTOTEL_E_UNKNOWN` with `retryable: false`, which says the query failed for
  good. An agent reading that answers "no data" instead of waiting for the limit
  window and asking again — a confident wrong answer drawn from a transient
  condition.

  It now returns `AUTOTEL_E_RATE_LIMITED` with `retryable: true` and a message
  saying to wait for the window to reset. Found while driving the Logfire backend
  against a live project, whose query API allows roughly ten requests a minute.

- Updated dependencies [0f518c6]
- Updated dependencies [0f518c6]
  - autotel-mcp@0.2.0

## 0.14.0

### Minor Changes

- 85a0e88: Add `autotel map`, plus request lifecycle correctness fixes.

  **`autotel map`** scores the observability of every entry point in a project. It
  reads the source (no runtime, no network), detects the framework, finds every
  entry point, and reports what context you would have when each one breaks:
  whether it produces a span, whether that span carries business context, whether
  thrown errors explain themselves, whether catch blocks record the failure,
  whether money and auth paths leave an audit trail, and whether data-loading
  pages handle request failures.

  - `autotel map` — score plus the three entry points worth fixing first
  - `autotel map --all` — every entry point as a check matrix
  - `autotel map <route|file>` — one entry point, every check, and the code that fixes it
  - `autotel map --json` — every finding with `evidence` and `fix`, for agents
  - `autotel map --min-score <n>` / `--baseline [path|git:<ref>]` — CI gates; the
    baseline compares per check, so a refactor that instruments one route and
    breaks another still fails
  - `// autotel-map-disable <check> -- reason` waives a check in code; waived
    checks cost no score and are counted separately from real coverage
  - Opportunities highlight repeated inline errors in projects with an error
    catalog, and uncovered writes in projects that already record audit signals

  Frameworks: Next.js, Nitro/Nuxt, TanStack Start, SvelteKit, Hono, Express,
  Fastify, Elysia, Cloudflare Workers.

  **Request lifecycle:**

  - add `RequestLogger.setLevel()` for explicit canonical snapshot severity
  - add retry classification to `createDrainPipeline()` so permanent failures can
    be dropped without repeated delivery attempts
  - keep Next.js navigation signals out of error telemetry, including wrapped
    signals
  - defer Hono SSE, NDJSON, and AI-stream snapshots until the response body
    settles

## 0.13.1

### Patch Changes

- 756345d: Skills no longer ship inside the npm package tarballs. They now live at the repo root under `skills/`, grouped into `core/`, `frameworks/`, `integrations/`, and `contributing/`, as a single source of truth discovered by the skills CLI (`npx skills add jagreehal/autotel --skill <name>`). `skills` is removed from each package's `files` field, so installing a package no longer adds its skill to `node_modules`. Install skills explicitly with the CLI instead.
- Updated dependencies [756345d]
  - autotel-mcp@0.1.19

## 0.13.0

### Minor Changes

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

## 0.12.0

### Minor Changes

- 100cfad: Framework adapter DX overhaul, consolidation, and correctness fixes.

  **New adapters + toolkit (`autotel-adapters`).** Adds NestJS, SvelteKit, and Elysia
  subpaths built on a shared integration toolkit: deferred drain, streaming
  `finishResponse`, `waitUntil` wiring for serverless, and route exclusion that now
  bypasses span creation as well as wide-event emission.

  **One adapter mechanism (breaking).** The parallel per-framework factory/bundle
  layer is removed in favour of the direct handler wrappers, which were always the
  primary API:

  - **Removed** `createNextAdapter`, `createNitroAdapter`, `createCloudflareAdapter`,
    `createExpressAdapter`, `createFastifyAdapter`, `createNestAdapter`,
    `createSvelteKitAdapter`, `createElysiaAdapter`, every `*Toolkit` export
    (`honoToolkit`, `tanstackToolkit`, `nextToolkit`, …), and the underlying
    `createAdapterToolkit` / `createStandardAdapterExports` / `AdapterToolkit`
    helpers from `autotel-adapters/core`.
  - **Use instead** the direct exports — `withAutotel` / `withAutotelFetch` /
    `withAutotelEventHandler` / `autotelMiddleware` / `autotelHandle` /
    `new AutotelInterceptor(options)`, plus `useLogger`. Pass options per call site
    instead of pre-binding through a factory. `createUseLogger` and
    `createRequestRunner` remain for building custom adapters.
  - Migration: replace `const { withAutotel, useLogger } = createNextAdapter(opts)`
    with `import { withAutotel, useLogger } from 'autotel-adapters/next'` and
    `withAutotel(handler, opts)`; replace `honoToolkit.useLogger(c)` /
    `tanstackToolkit.useLogger(ctx)` with the module `useLogger`.

  **Correctness fixes.** `AutotelInterceptor.intercept()` now subscribes to the
  NestJS handler `Observable` inside the trace + request-context scope, proxying
  every value and preserving cancellation — so context propagation, span nesting,
  error capture, status/timing, and streaming semantics all work together (adds
  `rxjs` as an optional peer dependency on the NestJS subpath). Elysia now accepts
  the real context shape.

  **CLI telemetry (`autotel-cli`).** Adds opt-in usage telemetry (bundled into the
  CLI). Consent defaults to **off** — telemetry stays off until the user runs
  `autotel telemetry enable` or sets `AUTOTEL_TELEMETRY=1` — and delivery honours
  async context, rechecks consent, and retains the outbox on failed drains.

  **Devtools (`autotel-devtools`).** Adds a **Clear** button to the "Local data"
  bar that wipes all captured traces, logs, metrics and errors so you can watch
  only new activity, and a relative trace **time-range filter** (`Any time` /
  `Last 5m` / `Last 15m` / `Last 1h`) that is reflected in the shareable URL hash
  (`#range=5m`).

## 0.11.2

### Patch Changes

- 3d9e31c: Relicense from MIT to Apache-2.0. The `license` field now reads `Apache-2.0`, and the package ships the Apache-2.0 `LICENSE`. This changes the licence only; there are no API changes. Prior releases remain available under their original MIT terms. See `NOTICE` and `TRADEMARKS.md` in the repository root for attribution and the "autotel" trademark policy.
- Updated dependencies [3d9e31c]
  - autotel-mcp@0.1.18

## 0.11.1

### Patch Changes

- 4b7ad78: chore: routine dependency updates

  Refresh runtime and peer dependency ranges across published packages (`ncu`, 3-day release-age cooldown).

  The core `autotel` package moves to the latest OpenTelemetry libraries (stable `2.9.x`, experimental `0.220.x`, semantic-conventions `1.42.x`). This required adapting to a breaking change in `@opentelemetry/sdk-logs`: `BatchLogRecordProcessor` and `SimpleLogRecordProcessor` now take a `{ exporter }` options object instead of a positional exporter argument.

  Notable peer range bumps for consumers: `autotel-aws` (AWS SDK `3.1081`), `autotel-cloudflare` (`@cloudflare/workers-types` v5), `autotel-pact` (`@pact-foundation/pact` v17), `autotel-terminal` (`ai` v7).

- Updated dependencies [4b7ad78]
  - autotel-mcp@0.1.17

## 0.11.0

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
  - autotel-mcp@0.1.16

## 0.10.0

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

## 0.9.1

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

## 0.9.0

### Minor Changes

- 1c43d26: Security alerting and triage tooling.

  **autotel-subscribers**: new `SecuritySubscriber` (`autotel-subscribers/security`) — forwards `security.*` events from the Events pipeline to a webhook/SIEM or custom handler, gated by `minSeverity`, with normalized `SecurityAlert` payloads carrying severity/category/outcome/reason and trace correlation. Webhook delivery uses the same hardened pipeline as `WebhookSubscriber` (timeout-bounded requests, classified errors, exponential-backoff retries via `maxRetries`/`timeoutMs`/`retryDelayMs`).

  **autotel-cli**: new `autotel security` command group. `security summary` aggregates security events (by severity/category/outcome, top events), suspicious-request signals, and denied responses (401/403/429, top clients) over a time window; `security events` lists spans carrying the `security.*` schema with `--category`/`--severity` filters. Both emit the standard `{ ok, command, data }` JSON envelope on any supported backend.

### Patch Changes

- 3ab5dc3: chore: update dependencies + migrate workspace to vite 8

  Routine dependency refresh via npm-check-updates (3-day publish cooldown).
  - **Dev tooling:** vitest 4.1.8, `@types/node`, tsx, typescript-eslint 8.60.1, eslint 10.4.1, svelte 5.56, storybook 10.4.2, etc.
  - **Runtime/peer (published packages):** aws-sdk 3.1063, `@tanstack/{react,solid}-start` 1.168.25, hono 4.12.23, `@sentry/node` 10.56, `@cloudflare/workers-types`, react 19.2.7, ai-sdk / ai 6.0.197, `@traceloop/node-server-sdk` 0.27, google-auth-library 10.7, protobufjs 8.6, svelte 5.56.

  **Vite 8:** forced `vite ^8` across the workspace via a pnpm override. autotel was already partly on vite 8 (`@sveltejs/vite-plugin-svelte` 7 and `@vitejs/plugin-react` 6 both require it); storybook (svelte-vite), the astro docs, and the tanstack-start example all build cleanly on vite 8.

  eslint is held at `^9` in `apps/example-nextjs` (a private example) — `eslint-config-next` 16 / `eslint-plugin-react` are not yet eslint-10 compatible. Published packages are unaffected.

## 0.8.13

### Patch Changes

- Updated dependencies [e7f63f9]
  - autotel-mcp@0.1.13

## 0.8.12

### Patch Changes

- Updated dependencies [0818a9b]
  - autotel-mcp@0.1.12

## 0.8.11

### Patch Changes

- 4ce86fc: Refresh package dependencies across the workspace and keep generated lockfile state in sync.

  Add OTLP/protobuf ingestion support to `autotel-devtools` for traces, logs, and metrics. The devtools HTTP receiver now accepts both OTLP/JSON and OTLP/protobuf payloads on the existing `/v1/traces`, `/v1/logs`, and `/v1/metrics` endpoints, decodes protobuf payloads with embedded OTLP schemas, and includes interop coverage using the OpenTelemetry protobuf serializers.

- Updated dependencies [4ce86fc]
  - autotel-mcp@0.1.11

## 0.8.10

### Patch Changes

- Updated dependencies [3966db0]
  - autotel-mcp@0.1.10

## 0.8.9

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

- Updated dependencies [bc6a75c]
  - autotel-mcp@0.1.9

## 0.8.8

### Patch Changes

- 0c51733: Improve `autotel init` DX with a stricter, agent-native flow and safer merge behavior.
  - Add detection/plan-driven init modes: `--detect-only`, `--plan`, `--input`, `--scan-env`, plus JSON output controls (`--json`, `--output-file`, `--no-secrets-in-output`, `--no-interactive`).
  - Add agent discovery commands: `schema`, `schema errors`, `schema outputs`, `commands`, `examples`, and JSON `version`.
  - Introduce structured CLI errors (`AUTOTEL_E_*`) with stable envelopes and consistent exit-code mapping.
  - Remove legacy prompt fallback from `init`: when detection is disabled, a plan source (`--plan`, `--input`, or `--preset`) is now required.
  - Fix CLI-owned instrumentation merge logic to rewrite when rendered content changes (even if import sources are unchanged), preventing stale backend config/specifier drift.
  - Add coverage for merge regression and non-interactive/no-plan-source fail-fast behavior.

## 0.8.7

### Patch Changes

- 1a8bedd: Updated dependencies

## 0.8.6

### Patch Changes

- 5e146a7: Streamline package surface and align skills with the [Agent Skills specification](https://agentskills.io/specification).
  - Drop `@tanstack/intent` from runtime and dev dependencies, plus the auto-generated `bin/intent.js` shims. Skills still ship under each package's `skills/` directory and are discovered by spec-compliant agents (Claude Code, Cursor, Cline, etc.) via filesystem scan — no consumer-side CLI required.
  - Remove the `autotel/workers` and `autotel/cloudflare` entry points from `autotel`. Cloudflare Workers users should import directly from `autotel-cloudflare` (and its `/logger`, `/sampling`, `/events` subpaths). `autotel` no longer peer-depends on `autotel-cloudflare` or `autotel-edge`.
  - Strip non-spec frontmatter (`type`, `library`, `library_version`, `sources`, `requires`) from all `SKILL.md` files; keep only spec-defined fields (`name`, `description`, optional `license`).
  - Move user-facing skills (`migrate-to-autotel`, `tune-sampling`, `debug-missing-spans`, `build-audit-trails`) into `packages/autotel/skills/` so consumers receive them automatically via npm. Contributor-only skills (`create-autotel-adapter`, `create-autotel-instrumentation`, `create-autotel-exporter`) remain under the repo-root `skills/` directory.
  - Realign `autotel`'s peer dependency ranges to match published versions on npm.
  - Release workflow now refreshes `pnpm-lock.yaml` after `changeset version` so the next Version Packages PR ships with a consistent lockfile.

## 0.8.5

### Patch Changes

- 5d05a3e: Add Cloudflare Workers support to main `autotel` package. Introduces `autotel/workers` and `autotel/cloudflare` entry points that re-export the functional API and Cloudflare-specific instrumentation from `autotel-cloudflare`, providing better DX for Cloudflare users while keeping the core package modular. Updates package exports, build config, and documentation.

## 0.8.4

### Patch Changes

- dc4908d: Updated deps

## 0.8.3

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

## 0.8.2

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

## 0.8.1

### Patch Changes

- c6010e1: Improve package compatibility and tooling consistency across the monorepo.
  - Add CommonJS build output/exports where missing (including `autotel` entrypoints and backend/MCP package builds) to improve `require()` interoperability.
  - Roll forward shared dependency versions across affected packages/apps to keep examples and libraries aligned on the same toolchain.

## 0.8.0

### Minor Changes

- 04c370a: This release rolls out a monorepo-wide refresh across the Autotel package family with coordinated minor updates.

  Highlights:
  - Align package internals and workspace metadata for the next release wave.
  - Improve reliability of test and quality workflows used across packages.
  - Keep package behavior and public APIs consistent while shipping incremental enhancements across the ecosystem.

## 0.7.1

### Patch Changes

- 65b2fc9: - Bug fixes and dependency updates across packages.
  - example-vitest: API tests use a random port (when `API_BASE_URL`/`PORT` unset) to avoid EADDRINUSE on port 3000.

## 0.7.0

### Minor Changes

- 1155c72: - **autotel-backends**: Add Grafana backend; export and type updates.
  - **autotel, autotel-\***: Dependency bumps, docs/comment updates, and version alignment across the monorepo.

## 0.6.0

### Minor Changes

- c710c71: Add option to hide free/busy times (or selected attributes) in console export and related exporters.

## 0.5.0

### Minor Changes

- d1bd8cd: - **autotel-sentry**: README updates : clarify Sentry SDK + OTel scenario, link to Sentry OTLP docs, note that Sentry ingestion request spans are not sent, fix `SentrySpanProcessor` backtick typo, add spec-volatility note.
  - **autotel-backends**: Preserve caught error in Google Cloud config : attach original error as `cause` when throwing the user-facing error so the `preserve-caught-error` lint rule is satisfied.

## 0.4.2

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

## 0.4.1

### Patch Changes

- d3305c4: Fix trace codemod double-editing default export when a file has both `export default function` and other named functions. Step 1 now skips the default-export function so it is only edited in step 2, avoiding "node was removed or forgotten" when applying edits.

## 0.4.0

### Minor Changes

- 8a6769a: x

## 0.3.0

### Minor Changes

- c68a580: - **autotel**: Add correlation ID support for event-driven observability (stable join key across events, logs, and spans via AsyncLocalStorage; optional baggage propagation). Add events configuration for `init()`: `includeTraceContext`, `traceUrl`, and baggage enrichment with allow/deny and transforms. Event queue and event subscriber now attach correlation ID and trace context to events. New `autotel/correlation-id` and `autotel/events-config` types used internally; init accepts `events` option.
  - **autotel-subscribers**: EventSubscriber base class and adapters (PostHog, Mixpanel, Amplitude) updated to use `autotel/event-subscriber` types and AutotelEventContext; graceful shutdown and payload normalization aligned with new event context and correlation ID.
  - **autotel-edge**, **autotel-cloudflare**, **autotel-aws**, **autotel-backends**, **autotel-tanstack**, **autotel-terminal**, **autotel-plugins**, **autotel-cli**, **autotel-mcp**, **autotel-web**: Version bumps for compatibility with autotel core.

## 0.2.0

### Minor Changes

- 78202aa: Add logger instrumentation validation to `autotel doctor` command and update documentation for Winston/Bunyan setup.

  **autotel-cli:**
  - Add logger instrumentation check to `autotel doctor` that validates Winston, Bunyan, and Pino instrumentation packages are installed when configured
  - Parse source code to detect `autoInstrumentations` configuration and warn if instrumentation packages are missing
  - Add `logger-checker` utility to extract and validate logger instrumentation setup

  **autotel:**
  - Update README to clarify that Winston and Bunyan instrumentation packages must be installed separately, even though they're included in `@opentelemetry/auto-instrumentations-node`
  - Fix misleading "auto-detects" claims - all loggers require explicit `autoInstrumentations` configuration
  - Update Pino, Winston, and Bunyan examples to show correct setup with `autoInstrumentations` array

## 0.1.1

### Patch Changes

- acfd0de: Add comprehensive test coverage for Datadog backend configuration, including validation, direct cloud ingestion, agent mode, and OTLP logs export functionality.
