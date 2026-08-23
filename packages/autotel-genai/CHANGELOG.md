# autotel-genai

## 0.6.2

### Patch Changes

- 4c859aa: Join PostHog sessions to traces in both directions, and make the join work in a
  real browser.

  `joinPostHog()` wires PostHog's `before_send` half and returns the span enricher,
  so one call covers both directions: spans carry `session.id`, `user.id` and a
  timestamped `session.replay.url`; PostHog events carry `$trace_id`, `$span_id`
  and `$trace_url`; and the session id rides W3C baggage to the server span.

  Verified end to end against a live project — which is how the rest of this list
  was found. `apps/example-posthog` now runs against a real PostHog when
  `POSTHOG_KEY` is set, with a smoke test wired into CI.

  **autotel-posthog**

  - Events captured after an `await` now carry the trace. The browser has no
    `AsyncLocalStorage`, so the active context is gone by the time a fetch
    resolves — which is exactly when the events worth joining fire. The processor
    falls back to the spans it has seen start and not end, bounded so leaked spans
    cannot accumulate, and refuses when more than one trace is in flight rather
    than naming an unrelated request.
  - `traceProperties()` spreads the current ids onto a capture for the case the
    fallback cannot resolve. Caller-set ids win, and still earn their
    `$trace_url`.
  - `debug` explains every quiet exit — no usable PostHog, a rotated session,
    replay not recording — once per reason. On by default in development, silent
    in production.
  - `session.id` reaches baggage during `joinPostHog()`, not on the first span, so
    the page's first request carries it too.
  - Repeated calls (strict mode, HMR) no longer break the fallback or accumulate
    state.
  - `autotel-web` is a required peer of the root entry, which imports
    `autotel-web/baggage`.

  **autotel-web** — full-mode baggage now honours `privacy` (`blockedOrigins`,
  `respectDoNotTrack`, `respectGPC`), matching lean mode; previously only the
  destination allowlist applied. It also survives `fetch(request, init)` when
  `init.headers` is set, which used to discard the injected header.

  **autotel** — `init({ baggage: '' })` is a prefix ("copy baggage on, unprefixed"),
  not an off switch. The guard was truthiness, so the empty string silently
  disabled the processor and `session.id` never landed on server spans.

  **autotel-genai** — `autotelTelemetry()` covers `generateObject`/`streamObject`
  and live embedding duration, and stamps `user.id` / `gen_ai.conversation.id` from
  `runtimeContext`. Structured output now honours the per-call `recordOutputs`,
  which only the language-model and tool handlers checked. Abandoned embedding
  attempts are reported as errors instead of healthy spans — the SDK announces an
  attempt that succeeded and says nothing about one that threw. For `embed()`, and
  for any retry that reuses an attempt id, the failed attempt is closed when its
  replacement starts; under `embedMany()` the events carry no batch identity, so
  its duration is an honest upper bound rather than a guess that would truncate a
  concurrent batch.

- Updated dependencies [4c859aa]
  - autotel@7.0.1
  - autotel-audit@1.0.1

## 0.6.1

### Patch Changes

- Updated dependencies [d303348]
  - autotel@7.0.0
  - autotel-audit@1.0.0

## 0.6.0

### Minor Changes

- 31fd178: Eval-sandbox incident replay: cross-agent shared-channel detection, run identity, honey tokens, and span forensics

  New helpers under `autotel-genai/agent` for the case where several eval agents
  share a writable resource and start coordinating through it:

  - `detectCrossAgentPattern()` — pure function that groups events by the shared
    resource (or memory isolation key) and flags a resource touched by more than
    `minAgents` distinct agent identities inside a sliding window.
    `crossAgentDetectionsToSecurityEvents()` maps detections to `autotel-audit`
    `securityEvent` payloads, and `CrossAgentMonitor` runs the same detection live
    as tools execute, emitting each resource only once.
  - `recordEvalRunIdentity()` + `EVAL_IDENTITY_ATTR` — stamp `eval.run_id`,
    `eval.task_id` and `eval.sandbox_id` so runs stay separable downstream.
  - `createHoneyTokenTool()` — a decoy credential tool that emits a critical
    security event when an agent touches it.
  - `querySpansForEvalIncident()` + `spansToCrossAgentEvents()` — batch forensics
    over an exported span array: policy denials, elevated plan risk,
    exfil-capable actions, and cross-agent alerts.

  Shared-registry access is grouped by the registry path, deliberately **not** by
  the calling sandbox. Two isolated sandboxes reaching one registry is the breach
  being looked for, so keying the group by the caller would give each run its own
  group and the detector could never fire. The caller stays identifiable through
  `agentId`.

  Security events use the `llm` category and `error` severity — `autotel-audit`'s
  `SecurityEventCategory` has no `agent` member and `SecuritySeverity` is
  `info | warning | error | critical`, so the agent framing lives in the event name
  and `targetType` instead.

  The package's TypeScript `lib` moves from `ES2022` to `ES2023`, matching core
  `autotel` and the other packages that already use `Array#toSorted`. `target`
  is unchanged, so emitted output is identical.

## 0.5.0

### Minor Changes

- e8f2d0f: Langfuse compatibility, verified against a self-hosted Langfuse v4 and Langfuse
  Cloud, plus a Mastra observer.

  - **New package `autotel-langfuse`.** `langfuseCompatibility()`, a span processor
    filling the fields Langfuse keeps in dedicated columns and no OpenTelemetry
    convention covers: trace name, tags, release, version, prompt linking, and the
    absolute "time to first token" derived from streaming timing. It depends on no
    Langfuse package, which is the point: Langfuse ingests plain OTLP and reads
    canonical `gen_ai.*`, so types, usage, cost, input/output, user and session all
    arrive with nothing but a `destinations` entry.
  - **`langfuseScores()`**: evaluation results as Langfuse scores. Scores are the
    one thing OTLP cannot carry, so the bridge posts to `/api/public/scores` with
    the same Basic auth as the OTLP endpoint, rather than depending on
    `@langfuse/client`. `autotel-genai` already emits the evaluation event and
    autotel already stamps it with its trace, so it is an event subscriber.
  - **`langfuseMedia()`**: base64 payloads uploaded once and referenced by a token,
    instead of megabytes of `data:` URI through the OTLP pipeline on every request.
    `replaceDataUris()` works on the serialised messages directly, so there is no
    message tree to walk. It is an async call in application code rather than a
    span processor, because `onEnd` is synchronous and Langfuse assigns the media
    id — there is nowhere in a processor to await the upload the attribute depends
    on.
  - **`gen_ai.prompt.name` and `gen_ai.prompt.version` are now removed from the
    span once mapped**, not copied. Langfuse reads anything under the
    `gen_ai.prompt` prefix as the legacy prompt-content convention and then takes
    input and output from that convention alone, so a span naming its prompt
    arrived with `{"name": ..., "version": ...}` as its input and `{}` as its
    output, discarding `gen_ai.input.messages` and `gen_ai.output.messages`
    entirely. An enricher runs once for the whole pipeline, so this pair is now
    absent from every destination, not only Langfuse.
  - **A contract test against a real Langfuse.** `pnpm --filter autotel-langfuse
test:contract` sends spans, a score and a media payload to the stack in
    `docker/langfuse.yml` and reads them back through public API surfaces only.
    `/api/public/v2/metrics` rejects a query naming a dimension it does not have,
    so a rename upstream fails the suite by name instead of quietly emptying a
    column. It runs against Langfuse Cloud too, reading through the entity
    endpoints where they exist and waiting out the rate limiter rather than racing
    it. Nightly in CI, and on pull requests that touch the mapping. The default
    `test` run skips it and needs no Docker.
  - **Observed spans attach to the surrounding span.** `createGenAiObserver` forced
    a detached root whenever an event carried no tracked parent, so every AI SDK
    call landed in a trace of its own and a backend that groups by trace id showed
    the pipeline and the model calls it made as unrelated. It now falls back to the
    active context. Pass `resolveParentContext: () => undefined` for the queue and
    background-worker case where the ambient context is the wrong parent.
  - **Cost survives the trip.** `gen_ai.usage.cost` is emitted alongside autotel's
    `gen_ai.usage.cost.usd`. Langfuse, and everything else that followed
    OpenLLMetry, reads the former, and a cost recorded only under a name the
    backend does not know is a cost you cannot see.
  - **`spanEnrichers`**: span processors that are added to the exporting pipeline
    rather than replacing it. `spanProcessors` takes the pipeline over, so a
    processor that only decorates spans would silently switch off every configured
    destination.
  - **`createMastraObserver()`** — Mastra spans as autotel spans. Mastra's
    observability pipeline dispatches `span_started` / `span_ended` events with
    `id` and `parentSpanId`, which is exactly the shape `createGenAiObserver`
    consumes, so the adapter is an `ObservabilityExporter` you pass to the `Mastra`
    constructor. `agent_run` → `invoke_agent`, `model_generation` → `chat`,
    `rag_embedding` → `embeddings`, every tool-call type → `execute_tool`,
    `workflow_run` / `workflow_step` → `invoke_workflow`. Plumbing — model steps
    and chunks, processors, scorers, mappings — is dropped and its children
    reparent to the nearest kept ancestor; pass `skipSpan` to drop additional
    supported types. `model_step` and `model_inference` are dropped deliberately:
    their usage is already summed on the enclosing `model_generation`, so keeping
    both would double-count `gen_ai.usage.*`. `@mastra/otel-exporter` already emits
    canonical `gen_ai.*` to any OTLP endpoint, so this is not about making Mastra
    observable at all — it is about the spans being autotel's. That exporter owns
    its own endpoint and its own span processor and rebuilds spans from Mastra's
    trace ids after the fact, which leaves the agent run in a trace of its own,
    outside every `spanEnricher` — so `langfuseCompatibility` never names its trace
    or links its prompt — and without cost. Mastra dispatches its events
    synchronously, so this adapter emits them on autotel's tracer under the ambient
    context instead: the run nests inside the request span that triggered it,
    reaches every configured destination, and gets priced. Typed structurally, so
    it adds no Mastra dependency, and verified end to end against a real Mastra
    1.57 app running a tool-calling agent on local Ollama.

### Patch Changes

- Updated dependencies [e8f2d0f]
  - autotel@6.5.0
  - autotel-audit@0.4.15

## 0.4.2

### Patch Changes

- Updated dependencies [b37813b]
  - autotel@6.4.1
  - autotel-audit@0.4.14

## 0.4.1

### Patch Changes

- Updated dependencies [09888cd]
  - autotel@6.4.0
  - autotel-audit@0.4.13

## 0.4.0

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

### Patch Changes

- Updated dependencies [fb6bee2]
  - autotel@6.3.0
  - autotel-audit@0.4.12

## 0.3.12

### Patch Changes

- Updated dependencies [7bad202]
  - autotel@6.2.1
  - autotel-audit@0.4.11

## 0.3.11

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
  - autotel-audit@0.4.10

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
