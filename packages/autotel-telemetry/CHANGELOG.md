# autotel-telemetry

## 0.2.0

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

## 0.1.2

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

## 0.1.1

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
