# autotel-posthog

## 7.0.0

### Minor Changes

- 10c3f93: Track the current OpenTelemetry releases: SDK 2.11.0, experimental 0.222.0,
  auto-instrumentations 0.80.0.

  Spans now carry the current names for the attributes OpenTelemetry has renamed,
  so they line up with every other OTel producer:

  | before                | now                         |
  | --------------------- | --------------------------- |
  | `http.method`         | `http.request.method`       |
  | `http.status_code`    | `http.response.status_code` |
  | `http.url`            | `url.full`                  |
  | `http.scheme`         | `url.scheme`                |
  | `http.host`           | `server.address`            |
  | `http.target`         | `url.path` (+ `url.query`)  |
  | `db.system`           | `db.system.name`            |
  | `db.operation`        | `db.operation.name`         |
  | `db.name`             | `db.namespace`              |
  | `db.statement`        | `db.query.text`             |
  | `db.sql.table`        | `db.collection.name`        |
  | `rpc.system`          | `rpc.system.name`           |
  | `messaging.operation` | `messaging.operation.type`  |

  This covers `autotel`, `autotel-aws`, `autotel-cloudflare`, `autotel-tanstack`
  and `autotel-web`. Queries, dashboards and alerts pinned to the previous
  spellings should move to the new ones. `deployment.environment` now ships
  alongside `deployment.environment.name` everywhere, matching what `init()`
  already did.

  Everything that reads spans — `autotel-devtools`, `autotel-terminal`,
  `autotel-mcp`, `autotel-agents`, `autotel-audit`, `autotel-vscode`,
  `autotel-cli` — accepts both spellings, so existing traces keep rendering,
  filtering and aggregating as they did.

  `rpc.service` is unchanged. `autotel-drizzle` and `autotel-plugins` keep their
  `'legacy'` semconv mode exactly as documented.

### Patch Changes

- Updated dependencies [dbd968d]
- Updated dependencies [10c3f93]
  - autotel-web@1.15.0
  - autotel@7.6.0
  - autotel-subscribers@56.0.0

## 6.0.0

### Patch Changes

- Updated dependencies [a271e71]
  - autotel@7.5.0
  - autotel-web@1.14.1
  - autotel-subscribers@55.0.0

## 5.0.0

### Minor Changes

- 29546bf: Emit browser telemetry under the names and signal types OpenTelemetry already
  defines, add the signals it has no name for, and stop losing data on the way out.

  ## Canonical names, emitted as events

  Every browser signal had a specification name and was going out under a
  homegrown one — so a dashboard built on the conventions found an empty panel and
  read it as "this never happened".

  | before                                    | now                                                     |
  | ----------------------------------------- | ------------------------------------------------------- |
  | span `click: x`, `user.interaction.type`  | `app.widget.click` + `app.widget.*` / `app.screen.*`    |
  | `web_vitals.lcp` on one shared span       | `browser.web_vital` per metric, with `delta` and `id`   |
  | span `long_task`, `long_task.duration_ms` | `app.jank` + `app.jank.period` / `.threshold` (seconds) |
  | `session.id` only                         | plus `session.start` / `session.end`                    |
  | `feature_flag.<key>` (autotel-posthog)    | canonical `feature_flag.*` + `feature_flag.evaluation`  |

  **These are log records, not spans.** An OpenTelemetry event _is_ a log record;
  a zero-duration span is invisible to event dashboards and produces nothing at
  all in lean mode. Query them where your logs are. `packages/autotel-web/src/semconv.ts`
  is the source of truth, pinned by a test.

  **Breaking for queries, not for types.** Anything matching the old span names or
  attributes needs updating.

  ## New in autotel-web
  - **`captureFrustration`** — dead and rage clicks as
    `app.widget.click.frustration`. A click that does nothing runs no code, so the
    trace is empty exactly where the user is stuck; no tracing backend can produce
    this for itself.
  - **`breadcrumbs`** — a byte-bounded trail of clicks and console output,
    attached to exceptions as `exception.breadcrumbs`.
  - **`captureEngagement`** — `browser.page_engagement` with scroll depth **and**
    content depth: on a page shorter than the viewport nothing scrolls, so scroll
    depth alone reads a fully-read page as a bounce.
  - **`captureConsoleLogs`** — `console.*` as OTLP log records. The package had a
    trace signal and no log signal at all.
  - **`remoteConfigUrl`** — sampling and capture toggles from a JSON file you
    already serve, cached and applied synchronously on the next visit. Capture
    toggles let remote win both ways; suppression rules are additive only, because
    there the failure mode is silently losing errors.
  - **`browser.*` resource context**. `user_agent.*` is left to the collector,
    which has a real UA database.
  - **Session-consistent sampling.** `sampleRate` hashes `session.id` (or a
    private page key when sessions are off) and covers spans, logs and events
    alike. Random per-span sampling kept a tenth of every session and left none
    reconstructable.

  ## New in autotel

  `autotel/feature-flags` — `recordFeatureFlag()` and `autotelOpenFeatureHook()`
  emit the canonical `feature_flag.*` attributes plus a `feature_flag.evaluation`
  log record, so a rollout can be split by variant in any backend. Values keep
  their type, reasons are normalised to the registry's lower snake case, and
  `feature_flag.error.message` replaces the deprecated
  `feature_flag.evaluation.error.message`.

  ## Delivery

  Browser spans were posted once and dropped on failure — silently, and
  indistinguishably from a user who never showed up. Now: jittered backoff,
  offline queueing, a 1000-record cap, and `fetch` while the page is alive so
  there is a status to retry against. `sendBeacon` is kept for unload, clears the
  queue only when it returns `true`, and carries the batch mid-backoff. Retry
  exhaustion discards only the exhausted batch. A responseless failure while
  online is treated as blocked, not broken — that is an ad blocker, and retrying
  it forever only burns battery.

  Lean mode grows from ~3.7KB to ~5.4KB gzipped for this; full mode from ~34KB to
  ~39KB.

  ## autotel-genai
  - **Inline binary is redacted, not inflated.** Buffers and data URLs were being
    base64-encoded into `gen_ai.input.messages`, so one multimodal call produced a
    multi-megabyte attribute that collectors truncate mid-string. They now become
    `[base64 image/png redacted]`.
  - **Content is capped at 200KB and stays valid JSON** — long string leaves are
    cut first, keeping every message, role and part in place. Slicing serialised
    JSON at a byte offset lands mid-token, and autotel's own devtools then drop
    the attribute entirely.
  - **Server-side tools are priced.** `serverToolCalls` bills web search and file
    search, which fall outside the token counts. Only per-call-billed tools are in
    the table: pricing a session-billed tool per call overstates it by two orders
    of magnitude, and a confident wrong number is harder to catch than a missing
    one — unpriced tools surface as `gen_ai.usage.cost.unpriced_tools`.
  - **`cacheTokensExclusive`** for providers that report cache tokens on top of
    `inputTokens` rather than inside it, and **`tokenSource`** labelling counts as
    observed or estimated.
  - **Prompt versions** — `gen_ai.prompt.version` / `.label` / `.hash`.
  - Repeated object references are no longer mistaken for cycles: redaction
    tracked visited objects globally, so one message appearing twice became
    `[message, null]`.

  **Breaking in effect, not in types:** anything reading `{"__type":"base64"}` out
  of `gen_ai.input.messages` now finds a placeholder string.

### Patch Changes

- Updated dependencies [29546bf]
  - autotel-web@1.14.0
  - autotel@7.4.0
  - autotel-subscribers@54.0.0

## 4.0.0

### Patch Changes

- Updated dependencies [78c7131]
  - autotel@7.3.0
  - autotel-subscribers@53.0.0
  - autotel-web@1.13.3

## 3.0.0

### Patch Changes

- 7a2f38c: Server-side querying, a durable store, and a shared time window.

  **Breaking.** `MetricData`, `DevtoolsServer.addMetric()` and `maxMetricCount`
  are removed, `DevtoolsData` no longer carries a `metrics` field, and snapshots
  no longer contain a `metrics` section. Nothing in the repo called `addMetric` and
  nothing produced a `MetricData`, so the practical blast radius is small —
  `TraceData` and `SpanAttributes` are unchanged, which is what the VS Code
  extension's backend adapters map onto, and `createDevtools()` keeps working with
  no new options because the store defaults to in-memory.

  **Query language.** A telemetry query language with a hand-written tokenizer,
  recursive-descent parser and SQL compiler: `service = api AND duration > 100`,
  `name CONTAINS checkout`, `http.status_code = 500`, `service IN [api, web]`,
  `name REGEXP "^GET "`, `parent = NULL`, parentheses, `AND`/`OR`, quoted field
  names for attribute keys a bare word cannot spell, and bare words as free text.
  Any field not declared as a column is looked up as a span attribute, so every
  attribute a service emits is queryable without being declared.

  Values always become bound parameters and identifiers always come from a schema,
  so no user-supplied text reaches the SQL string.

  **Durable store.** `DevtoolsStore` over `node:sqlite` — in the standard library
  on Node 24, which this package already required, so persistence costs no new
  dependency. Traces and spans with indexes, keyset pagination, a registered
  `REGEXP` function, and count-capped retention that prunes spans with their
  traces. `createDevtools()` accepts `dbPath` and `maxTraces`; both default to
  in-memory, so existing embedders keep their current behaviour and gain querying
  and paging.

  **`POST /api/query/traces`**, behind the same origin guard as the other
  read-back routes. A malformed query is a 400 with positioned errors rather than
  a 500, so the editor can point at the problem.

  **Shared time window.** One window across tabs, URL-serializable, with presets
  and a custom range. Presets are stored as intents so "Last 15m" keeps tracking
  now instead of freezing when it was clicked. "All" means no choice was made,
  which is what lets a view fit its own data without cropping a window the user
  actually asked for.

  **Live tail with freeze.** The trace list follows new data by default and
  freezes the moment you type a query, scroll back, select a row or bound the
  window — counting new matches in a pill instead of reordering rows underneath
  you. Freezing is a consequence of what you did, not a mode to manage.

  **bits-ui** for overlay primitives, with a portal container inside the widget's
  shadow root so popovers never render into the host page.

  **Metrics.** The tab is rebuilt on real OTel metric streams. The
  `event | funnel | outcome | value` model it used to render is **removed**:
  nothing ever produced it — `addMetric()` had no callers anywhere and
  `POST /v1/metrics` fed only the Agents tab — so the tab could never display
  anything. `MetricData`, `DevtoolsServer.addMetric()`, `metricsSignal`,
  `groupedMetricsSignal` and `maxMetricCount` are gone, and snapshots no longer
  carry a `metrics` section.

  In their place: a metric catalogue with sparklines, a multi-series time chart
  with axes and an isolating legend, a histogram bucket distribution with
  interpolated p50/p90/p99, and **clickable exemplars** that open the trace behind
  a spike. Cumulative counters are differenced into rates before drawing, with a
  counter reset read as an increment from zero rather than a negative spike that
  never happened. Long series are downsampled keeping their extremes, so an
  outlier is never smoothed away.

  **Logs.** The Logs tab reads from the store with the same query bar, window and
  freeze behaviour. Severity is queryable as text _or_ number, so "error and
  above" is `severity_number >= 17` rather than a fixed dropdown option. A
  structured body is stored as structure as well as text, so it never degrades to
  `[object Object]` — the text is what free-text search matches, since it is what
  the row displays.

  **Two browser bundles.** The embedded widget and the full-page viewer now build
  separately from one entry and one component library, differing only in which
  view registry is bundled. Embedded ships traces, logs, errors and resources —
  it is a guest in someone else's product page, and every kilobyte is one their
  users download. The exploratory tabs and the chart and graph code they pull in
  go to the full viewer. `GET /widget.js` serves the reduced bundle;
  `?mode=fullpage` serves the full one.

      embedded   472 KB (gzip 138 KB)
      full page  630 KB (gzip 188 KB)

  The embedded bundle is smaller than it was before any of this, despite gaining
  the query language, server-side querying, the time window, live-tail freeze,
  paging and the waterfall tree gutter.

  **Waterfall.** Connector lines in the gutter show which parent a span belongs
  to, which indentation alone stops conveying past two or three levels.

  **Paging.** Both list views fetch the next page as you scroll, and rows use
  `content-visibility` rather than a virtualised list — the browser skips what is
  offscreen while the rows stay real DOM, so find-in-page, text selection and
  screen readers keep working.

  **Also breaking.** The Traces-only time-range dropdown (`AUTOTEL`'s
  `traceTimeRangeFilterSignal`, the `range` URL parameter, and the
  `TraceTimeRangeFilter` type) is removed. It was superseded by the global time
  window, and leaving both meant the Traces tab carried two controls for the same
  thing. The shareable URL now carries `window` instead.

  **Derived views read the store.** Service Map, Flow, Security, Resources, GenAI
  and Errors folded over the live tail — the last hundred traces the process
  happened to receive — so they described a few minutes regardless of what the
  toolbar said, and lost everything on restart. They now fold over a store-backed
  working set for the chosen window.

  Errors get `POST /api/query/errors`, which re-runs the existing aggregator over
  stored traces rather than adding a second implementation, so the grouping and
  fingerprinting rules are the ones the live path already uses. The Errors tab can
  now answer "what was failing an hour ago", which it previously could not.

  If the server is unreachable the views fall back to the live tail rather than
  blanking — showing the traces already in the browser beats showing nothing.

  **Compare, Coverage and Copy as curl.** Compare
  (`POST /api/analysis/compare`) answers "what is different about the ones that
  broke" by borrowing `compareCohorts` from `autotel/analysis`, and carries the
  mark-and-compare loop: mark a moment, change something, compare after against
  before. `autotel` is a peer dependency, so the import is lazy and its absence is
  a 501 with an install hint rather than a server that will not start. Coverage
  (`GET /api/coverage`) joins `autotel map`'s record of every entry point against
  what the store has seen and lists what has emitted nothing, linked into the
  editor; a missing map is a 404 with instructions, not an empty report that would
  read as full coverage. Copy as curl rebuilds a request from an HTTP span,
  reading both the pre-1.0 and current semconv attribute names. Compare and
  Coverage are full-page only; the embedded widget stays lean.

  **Links, history and clocks.** Deep links carry the trace's own bounds plus a
  minute of air, so a link handed to a human opens on a window that still contains
  the trace, and each slowest span carries a link that selects that span. The
  widget pushes history for a change of tab, trace or span and replaces for a
  window, sort or query keystroke, so Back retraces and typing cannot bury the
  page you came from. Every clock routes through one formatter with a Local/UTC
  control persisted per viewer rather than in the URL — a shared link should open
  on the sender's window, not their timezone.

  **Loopback.** A loopback bind creates two listeners because localhost resolves
  to `::1` on macOS and `127.0.0.1` elsewhere; only the primary got the
  WebSocket, so a client reaching the sibling read telemetry over HTTP while its
  live tail never connected. Both listeners now share one WebSocket server, one
  client set and one broadcast, with the path check and origin guard inside the
  upgrade handler. `createDevtools()` also exposes `ready`, carrying the port
  actually bound — which with `port: 0` or a busy port is not the one requested.

  **Contract violations reach the viewer** (`autotel-schema`). A
  `TelemetryContract` is a TypeScript module in the service's own repo, so the app
  is the only thing that can validate against it and a viewer reading exported
  spans never can. The schema processor now stamps the validation result onto the
  span as attributes and devtools reads them, rather than devtools growing a
  dependency and a way to load someone else's contract. The stamp is opt-in: a
  conforming span stays unmarked so the presence of the attribute is what a reader
  filters on, the severity is the worst seen rather than the last, and the code
  list is capped at 20 while the count stays exact.

  **MCP pushdown** (`autotel-mcp`). The `devtools` backend now pushes queries down
  to the devtools store. `searchTraces` compiles a structured `TraceSearchQuery`
  into devtools query-language text and runs it server-side as SQL over the whole
  retained history, instead of fetching the hundred-trace live tail and filtering
  it in JavaScript. The compiler covers the full `QueryFilter` operator set —
  `in`/`not_in` as arrays, `between` as a pair of bounds, `exists`/`not_exists` as
  NULL tests, and the comparison and text operators directly. Metrics are served
  too, so the backend declares `metrics: 'available'` rather than `'unsupported'`.
  `autotel diagnose`, `autotel query` and the MCP tools now read the same local
  telemetry the viewer shows.

  Both remain compatible with an older devtools: each call falls back to the
  read-back API when the query endpoint is absent, and the probe is cached so a
  legacy server costs one failed request per process rather than one per query.
  The query path checks the response _shape_ rather than only its status — it
  returns results as already filtered, so a bare 200 from anything on that URL
  would otherwise present unfiltered traces as query matches.

  `autotel-devtools` gains a `./query` export (`parse`, `compileWhere`, the
  operator table) so query generators can verify what they emit against the real
  grammar rather than a copy of it.

  ## `autotel-webmcp` (new package)

  Add `autotel-webmcp`: OpenTelemetry instrumentation for WebMCP tools in the browser.

  The browser-side counterpart to `autotel-mcp-instrumentation`. `instrumentWebMCP()`
  wraps the browser's shared ModelContext so every imperative tool registration and
  agent invocation becomes a span, including calls made through retained aliases.

  Spans record what the agent actually received rather than what the handler
  returned — the browser serialises results, substitutes a message for empty ones,
  and silently discards unrecognised annotations. `webmcp.annotations.dropped` and
  `webmcp.result.envelope` surface two failures that are otherwise invisible at
  runtime. Payload content is privacy-safe by default (opt-in), while payload size
  and result-shape signals are always recorded. Two entry points: `autotel-webmcp`
  fills in autotel-web's `span()`, and `autotel-webmcp/core` is the same
  instrumentation with no telemetry dependency for when spans already have
  somewhere to go or the browser SDK should stay out of the bundle. Shared concepts use canonical
  `gen_ai.*` and `mcp.*` attributes alongside WebMCP-specific facts.

  ## `autotel-web`

  Stop the exporter tracing its own requests, and accept a bare origin in `initFull`.

  `FetchInstrumentation` and `XMLHttpRequestInstrumentation` were constructed with
  no `ignoreUrls`, so the OTLP exporter's own POST to the collector was traced.
  Each export produced a span, which was exported, which produced another span —
  a feedback loop that floods the collector and starves real spans out of the
  batch buffer. Both instrumentations now ignore the configured OTLP endpoint.

  `init()` appended `/v1/traces` to the configured `endpoint` but `initFull()`
  passed it straight to the exporter, so the same config value meant two
  different things and a bare origin silently 404'd in full mode. Both now share
  `normaliseOtlpEndpoint()`.

  ## `autotel`

  Awaitable return values are now typed by what they resolve to. `trace()`,
  `span()` and `instrument()` gained leading `PromiseLike` overloads, so a
  function returning an ORM query builder (drizzle, knex, Prisma, Sequelize)
  is typed as `Promise<T>` rather than as the builder itself. `instrument({
functions })` returns `InstrumentedFunctions<T>`, which maps each awaitable
  member to `Promise<Awaited<...>>` while leaving synchronous members alone.

  At runtime the same distinction is now honoured: `promiseFromThenable()`
  replaces the `instanceof Promise` checks. A lazy thenable was previously read
  as a synchronous value, which ended the span before the work ran and left its
  real children orphaned outside a short parent span. Promises from another
  realm failed the same check.

  ## `autotel-drizzle`

  `spanNaming` chooses how query spans are named. The default, `'drizzle'`,
  keeps the `drizzle.select` names existing dashboards are built on;
  `'semconv'` follows OpenTelemetry's database convention,
  `{db.operation.name} {target}` — `SELECT comments` — which groups by table
  for free in any OTel-native UI.

  ## `autotel-posthog`

  `FeatureFlagOptions`, `PersonProperties` and `groupIdentify()` now describe
  their property bags as `Record<string, unknown>` instead of
  `Record<string, any>`. Reading a nested value off one of these now needs a
  narrowing step it always should have had.

  ## Experiments, buckets, and the trace you cannot afford to lose

  **`experiment({ name, variant, expect })`** stamps `experiment.name`,
  `experiment.variant` and `experiment.expectation` on the active span, and writes
  the first two to baggage so child spans and downstream services carry the same
  answer. An experiment covers a request, not one function in it. An
  experiment needs a guess and a way to check it; instrumentation was already the
  check, and nothing recorded the guess. The two cohorts you want to compare are
  now selectable from the telemetry rather than reconstructed by hand from deploy
  timestamps, and the expectation travels with them, so a reader a month later
  sees the claim next to the result. Ambient, so it reaches the span from a helper
  several frames inside a traced body, and it no-ops when nothing is being traced.

  **`bucket(value, boundaries)`** from `autotel/analysis` turns a raw duration or
  byte count into a low-cardinality label. `compareCohorts` skips fields whose
  values never repeat, which is what a raw number does, so the docs already told
  you to bucket at instrumentation time and shipped nothing to do it. A non-finite
  value and an empty boundary list both give `'unknown'`: filing a NaN duration
  under the slowest bucket would invent a cohort that never happened. An unordered
  boundary list is sorted rather than producing overlapping labels.

  **`forceKeep()`** keeps a trace whatever the sampler decides, for a payment, an
  audit-relevant action, or a request you are debugging right now.

  **Debug capture through baggage.** A request carrying `autotel.debug` keeps its
  trace whatever the sampler decides, and because baggage is a wire format it
  follows that request into every service behind the first one. Set it at a
  gateway, from a feature flag, or with `curl -H 'baggage: autotel.debug=1'`.
  Nothing is deployed to turn it on, which is the difference between this and
  `forceKeep()`. `AUTOTEL_DEBUG_BAGGAGE_KEY` is exported for callers who would
  rather not spell the key.

  **Fixed:** `forceKeepAuditEvent()` in `autotel-audit` did not survive tail
  sampling. It set the tail-keep attributes from inside the traced body, and the
  tracing wrapper writes the sampler's verdict once the body has returned, so a
  sampler that decided to drop overwrote the override and the audit event was
  discarded. `forceKeep()` marks the span as claimed and the wrapper now leaves a
  claimed span alone; `forceKeepAuditEvent()` delegates to it.

- Updated dependencies [7a2f38c]
  - autotel@7.2.0
  - autotel-web@1.13.2
  - autotel-subscribers@52.0.0

## 2.0.0

### Patch Changes

- Updated dependencies [559ec46]
  - autotel@7.1.0
  - autotel-subscribers@51.0.0

## 1.1.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [4c859aa]
  - autotel-web@1.13.1
  - autotel@7.0.1
  - autotel-subscribers@50.0.1

## 1.0.0

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
  - autotel-subscribers@50.0.0
