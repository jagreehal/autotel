# autotel-mcp

## 0.7.0

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

## 0.6.0

### Minor Changes

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

## 0.5.2

### Patch Changes

- 42cb79a: Route value decoding through `lib/values`, and fix two bugs an assertion hid.

  `lib/values.ts` documents itself as the module that turns unread JSON into typed
  values, and a dozen modules re-derived it anyway: `discovery`, `tempo` and
  `span-mapping` each carried a private `asNumber` identical to the shared one,
  `llm-analytics` and `query-filters` had their own string and tag decoders, and
  several backends inlined the same checks by hand. They now call the shared
  decoders, which gained `asTagValue`, `tagText` and `tagKind` to cover what the
  call sites needed.

  Two latent bugs surfaced on the way. The fixture backend's `serviceMap` passed a
  `lookbackMinutes` that `TraceSearchQuery` has never declared — an assertion was
  discarding it, so the argument had never narrowed anything. `readDashboard`'s
  catalog is now a `Map`, and listing it no longer goes through `Object.values`,
  which returns nothing for one.

  Lookup tables keyed by user input (CLI flags, duration units, dashboard ids) are
  `Map`s, so a miss reads as `undefined` instead of an index signature promising a
  value for every string. Assertions that only restated a declared type are gone,
  and the ones that remain state the invariant they rest on.

## 0.5.1

### Patch Changes

- 00d4aad: Keep metric dimensions through the collector, and honour the query window.

  **Dimensions survive ingest.** OTel puts a metric's labels on the data point,
  not the resource, but the OTLP receiver only read `resource.attributes`. Every
  label set for a metric collapsed into one series at write time, so a counter
  split by `lane` or `http.route` arrived as a single undifferentiated timeline
  and the dimension was unrecoverable. Data-point attributes are now parsed and
  merged with the resource attributes, one series per distinct set.

  **`list_metrics` reports the series it found.** Series were keyed by metric name
  alone, so two label sets merged into one series labelled with whichever row
  SQLite returned first — wrong values under a real label, not missing ones. The
  key is now name plus attributes, matching `getMetricSeries`, and `serviceName`
  filters the result.

  **`lookbackMinutes` is applied.** The tool always sends a window and defaults it
  to 60 minutes; the collector ignored it and returned every point inside the
  retention period. Point history is capped per call, with `detail` set when the
  cap truncates a series.

  **One definition per type.** `ServiceMap`, `ServiceMapNode`, `ServiceMapEdge`
  and `TraceSummary` were declared both in `types.ts` and again in the modules
  that build them. The declarations were structurally identical, so the duplicate
  forced every backend to launder its result through `as unknown as` — fourteen
  double assertions across seven backends, each one discarding the type evidence
  it was written to preserve. The modules now re-export the canonical types and
  the assertions are gone.

## 0.5.0

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

## 0.4.1

### Patch Changes

- b37813b: Fix log attribute filtering, result totals, and the devtools dashboard title.

  **autotel-mcp** — `searchLogs` filtered attributes with a JSON path built by
  string interpolation (`$."key"`). SQLite's path parser does not honour the `\"`
  escape, so any attribute key containing a quote or backslash matched **zero
  rows** silently. Filtering now goes through `json_each`, which takes the key as
  a bound value and removes path quoting from the picture entirely.

  `searchLogs` and `listMetrics` also reported `totalCount` as the post-`LIMIT`
  row count, so a caller could not tell one matching record from one of four
  hundred. Both now count against the same predicate without the limit, matching
  the fixture backend. The in-memory attribute matcher duplicated in the fixture
  backend is now the shared `matchesAllTags` from `modules/query-filters`.

  **autotel** — pretty log output rendered the OTel `SpanStatusCode` in the HTTP
  status slot, printing a non-HTTP span as `1` and colouring a failed span green.
  The slot is now HTTP-only; non-HTTP spans are named by their operation instead,
  and a span that failed while its level was overridden below `error` is marked so
  the failure is still visible.

  **autotel-devtools** — `--title` / `AUTOTEL_DEVTOOLS_TITLE` was documented as
  the dashboard title but only ever changed the startup banner; every browser tab
  still read `autotel-devtools`. The title now reaches the served page and the
  Picture-in-Picture window, HTML-escaped. `DevtoolsRoutesOptions` gains an
  optional `title`.

## 0.4.0

### Minor Changes

- 09888cd: Add experimental Telemetry Policy support, and close the BigQuery job, stream, and cost gaps.

  **Telemetry Policies (OTEP 4738)** — policies are portable, fail-open rules
  describing what telemetry to keep and how to transform it. The same JSON runs in
  an SDK, a Collector, or any other conforming implementation. Point `init()` at a
  policy file or directory:

  ```typescript
  init({ service: 'api', policies: './policies' });
  ```

  ```json
  {
    "id": "drop-debug-logs",
    "log": {
      "match": [{ "log_field": "severity_text", "regex": "^(DEBUG|TRACE)$" }],
      "keep": "none"
    }
  }
  ```

  Policies compile onto autotel's existing `spanFilter` and log record processors —
  no new pipeline. Files are watched, so the policy set can change without a
  restart. Supported stages are `trace.keep.percentage` (deterministic per-trace
  sampling), `log.keep`, and `log.transform` (`remove` → `redact` → `rename` →
  `add`). Unsupported stages cause the _policy_ to be skipped, never the
  telemetry: `metric` targets, and `trace.keep.mode` / `sampling_precision` /
  `hash_seed` / `fail_closed` (OTEP 235 consistent-probability sampling). Adds a
  `policies:` key to `autotel.yaml` and a new `autotel/policy` export.

  **BigQuery plugin** — three call paths were previously untraced. `createJob()`,
  the generic escape hatch used for GCS-to-BigQuery load jobs built from an
  explicit configuration, now gets a span, as does `Job.promise()`, the wait for
  that job to finish. Without the latter a multi-minute load looked instantaneous:
  job creation was traced and the work was not. `createQueryStream()` is now
  instrumented for result sets too large to buffer, with the span held open and
  closed when the stream ends, errors, or closes, so its duration is the read
  rather than the few milliseconds of setup.

  `JOB_WAIT` and `GET_QUERY_RESULTS` spans now carry job cost statistics —
  `gcp.bigquery.job.total_bytes_processed`, `total_bytes_billed`, `total_slot_ms`
  and `cache_hit` — answering which query burned the bytes and slots. These are
  read from job metadata that is already present, so there is no extra API round
  trip.

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
