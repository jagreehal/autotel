# autotel-devtools

## 27.0.0

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

- Updated dependencies [10c3f93]
  - autotel@7.6.0
  - autotel-agents@0.5.0

## 26.0.0

### Patch Changes

- Updated dependencies [a271e71]
  - autotel@7.5.0

## 25.0.0

### Patch Changes

- Updated dependencies [29546bf]
  - autotel@7.4.0

## 24.1.0

### Minor Changes

- bec663c: Record why a WebMCP tool failed, stop substituting its result, and report the
  consent the instrumentation cannot see.

  - A handler that throws or rejects now puts `error.type` and
    `webmcp.result.error` on the execute span, plus `webmcp.error.message` when
    payload capture is on. Chrome replaces a thrown error with a generic
    `UnknownError` before the agent sees it, so the span is the only place the
    reason survives. The rejection still reaches the caller unchanged.
  - The instrumentation no longer rewrites what the agent receives: a handler's
    string and `undefined` are handed back exactly as returned. Installing
    telemetry no longer changes application behaviour. Chrome's own substitution
    is still recorded in `webmcp.result.substituted`.
  - Execute spans are named `execute_tool {gen_ai.tool.name}`, the GenAI
    convention `autotel-genai` already follows, rather than the constant
    `webmcp.tool.execute`. Anything matching the old span name needs updating;
    `gen_ai.tool.name` and `webmcp.tool.name` are unchanged.
  - New `webmcp.consent` span, emitted by `recordConsent()` on the handle
    `instrumentWebMCP()` returns. The consent dialogue is host UI and invisible to
    code that patches `registerTool`, so the host reports it and the label the
    human read lands on the same trace as the call that ran, with
    `webmcp.consent.mismatch` when the two disagree.
  - New `webmcp.execute.depth` and `webmcp.execute.parent`: a handler that calls
    another tool spends one consent on two calls, and the second shows up here.
  - New `isRefusal` option, so a host whose tools refuse in their own words is not
    left with the default two-English-sentence match, and `fingerprintHandler`
    (off by default), which folds the handler source into
    `webmcp.tool.descriptor` so a swap that changes only the function sets
    `webmcp.tool.redefined`.
  - Handshake facts on registration spans — title vs name, descriptor
    fingerprint, execute sequence, known library refusals — surfaced on the
    devtools WebMCP tab.

## 24.0.0

### Minor Changes

- 78c7131: Four things that read as configured and were not: a sampler, a subpath, a tool
  call's span, and an unpriced model.

  **A sampler on `init()` now governs the functions you wrap.** `withTracing()`,
  `trace()` and `instrument()` read `options.sampler` and fell back to
  `AlwaysSampler`, so a sampler passed to `init()` never reached the sampling
  decision: `init({ sampling: 'production' })` read as configured while every
  wrapped span was still exported, and the bill was the only signal. The wrapper
  now resolves `options.sampler ?? init's sampler ?? AlwaysSampler`, per call
  rather than at wrap time, because a wrapper is usually created at module load
  and `init()` has not run yet. **Breaking, in effect:** an app that set
  `sampling` and relied on the old behaviour will start sampling for real. A
  sampler passed at the wrapper still wins.

  **The subpaths these packages advertise now ship.**
  `autotel-subscribers/testing` and `autotel-web/privacy` were declared in their
  exports maps with no matching build entry, so importing either one threw
  `ERR_MODULE_NOT_FOUND` for every consumer while the repo's own tests, which
  import from source, passed. Both are now built, and
  `scripts/check-exports-map.mjs` fails a build that advertises an entry point the
  build did not write.

  **A tool call is a span.** `withAgentToolCall` (and `defineAgentToolCall`)
  recorded onto whatever span was open, so a second tool call in the same span
  overwrote the first and neither kept its own duration. Each call now runs in
  `execute_tool {name}`, per the GenAI semantic conventions. A caller that passes
  `options.ctx` is stating where the call belongs, and keeps the old placement.

  **Breaking (`autotel-genai`).** The wide event carried the tool fields
  camelCased (`tool.inputHash`, `tool.executionMs`) while the span attributes used
  snake_case, and the logger flattens onto the same span, so every tool call
  landed twice under two spellings. The event now uses `input_hash`,
  `output_hash`, `call_id` and `execution_ms`. Queries against the camelCase names
  need updating.

  **An unpriced model is visible.** `estimateLLMCost` returns `undefined` when no
  pricing entry matches, and the cost attribute was simply never set: a cost
  ceiling could not fire and a dashboard read zero. `recordGenAiUsage` and the
  agent runtime now set `gen_ai.usage.cost.unpriced_model` to the model id
  instead, so an unpriced call is distinguishable from a free one.

  **A refused tool says it was refused.** `recordHumanApproval` names the tool on
  the span, so `tool.name` alone stopped meaning "the tool ran". A denial now also
  sets `tool.status: 'blocked'`; an approval leaves the status to the tool call
  itself.

  **`track()` says when an event is dropped.** With no subscribers configured the
  call was a silent no-op, so `recordEvaluationResult` and audit events looked
  recorded when nothing received them. It now warns once per process.

  **`createMemoryExporter()`** from `autotel/testing` collects finished spans as
  plain objects (`name`, `traceId`, `parentSpanId`, `durationMs`, `attributes`,
  `status`) with `findSpan(name)`, `findSpans(name)` and `reset()`. Asserting on
  telemetry used to mean hand-writing a `SpanExporter` against the OpenTelemetry
  SDK types; the examples in `apps/` now use this instead.

  **The WebMCP tool lifecycle is traced, and shown.** `autotel-webmcp` now records
  withdrawal (`webmcp.tool.withdraw`, emitted when a tool's registration signal
  aborts) and installation identity (`webmcp.install` plus
  `webmcp.installation.id` on every span). Registrations alone only ever grow, so
  a tool set gated by page state was previously unreadable.

  `autotel-devtools` gains a WebMCP tab over those spans: which tools the agent
  can currently see, what the browser dropped or mangled on the way, and what the
  result surface costs in bytes. The fold runs server-side behind
  `POST /api/query/webmcp`, so an inventory is never built from one page of
  results. Full-page viewer only — the view is chart-free but still does not fit
  the embedded widget's gzip budget.

### Patch Changes

- Updated dependencies [78c7131]
  - autotel@7.3.0

## 23.1.0

### Minor Changes

- 0aa8e21: **Compare offers an experiment's arms.** `GET /api/query/attributes?key=&pair=`
  asks which values a field takes and which value of a second field sat on the
  same span, so the Compare view lists the experiments in the store and offers the
  arms of the one you pick: commonest arm against the next, either side
  selectable, and "every other arm" for the rest of the experiment. The pairing
  joins `attribute_occurrences`, which is written and deleted with its span, so an
  arm is only offered under the experiment it ran with and a pruned experiment
  disappears with its traces. Neither side can hold the arm the other is
  investigating, and `experiment.name` and `experiment.variant` are left out of
  the ranking, since they define the cohorts and separate them perfectly. Values
  are escaped into the generated queries, so an arm named `pricing "vip"` still
  parses. The picker is hidden when no span carries `experiment.name`.

  **Fixed:** a query comparison sent no time window, so it answered over
  everything the store held while the toolbar showed something narrower. Both
  cohorts now carry the resolved window.

  **Also fixed:** `DevtoolsServer` ignored `host` when it opened its own
  listener, so an embedder asking for `127.0.0.1` was served on every interface
  and their captured telemetry reached the network. It now binds what it was
  given; the default, no host, still binds everything.

## 23.0.0

### Major Changes

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

### Patch Changes

- Updated dependencies [7a2f38c]
  - autotel@7.2.0

## 22.0.0

### Minor Changes

- 559ec46: Say what a trace could not see, and what a sequence of calls means.

  A trace that lost a fact and a trace that never could capture it look identical
  once they reach a backend — both read as complete, because the timeline has a
  start and an end. These packages now narrow that claim in-band, on the spans
  themselves.

  **Evidence quality** (`autotel/evidence`). `recordEvidence()` labels one field
  (`observed` / `inferred` / `estimated` / `truncated` / `redacted` / `absent` /
  `unobservable`); `captureCoverageAttributes()` declares which capture surfaces a
  process observes at all. No label means unknown — nothing here asserts
  completeness. The lossy paths now announce themselves: truncated captures set
  `autotel.evidence.input|output`, `recordLLMCost()` labels its figure `estimated`
  (or `unobservable` when no pricing matched) so a price-table number is never
  mistaken for a bill, and `sanitizeAuditPayloadWithEvidence()` reports what a
  privacy profile removed, with the counts covered by the audit event hash.

  **Approvals say whether anyone saw them.** `recordHumanApproval()` stamps
  `agent.consent.evidence`, defaulting to `inferred`: no runtime reports the
  human's click, so most approvals are deduced from the tool having run, and that
  deduction must never be citable as a human decision.

  **Sequence detection** (`autotel-genai/agent`). Ordered steps within one
  session: `denied-then-executed` requires the denial to come first, and
  reversed it does not fire. `emitSequenceDetections()` writes each finding as its
  own correlated log record, and `recordDetectionDisposition()` records what a
  human decided — refusing to close a finding as `false_positive` or
  `risk_accepted` without a written reason. Both sides carry the same flat
  `detection.rule_id` / `detection.correlation_id` keys, which is what joins a
  finding to a decision made hours later in a different trace.
  `sequenceRulesToSigma()` generates SIEM rules from the same rule set.

  **Context compaction** (`autotel-agents`, `autotel-devtools`). Agents replace
  the conversation with a summary and carry on; nothing announces it, but the
  token counts show the discontinuity. Detected per query-source lineage, ignoring
  estimated token counts, surfaced on the Agents timeline as a boundary — not an
  error, since compaction is the agent working correctly. `postCompactionRegression()`
  reports whether the agent started re-reading what it had already seen.

  **Also**: `mcp.security.manifest.digest` fingerprints a tool's text surface, so
  a manifest rewritten after you trusted it reads as changed rather than merely
  scanning clean; `scoreGenAiCompleteness()` distinguishes a missing field from
  one the deployment cannot capture, with a `healthy`/`partial`/`unknown`/`invalid`
  verdict; `autotel doctor --capture` reports which surfaces a project can observe
  at all; and `autotel-mongoose` restores its Mongoose 8 peer range, which had
  been ratcheting with its devDependency while the README always said 8+.

### Patch Changes

- Updated dependencies [559ec46]
  - autotel@7.1.0
  - autotel-agents@0.4.0

## 21.0.1

### Patch Changes

- Updated dependencies [4c859aa]
  - autotel@7.0.1

## 21.0.0

### Patch Changes

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

- Updated dependencies [d303348]
  - autotel@7.0.0

## 20.1.0

### Minor Changes

- ee8accb: Errors tab: browsable stack frames with the failing source line.

  A stack trace was a `<pre>` block. Reading it meant scanning for the one frame
  that was your code, then opening the file yourself. The tab now parses the
  stack and lists frames classified by origin — your code, `node_modules`, or
  runtime (`node:*`, `[eval]`). Only app frames are clickable, because they are
  the only ones with a file we could show. Picking one fetches the lines around
  the failure, numbered as they are on disk. The raw text stays under **Raw
  stack** with the copy button.

  `autotel`'s structured errors were showing no frames at all: they write the
  stack to `error.stack` rather than emitting an `exception` event, and the
  aggregator read only `exception.stacktrace` / `exception.stack` / the event.
  It now reads `error.stack` too.

  Source reading is a new `GET /source`, gated three ways: it is confined to
  `AUTOTEL_DEVTOOLS_SOURCE_ROOT` (default: the receiver's working directory) with
  symlinks resolved, so a link pointing out of the project is refused; it sits
  behind the existing loopback/Origin guard; and every refusal is an
  indistinguishable 404, so the route cannot be used to probe for files. Set
  `AUTOTEL_DEVTOOLS_SOURCE_ROOT=false` to disable it — the route then 404s and
  devtools never touches the filesystem.

  That default holds only on a loopback bind. `--host 0.0.0.0` flips it to off,
  because the Origin guard alone does not carry this route: a request with no
  `Origin` at all passes it, and the root holds whatever else is in the project,
  `.env` included. An explicit root is still honoured there.

  `createDevtools()` takes a `sourceRoot` option and follows the same rule, so the
  embedded widget gets the same Errors tab as the CLI dashboard rather than
  silently degrading to no source.

  Stack parsing lives in one `node:`-free module shared by the server and the
  widget; the aggregator's fingerprint now composes from it rather than
  re-matching frames and discarding the positions.

## 20.0.1

### Patch Changes

- 31fd178: Group stackless errors that differ only in a number with a unit suffix

  `normalizeMessage` stripped numbers with `\b\d+\b`, which never matches `37` in
  `37ms` — there is no word boundary between a digit and a letter. Durations,
  sizes and timeouts written with their unit therefore survived normalisation.

  That only matters when an error has no stack trace, because then the normalised
  message _is_ the fingerprint: one bug produced a fresh group per occurrence, so
  a repeating timeout showed up as many one-off errors rather than one frequent
  one — the opposite of what aggregation is for.

  Fingerprints for affected errors change value, so groups carried over from a
  previous run will not merge with new ones.

  The bounded form is still correct in the SQL normalisers elsewhere in the
  monorepo, where it deliberately protects identifiers like `col1` from being
  rewritten to `col?`. Those are unchanged.

## 20.0.0

### Patch Changes

- Updated dependencies [e8f2d0f]
  - autotel@6.5.0

## 19.1.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [b37813b]
  - autotel@6.4.1

## 19.0.0

### Patch Changes

- Updated dependencies [09888cd]
  - autotel@6.4.0

## 18.0.0

### Patch Changes

- Updated dependencies [fb6bee2]
  - autotel@6.3.0

## 17.1.1

### Patch Changes

- Updated dependencies [7bad202]
  - autotel@6.2.1

## 17.1.0

### Minor Changes

- f0d521f: Mark partial traces instead of presenting a child as the root.

  A trace arrives in pieces. Sampling keeps a failed span and drops the routine
  parent above it; a downstream service exports before the service that started
  the request. Devtools previously fell back to `spans[0]` whenever no parentless
  span was present, so a fragment rendered exactly like a whole trace — a child
  operation shown as the entry point, with a duration covering only the part that
  happened to arrive.

  `TraceData` now carries `partial?: boolean`. It is true when every span held has
  a parent that did not arrive, and `rootSpan` is then the earliest span whose
  parent is absent rather than an arbitrary child. The traces list shows a
  `PARTIAL` badge and the trace detail says the duration covers only the spans
  present.

  `partial` is a fact about the spans held, not about a batch, so it is recomputed
  as spans merge — a complete trace whose children arrive first is flagged on
  arrival and unflagged the moment its root lands.

## 17.0.0

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

- 0f518c6: Add a Grafana Loki subscriber: `autotel-subscribers/loki`.

  `LokiSubscriber` pushes events to Loki's push API as JSON log lines, and works
  against a self-hosted single-tenant instance, a multi-tenant deployment, and
  Grafana Cloud. Auth follows what each expects: `user` plus `apiKey` is sent as
  HTTP Basic for Grafana Cloud, `apiKey` alone as Bearer for an authenticating
  proxy, and `tenantId` as `X-Scope-OrgID` independently of either.

  The label split is the part worth knowing about. Loki indexes labels and bills
  by their cardinality, while the log line is searched at query time, so only
  `service`, `environment` and `level` become labels by default. Everything else —
  request ids, paths, user ids, your own attributes — stays in the line where
  `| json` reaches it. Fields holding objects or arrays are skipped rather than
  stringified, because a serialised object is exactly the unbounded label value
  that breaks an instance.

  Events are buffered and pushed as grouped streams rather than one request per
  event, with entries sorted by timestamp within each stream, since Loki rejects
  out-of-order pushes. The flush timer is unref'd so a partial batch never holds
  the process open. A missing endpoint warns once and drops events instead of
  failing the caller's request path.

  `sendToLoki()`, `sendBatchToLoki()`, `buildLokiPayload()`, `toLokiLabels()`,
  `toLokiHeaders()` and `resolveLokiPushUrl()` are exported for direct use.

  Adds `docker-compose.lgtm.yml`, running Grafana's all-in-one LGTM image so Loki,
  Grafana, Tempo and Mimir come up in one container. `loki.integration.test.ts`
  uses it for a real round trip: push events, query them back through Loki's range
  API, and assert the labels, the JSON line and the timestamp survived. Without
  `LOKI_ENDPOINT` it skips rather than passing silently.

  Also fixes `autotel-devtools` publishing stale build artifacts. Its tsdown step
  had `clean: false`, so files removed from a build were never deleted from
  `dist` — which is how the source maps dropped in the previous change came back.
  tsdown runs before the vite widget build, and that build already sets
  `emptyOutDir: false`, so cleaning is safe and the widget is unaffected.

- Updated dependencies [0f518c6]
- Updated dependencies [0f518c6]
- Updated dependencies [0f518c6]
  - autotel@6.2.0
  - autotel-agents@0.3.1

## 16.0.0

### Patch Changes

- Updated dependencies [85a0e88]
  - autotel@6.1.0

## 15.0.0

### Patch Changes

- 756345d: Skills no longer ship inside the npm package tarballs. They now live at the repo root under `skills/`, grouped into `core/`, `frameworks/`, `integrations/`, and `contributing/`, as a single source of truth discovered by the skills CLI (`npx skills add jagreehal/autotel --skill <name>`). `skills` is removed from each package's `files` field, so installing a package no longer adds its skill to `node_modules`. Install skills explicitly with the CLI instead.
- Updated dependencies [756345d]
- Updated dependencies [756345d]
  - autotel@6.0.0

## 14.0.0

### Patch Changes

- Updated dependencies [9030f83]
  - autotel@5.0.0

## 13.1.1

### Patch Changes

- 6f20772: fix(autotel-devtools): widget WebSocket client reconnects indefinitely instead of giving up

  The widget's WebSocket client stopped retrying after 10 reconnect attempts with
  uncapped exponential backoff, so a laptop sleep or devtools server restart
  permanently killed live updates until a full page reload. It now retries
  forever with backoff capped at 15s — the server replays full history on
  reconnect, so the widget self-heals. An intentional `disconnect()` no longer
  schedules a reconnect (the old socket's `close` event previously resurrected
  the connection it had just torn down).

  The widget's connection indicator now tracks the socket's real state via a
  status callback instead of the one-shot `connect()` promise, so it shows
  "disconnected" during an outage rather than staying frozen on "connected".

## 13.1.0

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

## 13.0.0

### Patch Changes

- Updated dependencies [4f4f074]
- Updated dependencies [4f4f074]
  - autotel@4.3.0

## 12.3.0

### Minor Changes

- 3d9e31c: **Devtools UX upgrades:**

  - **Faceted service filter** on the Traces view — a "Filter" popover with per-service live counts and multi-select, plus click-to-filter service pills on each row.
  - **Context-window gauge** in the GenAI model header — a radial gauge showing prompt tokens vs the model's context window (green → amber → red as it fills), backed by a new per-model context-window lookup table.
  - **Live activity indicator** — the connection dot pulses when telemetry arrives and shows a rolling ingest rate (items/sec).
  - **Human-readable names** — camelCase/snake_case tool names get a readable Title Case tooltip.

  **Coding-agent observability** — model Claude Code's runtime environment:

  - `autotel-agents` now models `mcp_server_connection`, `plugin_loaded` and `hook_execution_complete` events (previously dropped to `other`): MCP server connect/disconnect lifecycle, loaded plugins, and hook-execution tallies, exposed on the session rollup and aggregate.
  - The Agents tab gains a **Runtime environment** section (MCP servers with connection status, plugins, hooks).
  - **Golden contract test + drift guard**: a sanitized, recorded Claude Code OTLP export is run through the real decode → reduce pipeline, and a test fails if Claude Code emits an event the adapter neither handles nor knowingly ignores. Re-record with `scripts/record-claude-otel.mjs`.

### Patch Changes

- 3d9e31c: Relicense from MIT to Apache-2.0. The `license` field now reads `Apache-2.0`, and the package ships the Apache-2.0 `LICENSE`. This changes the licence only; there are no API changes. Prior releases remain available under their original MIT terms. See `NOTICE` and `TRADEMARKS.md` in the repository root for attribution and the "autotel" trademark policy.
- Updated dependencies [3d9e31c]
- Updated dependencies [3d9e31c]
  - autotel@4.2.5
  - autotel-agents@0.3.0

## 12.2.2

### Patch Changes

- 4b7ad78: chore: routine dependency updates

  Refresh runtime and peer dependency ranges across published packages (`ncu`, 3-day release-age cooldown).

  The core `autotel` package moves to the latest OpenTelemetry libraries (stable `2.9.x`, experimental `0.220.x`, semantic-conventions `1.42.x`). This required adapting to a breaking change in `@opentelemetry/sdk-logs`: `BatchLogRecordProcessor` and `SimpleLogRecordProcessor` now take a `{ exporter }` options object instead of a positional exporter argument.

  Notable peer range bumps for consumers: `autotel-aws` (AWS SDK `3.1081`), `autotel-cloudflare` (`@cloudflare/workers-types` v5), `autotel-pact` (`@pact-foundation/pact` v17), `autotel-terminal` (`ai` v7).

- Updated dependencies [4b7ad78]
  - autotel@4.2.4

## 12.2.1

### Patch Changes

- Updated dependencies [830b6a4]
  - autotel@4.2.3

## 12.2.0

### Minor Changes

- 7c12332: Add first-class coding-agent observability, starting with Claude Code.
  - **New package `autotel-agents`** — a browser-safe domain layer that turns the OpenTelemetry metrics + log events coding agents emit into a session-centric model. Includes an adapter registry (Claude Code + opencode, by instrumentation scope / name prefix), pure session reducers (rollups kept indefinitely, raw timeline ring-buffered), MCP-aware tool parsing (`mcp__server__tool`), and a tool taxonomy that surfaces sub-agents (`Task`), skills (`Skill`), and tool categories. Cost is taken from the agent's reported `cost_usd` and estimated from tokens only as a fallback.
  - **`autotel-devtools`**:
    - New **Agents** tab — sessions list → per-session timeline + rollup, an aggregate strip across sessions, and breakdowns by tool category, MCP server, sub-agent, and skill. Prompts are private by default with a reveal/redact toggle.
    - The OTLP receiver now **parses metric data points** (Sum/Gauge/Histogram, JSON + protobuf) and **agent log events**, reconstructs sessions server-side, and streams them to the widget.
    - New **`npx autotel-devtools claude`** launcher subcommand that starts the receiver and launches Claude Code already wired to it (HTTP/protobuf, 1s export intervals, session id on metrics). `--print-env` emits the env block for MDM / VS Code; `--log-prompts` opts into prompt-text capture.

### Patch Changes

- Updated dependencies [7c12332]
  - autotel-agents@0.2.0

## 12.1.0

### Minor Changes

- 155c2f8: Shareable URLs, cross-navigation, and canonical GenAI tool parts in the
  full-page UI.
  - **URL state sync (full-page only):** the current tab, selected trace/span, the
    traces-list filters (search, status, min-duration, sort), and the GenAI search
    are reflected in the location hash
    (`#tab=genai&trace=<id>&span=<id>&q=…&status=error&min=…&sort=duration:asc&gq=…`),
    so any view — including a filtered list — can be bookmarked or shared by
    copying the URL, and opening such a URL restores it exactly. Uses
    `replaceState` (clean history, no write→read loop) and reacts to manual hash
    edits. The embedded widget never touches the host page's URL.
  - **Navigable span IDs:** in the span detail panel, Trace ID jumps to the
    trace's root span and Parent Span ID navigates to the parent span (the
    currently-selected Span ID stays plain). Copy buttons are unchanged.
  - **GenAI view:** the `trace …` reference in the model header is now a link that
    opens the trace in the Traces waterfall, focused on that span.
  - **Span detail panel:** cross-trace span links (`span.links`) are now clickable
    and open the linked span in the waterfall.
  - **GenAI tool parts:** canonical `gen_ai` `tool_call` / `tool_call_response`
    message parts (whose data lives in `name`/`arguments`/`response`, not
    `content`) now hydrate into tool-call chips and result values instead of
    rendering as empty bubbles, matching how the Vercel `tool-call`/`tool-result`
    shape is handled.

  Internally, the selected span and the traces/GenAI list filters are now global
  signals (previously local component state / a one-shot deep-link), which is what
  lets a single writer serialize the full view into the URL without clobbering.

## 12.0.2

### Patch Changes

- 0b1e332: Refresh the AI SDK guidance across published skills and docs.
  - document `autotelTelemetry()` as the primary Vercel AI SDK integration
  - document `subscribeAiTelemetry()` as the zero-config fallback
  - move `observeAiSdkResult()` and `autotel-genai/ai-sdk` guidance into the legacy/enrichment path
  - update review skills to stop recommending `experimental_telemetry`

- Updated dependencies [0b1e332]
  - autotel@4.2.2

## 12.0.1

### Patch Changes

- Updated dependencies [38ae023]
  - autotel@4.2.1

## 12.0.0

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

## 11.0.0

### Patch Changes

- Updated dependencies [12c6b6d]
  - autotel@4.1.0

## 10.1.0

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

## 10.0.0

### Patch Changes

- Updated dependencies [db0cce2]
  - autotel@4.0.0

## 9.0.0

### Patch Changes

- Updated dependencies [140fc76]
  - autotel@3.7.0

## 8.1.1

### Patch Changes

- b8198d9: Fix distributed traces appearing disconnected in the live UI. Spans for a single trace arrive across multiple batches and services, and the previous merge logic dropped every update to an already-known trace (the live widget/dashboard stayed stuck on the first batch) and never recomputed the root span when later batches arrived (so a trace whose downstream service exported first was mislabeled and rooted on a child span).

  The server now recomputes the root span (and service label) on merge and broadcasts the merged trace, and the widget store merges late-arriving spans into existing traces instead of discarding them. End-to-end browser → API → auth → worker traces now connect correctly in both the embedded widget and the standalone dashboard, including the Service Map topology.

## 8.1.0

### Minor Changes

- e6037fb: GenAI view: a "Trace" mode that decomposes a run into a depth-indented tree.

  Alongside List and Timeline, the GenAI tab now has a **Trace** view that breaks the selected run down into what actually happened inside it — each model call decomposed into its reasoning, the tools it called and the text it wrote, with nested sub-agents underneath. Built from the real span tree (`parentSpanId` + GenAI semantics), so it adapts to both common shapes:
  - **Pydantic AI + Logfire** — `invoke_agent → [chat, execute_tool, chat]`: the tool is its own span, shown with its result; the chats are leaf steps and the answer step carries the text.
  - **Wrapper-span runs** — an outer generate span (e.g. `ai.generateText`) that is itself classified as a `chat` renders as a container `group`, its child model calls as steps, and the inline tool call is synthesized under the step that made it.

  Tool calls are deduped two ways so they appear exactly once: against a dedicated `execute_tool` span, and against the same call id replayed across later steps' input history. Clicking any node jumps to that span in the List view.

  New pure, unit-tested helpers exported from the widget internals: `buildRunTrace` and `flattenTrace` (`genai/trace`).

- e6037fb: GenAI view: run-level summary strip and a guided "Explain run" tour.
  - **Run summary strip** — for any multi-span run (conversation group, or trace when there's no conversation id), a compact KPI row above the detail pane shows total cost, input→output tokens, reasoning tokens, model calls, tool executions, sub-agent count, duration and errors. Cost is summed only from table-priced calls and flagged with a trailing `+` when some calls are unpriced (a lower bound, never a fabricated total).
  - **Guided tour** — an "Explain run" button steps through the run's spans in chronological order with plain-language narration ("the model decides what to do", "a tool is real code the agent ran", "the model writes the answer"). Auto-play, prev/next, keyboard control (←/→/Space/Esc) and a progress bar; it drives the existing detail panes as the stage, and clicking a span jumps the narration to that step. Built for demoing what an agent actually did.

  New tree-shakeable helpers exported from the widget internals: `summarizeRun`/`groupRuns` (`genai/summary`) and `explainSpan`/`buildTour` (`genai/narration`), both pure and unit-tested.

  The run summary is accurate across span shapes. Some frameworks emit a wrapping model-call span (e.g. an outer `ai.generateText`) that is itself classified as `chat` and carries aggregate tokens, cost and tool calls that duplicate its child model calls; aggregate/parent spans (those that time-contain another span in the run) are now excluded from model-call, token and cost tallies. Inline tool calls are also deduped by tool-call id, since prior tool calls are often replayed in each turn's input history and the same call otherwise surfaces on several spans. Verified end-to-end against both a Logfire (Python) agent and a step-based JS agent, running on Ollama.

  Fixes a pre-existing units bug in GenAI span timing. `server/otlp.ts` converts OTLP nanosecond timestamps to **milliseconds** at ingestion (absolute nanosecond unix times overflow JS `Number` precision), which is the `SpanData` contract the whole app uses — but the GenAI layer mislabelled these as nanoseconds (`startNs`/`endNs`) and its formatters divided by 1e6 again, collapsing every live GenAI latency and run duration to `0μs`/`0ms`. The normalized fields are now `startMs`/`endMs` (`durationNs` → `durationMs` on `RunSummary`), the GenAI list/detail/timeline/summary formatters treat the value as milliseconds, and the captured test fixtures were converted from nanoseconds to milliseconds to match real ingestion. The unit-test data was stale-but-consistent (also nanoseconds), which is why this never failed a test; it only showed on live data.

  Also surfaces the executed tool name on normalized GenAI spans — `gen_ai.tool.name`/`gen_ai.tool.call.id` now populate a typed `tool: { name, callId }` field (previously only present untyped in `extras.raw`), so `execute_tool` steps read e.g. "Tool: get_user_time" instead of the generic agent name. The narration's planning-vs-responding classification also recognises a tool decision signalled purely via `finish_reasons` (`tool_call`/`tool_calls`/`tool_use`/`function_call`), which is how Ollama-via-Logfire reports it.

### Patch Changes

- e6037fb: GenAI view: token-breakdown labels and named tool steps in the tour.
  - The model detail header now spells out the **cached** and **reasoning** share of token usage inline — `176 (100 cached) → 90 (32 reasoning)` — instead of only a cached percentage, so the reasoning-token count is visible where the call is inspected.
  - The guided tour's planning step now **names the tools** the model requested: "Model calls getWeather (x3)" rather than the generic "Model decides what to do", falling back to the generic title when a provider signals the decision only via a finish reason (no structured tool calls to name).

  New shared formatters in `widget/utils/genaiFormat`: `formatInputTokens`, `formatOutputTokens`, and `summarizeToolCalls` (collapses repeats into `name (xN)`, truncates long lists).

- e6037fb: Guard the receiver's read surface against cross-origin scraping by web pages.

  The captured-telemetry read-back (`GET /v1/traces`), the clear endpoint (`DELETE /v1/traces`) and the live WebSocket (`/ws`) are now origin-checked. Previously every response carried `Access-Control-Allow-Origin: *`, so any website a developer happened to visit could `fetch('http://127.0.0.1:4318/v1/traces')` or open `ws://127.0.0.1:4318/ws` and read their locally captured prompts, responses and tokens.

  Two checks, matching the threat model:
  - A request to a read/stream endpoint carrying a **non-loopback `Origin`** (a cross-origin browser read) is rejected with `403`.
  - When the receiver is bound to a loopback host (the default), a **non-loopback `Host`** (DNS rebinding, where the read looks same-origin and may carry no `Origin`) is also rejected. An explicit non-loopback bind (`--host 0.0.0.0`) is treated as an opt-in to network exposure, so only the `Origin` check applies there.

  OTLP ingestion (`POST /v1/{traces,logs,metrics}`), `widget.js` and `healthz` stay fully open — browser apps on arbitrary dev origins must still send telemetry and load the embeddable widget, which keeps working because it connects from a loopback origin. Server-side reads with no `Origin` (curl, Node `fetch` in Playwright tests) are unaffected.

  New guard helpers are exported from `autotel-devtools/server`: `allowSensitiveRequest`, `isLoopbackHostname`, `hostHeaderIsLoopback`, `originIsLoopback`.

## 8.0.0

### Patch Changes

- Updated dependencies [47a69ac]
  - autotel@3.6.0

## 7.0.0

### Minor Changes

- 1c43d26: Security tab in the devtools widget. Surfaces spans carrying the `security.*` schema (autotel-audit security events and processor-flagged suspicious requests) with severity badges, category/outcome/service chips, a minimum-severity filter, severity counts, and one-click pivot to the owning trace.

### Patch Changes

- 3ab5dc3: chore: update dependencies + migrate workspace to vite 8

  Routine dependency refresh via npm-check-updates (3-day publish cooldown).
  - **Dev tooling:** vitest 4.1.8, `@types/node`, tsx, typescript-eslint 8.60.1, eslint 10.4.1, svelte 5.56, storybook 10.4.2, etc.
  - **Runtime/peer (published packages):** aws-sdk 3.1063, `@tanstack/{react,solid}-start` 1.168.25, hono 4.12.23, `@sentry/node` 10.56, `@cloudflare/workers-types`, react 19.2.7, ai-sdk / ai 6.0.197, `@traceloop/node-server-sdk` 0.27, google-auth-library 10.7, protobufjs 8.6, svelte 5.56.

  **Vite 8:** forced `vite ^8` across the workspace via a pnpm override. autotel was already partly on vite 8 (`@sveltejs/vite-plugin-svelte` 7 and `@vitejs/plugin-react` 6 both require it); storybook (svelte-vite), the astro docs, and the tanstack-start example all build cleanly on vite 8.

  eslint is held at `^9` in `apps/example-nextjs` (a private example) — `eslint-config-next` 16 / `eslint-plugin-react` are not yet eslint-10 compatible. Published packages are unaffected.

- Updated dependencies [1c43d26]
- Updated dependencies [3ab5dc3]
  - autotel@3.5.0

## 6.1.1

### Patch Changes

- bb9a1b7: Restructure the DevTools widget UX and add a configurable TanStack instrument() preset.
  - **autotel-devtools**: extract reusable abstractions (`useListKeyboardNav`, `useZoomPan`, `matchesNeedle`, `SearchInput`), decompose the `Panel` and restore its resize UX, unify the drag mechanic and tab bar across surfaces so no view is unreachable, and collapse the pause-buffer into a stream table.
  - **autotel-tanstack**: add a configurable `instrument()` preset; `auto.ts` now delegates to it.
  - **autotel**: export `isInitialized` from the package entry point.

- Updated dependencies [bb9a1b7]
  - autotel@3.4.2

## 6.1.0

### Minor Changes

- b539582: ### autotel-devtools — detect foreign OTLP collectors on port conflict, plus a first-class identity signal
  - **Foreign-collector detection:** when the requested port is busy and the receiver falls forward to another port, it now probes who holds the original port. If it is another autotel-devtools instance, the warning says so (benign). If it is a _foreign_ process (for example an IDE's built-in OTLP collector), it warns explicitly that apps exporting OTLP to the busy port are reaching that process — not this devtools — and to point the exporter at the bound port or free the original. This removes a silent footgun where the UI sat empty while apps saw export errors.
  - **Identity signal:** every HTTP response now carries an `x-autotel-devtools: <version>` header (exposed via CORS), and `GET /healthz` returns `{ ok, service: "autotel-devtools", version, clients }`. Clients and integrators can positively confirm they are talking to autotel-devtools instead of guessing from the body shape.
  - **Clearer ingest errors:** a failed OTLP POST now echoes the `contentType` it received alongside the message, so a misconfigured exporter (wrong or missing content type) is diagnosable from the 400 response.
  - **New exports:** `probePortHolder()`, `DEVTOOLS_IDENTITY`, and the `PortHolder` type are exported from `autotel-devtools/server`.

## 6.0.1

### Patch Changes

- ea2cb4a: ### autotel-devtools — CLI port shorthand, busy-port fallback, theme fix
  - **Port as a positional:** `npx autotel-devtools 4319` is shorthand for `--port 4319`; an explicit `--port`/`-p` always wins. Invalid ports exit with code 2.
  - **Busy-port fallback:** if the requested port is in use, the receiver walks forward (up to 20 consecutive ports) and binds the first free one, printing a warning with the actual port. Startup URLs and OTLP hints use the bound port.
  - **Bind-phase crash fix:** swallow WebSocketServer `error` re-emissions from `ws` during `EADDRINUSE` recovery so port-fallback probing no longer crashes the process.
  - **Theme in shadow DOM:** apply `data-theme` on the shadow host (via `getRootNode().host`) instead of `document.querySelector('autotel-devtools')`, so light/dark tokens resolve inside the widget stylesheet.

  ### autotel — lazy `node-require` for edge runtimes

  Defer `createRequire()` until the first `safeRequire()` / `requireModule()` / `nodeRequire()` call so merely importing `node-require` (and re-exports such as `track`) no longer throws in runtimes without a module path (e.g. Cloudflare Workers / workerd). Optional lookups still degrade to `undefined` via `safeRequire()`; `nodeRequire.resolve` (and `resolve.paths`) are forwarded lazily.

- Updated dependencies [ea2cb4a]
  - autotel@3.4.1

## 6.0.0

### Minor Changes

- 20a1186: Span inspection: code-location links, database query view, and inline span events.
  - **Code-location linking**: when a span carries `code.*` attributes (both the legacy `code.filepath`/`code.lineno` and current `code.file.path`/`code.line.number` conventions), the span detail panel renders a clickable editor deep-link. The target editor (VS Code / Cursor / WebStorm) is selectable and persisted across sessions.
  - **Database query inspection**: spans with `db.*` attributes get a dedicated panel showing system, operation, table, database name, and row counts, plus the SQL statement with display-only keyword/string highlighting. Highlighting only tokenises — it never reformats or rewrites the query.
  - **Inline span-event popover**: waterfall event markers are now clickable, opening an inline popover with the event name, timestamp, severity, and attributes. Dismissed on outside click or Escape. The marker lane-packing logic was extracted into a tested pure module.

- 20a1186: Cross-view navigation, connection status, and Flow keyboard control.
  - **Deep-link to a span**: a global `selectedSpanIdSignal` plus `openSpanInWaterfall(traceId, spanId)` let any view jump to a specific span in the Traces waterfall. The Flow detail panel and the GenAI span view now have an "Open in Traces" button; the waterfall expands collapsed ancestors and scrolls the target into view.
  - **Connection status**: the receiver connection state (connected / connecting / disconnected) is now shown — a labelled dot in the full-page sidebar and a compact dot in the embedded panel header — so "no data yet" is distinguishable from "not connected".
  - **Flow keyboard navigation**: with the graph focused, arrow keys move between nodes (left/right within a layer, up/down to the nearest node in the adjacent layer), Enter opens the node in Traces, and Esc deselects.

- 8fd868f: Devtools DX pass:
  - **Theming**: functional light/dark/system theme driven by `data-theme` + CSS custom-property tokens (`--at-*` mapped into Tailwind `@theme`), with a theme cycle toggle and `localStorage` persistence. Storybook gains a Theme toolbar so every story is viewable in both modes.
  - **JSON attribute viewer**: span attributes that are JSON objects/arrays (e.g. `gen_ai.input.messages`) now render as a collapsible, syntax-coloured tree instead of one long line. Reliable detection (try-parse, object/array only) falls back to the raw value for scalars and invalid JSON.
  - **Keyboard shortcuts**: centralised the `?` help modal into a single source of truth, fixing a bug where two help dialogs could stack. Context-aware shortcut lists for the trace list and trace detail.
  - **Span detail**: the attributes panel is now vertically resizable; the fullscreen value button is reachable (it previously had no `group` hover ancestor).
  - **Waterfall**: time-axis labels are responsive — marker count adapts to the column width and the first/last labels are edge-aligned, so they no longer collide in a narrow pane.
  - **Sub-millisecond precision**: fixed OTLP parsing truncating durations to whole milliseconds — fast spans (<1ms) now keep microsecond precision instead of showing `0ms`.
  - **Critical path**: the waterfall highlights the span chain that determines total trace latency (toggleable), pointing straight at the bottleneck.
  - **Self time**: span detail shows exclusive duration (span time minus children, interval-unioned) so you can tell a slow span from a slow subtree.
  - **Trace sorting**: sort the trace list by time / duration / span count / service / name / status to surface the slowest or largest traces.
  - **Min-duration filter**: filter the trace list to traces at least N ms long.
  - **Instrumentation scope**: span detail shows the emitting instrumentation name/version (parsed from OTLP `scope`).
  - **Service map redesign**: per-service pastel node fills with soft shadows, bold names, and `N spans · N err` subtitles; connection edges now show always-on labels (`1× · 900ms`, `2× · 50% err · 150ms`) with filled arrowheads and dashed red error edges — keeping the type-coded shapes (DB cylinder, messaging hexagon).
  - **Service map bug fixes**: (1) CLIENT-span connections used `inferResourceName` for the source, which resolved to the _peer_ and collapsed source==target so no edges ever rendered — the caller is now the span's own resource service; (2) SVG presentation attributes were written camelCase (`strokeWidth`, `strokeDasharray`, `markerEnd`, `textAnchor`), which Preact passes through verbatim and SVG ignores, so arrowheads, dashes, stroke widths, and text centring never applied — all converted to kebab-case.
  - **Design system pass**: introduced a typography duality — **Hanken Grotesk** for UI chrome, **JetBrains Mono** reserved for data (IDs, durations, attributes, code) — replacing the previous monospace-everything UI. Reworked the theme tokens into an **OKLCH** system with neutrals subtly tinted toward the brand hue (no pure black/white), and added restrained, reduced-motion-aware entrance animations for modals. Recorded the design context in `.impeccable.md`.
  - **Trace list redesign**: replaced the tall cards with a dense, scannable table — sortable column headers (Service, Operation, Duration, Spans, Time, Status) that drive the multi-axis sort directly, aligned monospace metrics, status badges, and per-service colour pills that match the service-map node colours. The columns are **container-responsive** (Spans + Time drop first) so it stays usable in a narrow docked widget without horizontal scroll.
  - Removed the unused `react-json-view-lite` dependency.

- 20a1186: Add a **Flow** view: a per-trace call graph that unifies AI tool calls, LLM calls and plain functions into one picture of what a run did.
  - New `Flow` tab (full-page + embedded panel) rendering a top-to-bottom node graph with `__start__`/`__end__` bookends, role-coloured nodes (entry / LLM / AI tool / function / db / http), and repeated calls collapsed into a single node with a count and error ratio (e.g. `calculate 4/5`).
  - Selecting a node opens an input/output panel that renders functions and AI tools identically — AI tools from `ai.toolCall.args/result`, plain functions from the `autotel.input`/`autotel.output` capture convention, with sensible fallbacks for db/http.
  - LLM economics: nodes and a per-trace header chip show token counts and USD cost, sourced from the canonical GenAI pricing layer. AI-SDK wrapper aggregates (`ai.streamText`) are counted once rather than double-counted with their `doStream` children.
  - Pure, unit-tested graph layer (`flow/flow.ts`): span classification, I/O extraction, repeat-collapsing graph build, per-node metric aggregation, and BFS/barycenter layout.
  - Shared `JsonField` and token/cost formatters so the Flow view, the GenAI view, and the ToolCallCard render I/O and economics from one place.

- 20a1186: `DevtoolsServer` gains an optional `onData(incremental)` callback, invoked after each ingest with the data just broadcast to WebSocket clients. Lets an embedder (e.g. the VS Code extension) keep its own views in sync while the server owns the buffer, error aggregation and WS fan-out. Listener errors are swallowed so a bad embedder can't break ingestion.
- 8fd868f: Rewrite the devtools widget UI from Preact to Svelte 5.
  - All widget components migrated to Svelte 5 (runes). Reactive state flows through a small signal shim (`signals.svelte.ts`) that preserves the `.value` API on top of runes, consumed by `store.svelte.ts` — so the store and call sites stayed stable across the rewrite.
  - The widget still mounts into a Shadow DOM custom element (`<autotel-devtools>`); the **public surface is unchanged** — server exports, the custom element, the CLI, and `widget.js` all behave as before.
  - **Accessibility**: a cohesive brand-accent `:focus-visible` ring replaces the browser default (which was off-brand and got clipped at scroll-container edges); list rows use an inset ring so it's never cut off; inputs that previously showed no visible focus now do. Clickable rows/SVG nodes gain keyboard activation, and modal backdrops are real `<button>`s.
  - **Visual fixes**: service-map edge labels get a surface-coloured halo so they stay legible over their connection lines; waterfall event markers now align to the bar instead of hanging below it.
  - Unified the tab → view dispatch into a single `TabView` shared by the full-page and embedded-panel surfaces (previously duplicated and drifted).
  - Icons moved from `lucide-svelte` to the Svelte 5-native `@lucide/svelte`.
  - **Tooling**: Vite, Storybook, Vitest, ESLint, and Prettier all moved to Svelte. `.svelte` files are now linted (`eslint-plugin-svelte`, incl. a11y rules) and formatted (`prettier-plugin-svelte`). Storybook stories run as browser tests (play functions) in CI alongside the unit suite, and `build-storybook` validates that every story compiles.

- 20a1186: The fullpage widget now honours a URL-hash deep-link: `#trace=<id>&span=<id>` opens the widget on the Traces waterfall focused on that trace/span once it arrives over the wire. Exposed via a new optional `deepLink` on `mountWidget`'s props and the `requestDeepLink(traceId, spanId?)` store helper. Lets an embedder (e.g. the VS Code extension) point an iframe at `/#trace=…` and land on the right span. (Also removes the unused `?position=` script param.)

### Patch Changes

- 20a1186: Clearer CLI startup banner for embedding the widget. The bundle auto-mounts on load, so the bare `<script src=".../widget.js"></script>` is all that's needed — the banner now says so explicitly (a floating panel appears automatically), and shows the two opt-in variations: `?mode=fullpage` for a full-screen view, or placing `<autotel-devtools></autotel-devtools>` yourself to control location. No behaviour change.
- Updated dependencies [20a1186]
  - autotel@3.4.0

## 5.1.0

### Minor Changes

- 52f8269: Make the trace detail panel resizable. Drag the divider between the timeline and the span detail panel to widen it (handy for long attributes like `gen_ai.input.messages`), double-click to reset, or focus the divider and use the arrow keys. The chosen width is clamped to the container and persisted to `localStorage`.

### Patch Changes

- 52f8269: Fix OTLP/protobuf ingestion failing with `protobuf.Root is not a constructor` in the published bundle.

  `otlp-proto.ts` imported protobufjs with `import * as protobuf`, which under esbuild's CJS→ESM interop left `protobuf.Root`/`protobuf.parse` undefined in the bundled ESM output — the form `npx autotel-devtools` runs. Every protobuf POST (the default for the Python/Java/Go SDKs over `http/protobuf`) was rejected with HTTP 400. Switched to a default import so the constructors resolve in both the ESM and CJS bundles.

  Added a regression guard that loads the built `dist/` bundle in a real Node process and decodes an OTLP/protobuf payload (`scripts/check-dist-esm.mjs`, run via the `otlp-proto.dist.test.ts` suite test and gated on publish through `prepublishOnly`). Source-level and vitest tests could not catch this because vite's loader resolves CJS interop differently than Node.

## 5.0.1

### Patch Changes

- 4ce86fc: Refresh package dependencies across the workspace and keep generated lockfile state in sync.

  Add OTLP/protobuf ingestion support to `autotel-devtools` for traces, logs, and metrics. The devtools HTTP receiver now accepts both OTLP/JSON and OTLP/protobuf payloads on the existing `/v1/traces`, `/v1/logs`, and `/v1/metrics` endpoints, decodes protobuf payloads with embedded OTLP schemas, and includes interop coverage using the OpenTelemetry protobuf serializers.

- Updated dependencies [4ce86fc]
  - autotel@3.3.1

## 5.0.0

### Minor Changes

- 30a485b: ### autotel-web — W3C baggage propagation

  Add end-to-end business-context propagation via W3C baggage.

  New `setBaggage(record)` / `clearBaggage(key?)` runtime API and an `init({ baggage: { initial, allowedOrigins } })` config option let you attach context such as `tenant.id` that travels with every instrumented request as a W3C `baggage` header and is tagged onto every browser-recorded span. On the backend, autotel's `BaggageSpanProcessor` copies the entries onto server spans, so a single attribute (e.g. `tenant.id`) appears on browser and server spans across the whole trace — no more reading the tenant from request URLs in devtools.

  `setBaggage()` merges additively (matching Sentry `setTags` / Datadog `setGlobalContextProperty` ergonomics) and works for values known only at runtime (post-login, tenant switcher). Baggage injection is **fail-closed**: it is sent only to same-origin requests unless a destination is listed in `baggage.allowedOrigins`, and never travels wider than `traceparent` (inherits DNT/GPC/blocked-origin suppression), so customer-identifying values are not leaked to third-party origins. Covers both `fetch` and `XMLHttpRequest`.

  ### autotel-adapters — Express, Fastify, auto-emit

  Add Express and Fastify adapters and emit one canonical wide event per request by default across all adapters.

  `autotel-adapters/express` and `autotel-adapters/fastify` expose `withAutotel(handler, options)` and `useLogger(request)`, matching the existing Next, Nitro, and Cloudflare adapters. Each request opens a span, gets a request-scoped logger, and emits one canonical wide event when the handler settles.

  ```typescript
  import { withAutotel, useLogger } from 'autotel-adapters/express';

  app.get(
    '/orders',
    withAutotel((req, res) => {
      useLogger(req).set({ feature: 'checkout' });
      res.json({ ok: true });
    }),
  );
  ```

  The Express wrapper records thrown errors and forwards them to `next`; the Fastify wrapper records and rethrows for Fastify's error handling.

  **Behavior change:** `autoEmit` now defaults to `true` for every adapter, including the existing Next, Nitro, and Cloudflare wrappers. Each wrapped handler emits one wide event per request. Pass `{ autoEmit: false }` to restore the previous behavior of not emitting automatically.

  ### autotel — PII redaction, catalogs, LLM cost

  **Auto-enable PII redaction in production.** When `attributeRedactor` is left unset and the resolved environment is `production` (`config.environment` or `NODE_ENV`), `init()` now applies the `'default'` redaction preset. Span attributes are scrubbed of emails, phones, SSNs, credit cards, and sensitive keys before any exporter sees them. In non-production environments redaction stays off so local debugging shows real values.

  **Behavior change:** production telemetry that previously exported raw values now has PII redacted by default. Control it:
  - `init({ attributeRedactor: 'strict' })` — stronger preset, applied in every environment.
  - `init({ attributeRedactor: false })` — disable redaction entirely, even in production.
  - `AUTOTEL_REDACT_PII` env var — `off` disables, `default` / `strict` / `pci-dss` selects a preset, `on` forces the default preset on in any environment.

  Precedence: explicit config, then env var, then the production default. The `attributeRedactor` config field now also accepts `false`.

  **Typed error and audit catalogs:** `defineErrorCatalog()` and `defineAuditCatalog()`.

  Group related errors into one catalog and get a refactor-safe builder per code, with autocomplete at every call site and typed message parameters. Each builder produces a `StructuredError` carrying the entry's `message`, `status`, `code`, `why`, `fix`, and `link`; codes default to `${namespace}.${KEY}`.

  ```typescript
  import { defineErrorCatalog } from 'autotel';

  const billing = defineErrorCatalog('billing', {
    PAYMENT_DECLINED: {
      status: 402,
      message: 'Card declined',
      why: '...',
      fix: '...',
    },
    INSUFFICIENT_FUNDS: {
      status: 402,
      message: ({
        available,
        required,
      }: {
        available: number;
        required: number;
      }) => `Insufficient funds: $${available} of $${required}`,
    },
  });

  throw billing.PAYMENT_DECLINED({ cause: stripeError });
  throw billing.INSUFFICIENT_FUNDS({ available: 5, required: 100 });

  if (billing.PAYMENT_DECLINED.match(err)) {
    /* ... */
  }
  ```

  `defineAuditCatalog()` produces typed audit-action descriptors (`action`, `severity`, optional `message`). Helpers `isCatalogError()` and `getCatalogCode()` read the catalog code off any error.

  **Per-model LLM cost estimation:** `estimateLLMCost()`, `recordLLMCost()`, and a `MODEL_PRICING` table.

  Estimate the USD cost of an LLM call from its token usage and record it as the `gen_ai.usage.cost.usd` span attribute, pairing with the existing `gen_ai.client.cost.usd` metric bucket advice.

  ```typescript
  import { trace, recordLLMCost } from 'autotel';

  export const chat = trace((ctx) => async (prompt: string) => {
    const res = await client.messages.create({ model /* ... */ });
    recordLLMCost(ctx, model, {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    });
    return res;
  });
  ```

  `MODEL_PRICING` ships approximate public list prices for common OpenAI, Anthropic, and Gemini models; override or extend per call via `{ pricing }`. Versioned model ids resolve to a base entry by longest-prefix match, and cached input tokens are billed at `cachedInputPer1M` when provided.

  ### autotel-devtools — HTTP read-back and dual-stack loopback
  - **`GET /v1/traces`** returns the traces the receiver has actually captured (`{ traces, count }`), and **`DELETE /v1/traces`** clears captured telemetry. This lets integration/Playwright tests verify the collector _received_ spans by polling it over HTTP — instead of only asserting "the client tried to send", which a browser-level route intercept can fulfil before the request ever reaches a server.
  - **Dual-stack loopback:** when bound to a loopback host, the CLI and `createDevtools()` now listen on **both** `127.0.0.1` and `::1`, so a client connecting via `localhost` reaches the receiver regardless of how the OS resolves `localhost` (macOS prefers IPv6 `::1`). This removes a silent footgun where a dev-server proxy targeting `localhost` saw its spans vanish with no error against an IPv4-only receiver.
  - **Startup self-check:** the CLI prints every bound address, a `curl .../v1/traces` verification hint, and a warning (not a silent failure) if a loopback family can't be bound.
  - New README sections: "Behind a dev-server proxy" (the `pathRewrite` + `127.0.0.1` gotchas) and "Verifying ingestion in tests".

  ### autotel-subscribers — FileSubscriber

  Add `FileSubscriber` (`autotel-subscribers/file`): append tracked events to a file as newline-delimited JSON (NDJSON).

  Useful for AI agents, scripts, evals, and local debugging that want structured events on disk without a hosted backend. Query the file with `jq`, load it into a notebook, or feed it to an agent.

  ```typescript
  import { Event } from 'autotel/events';
  import { FileSubscriber } from 'autotel-subscribers/file';

  const events = new Event('worker', {
    subscribers: [new FileSubscriber({ path: './telemetry/events.ndjson' })],
  });
  ```

  Writes are serialized so concurrent events never interleave. Options: `pretty` for indented JSON, `mkdir` to create parent directories (default on), and `transform` to reshape or drop events before writing.

  ### autotel-terminal — dual-stack loopback

  Bind both loopback families and warn on partial binding.

  When bound to a loopback host, the receiver now listens on **both** `127.0.0.1` and `::1`, so a client (or dev-server proxy) connecting via `localhost` reaches it regardless of how the OS resolves `localhost` (macOS prefers IPv6 `::1`). Previously the CLI bound IPv4-only, so a `localhost` proxy could silently send spans into a black hole. The startup line now prints every bound address and warns (rather than failing silently) if a loopback family can't be bound. Added a README "Behind a dev-server proxy" section documenting the `pathRewrite` + `127.0.0.1` gotchas.

### Patch Changes

- Updated dependencies [30a485b]
  - autotel@3.3.0

## 4.0.0

### Patch Changes

- Updated dependencies [9fbbc3a]
  - autotel@3.2.0

## 3.0.1

### Patch Changes

- Updated dependencies [3966db0]
  - autotel@3.1.1

## 3.0.0

### Patch Changes

- Updated dependencies [614d414]
  - autotel@3.1.0

## 2.1.0

### Minor Changes

- ee60622: Bring GenAI parity, editor-integrated DX, and a portable backend layer to `autotel-vscode`, and expose the GenAI normalization layer for any consumer.
  - `autotel-devtools` (minor)
    - New public export `autotel-devtools/genai` exposing the pure-TS GenAI normalization layer: `isGenAiSpan`, `toGenAiSpan`, `buildToolResultIndex`, `hydrateToolResults`, `lookupPrice`, `priceCall`, plus types (`GenAiSpan`, `GenAiMessage`, `GenAiMessagePart`, `GenAiToolCall`, `GenAiUsage`, `GenAiCost`, `GenAiOperation`, `GenAiRole`, `GenAiToolDef`). Dual ESM+CJS build with full `.d.ts`.
    - New widget GenAI tab with master/detail layout (`GenAiView`), per-span `ModelHeader` + `ConversationPanel`, expandable tool-call cards with Input/Output split, and an `AgentTimeline` swim-lane view that groups spans by `gen_ai.conversation.id`. Tab live-count badge sourced from a cached `genAiRowsSignal` so normalization runs once at ingest, not per render.
    - Normalizer covers Vercel AI SDK (`experimental_telemetry`, including the wrapper `ai.generateText` span and `ai.toolCall` sibling spans stitched in), Pydantic AI + Logfire (incl. parent `agent run` hydration via `pydantic_ai.all_messages`), OpenAI Agents v2 handoffs, Anthropic with prompt caching, OpenAI v2, Google GenAI / Logfire, and LangChain via `opentelemetry-instrumentation-langchain`.
  - `autotel-vscode` (minor)
    - GenAI rendering in the span detail webview — provider chip, model, latency, tokens (with cache %), cost, agent/handoff/conversation metadata, role-colored bubbles, expandable tool-call cards with Input (neutral) / Output (green) sections. All styling uses VSCode CSS variables for native light/dark theme.
    - Editor-integrated DX — `AutotelCodeLensProvider` + `AutotelHoverProvider` aggregate the live trace buffer by `code.filepath:code.lineno` (OTel semconv) and surface `📊 N traces · p50 X · p95 Y · Z% errors` above instrumented functions. Toggle via `autotel.codeLens.enabled`.
    - Pluggable backend connectors — `QueryAdapter` interface + global registry under `src/backends/`. Concrete adapters for **Jaeger**, **Grafana Tempo**, **Honeycomb**, **Datadog APM**, **Pydantic Logfire**, and **SigNoz** — each translates its native shape into the same `SpanData` the local OTLP receiver produces.
    - Commands — `autotel.queryBackend` (pull traces from a configured backend into the same buffer), `autotel.setBackendCredential` / `autotel.clearBackendCredential` (store API tokens in `vscode.SecretStorage`, never in settings), `autotel.openMetrics` (service-aggregated count / p50 / p95 / error-rate + top-10 operations per service), `autotel.openServiceMap` (inline SVG of cross-service edges sized by call count, errored edges red).
    - Config — `autotel.backend.type` (`none` | `jaeger` | `tempo` | `honeycomb` | `datadog` | `logfire` | `signoz`), `autotel.backend.url`, `autotel.backend.dataset`, `autotel.codeLens.enabled`.
  - `autotel` (patch)
    - Fix `safeRequire` under ESM consumers. `src/node-require.ts` previously used a `typeof require === 'undefined'` ternary that tsup code-splitting rewrote into a polyglot `__require` stub, causing optional peers (e.g. `@traceloop/node-server-sdk` used by `init({ openllmetry: { enabled: true } })`) to throw `"Dynamic require of X is not supported"` in ESM. Now uses `createRequire(import.meta.url)` unconditionally; esbuild rewrites it correctly for both ESM and CJS output. Also adds a docstring callout on the `sampling` field flagging the default `production()` preset's 10% baseline footgun for one-shot capture scripts.

### Patch Changes

- Updated dependencies [ee60622]
  - autotel@3.0.7

## 2.0.6

### Patch Changes

- Updated dependencies [8d5d84d]
  - autotel@3.0.6

## 2.0.5

### Patch Changes

- 1a8bedd: Updated dependencies
- Updated dependencies [1a8bedd]
  - autotel@3.0.5

## 2.0.4

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

- Updated dependencies [3a21282]
  - autotel@3.0.4

## 2.0.3

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

## 2.0.2

### Patch Changes

- Updated dependencies [5999cb9]
  - autotel@3.0.2

## 2.0.1

### Patch Changes

- 5d05a3e: Add Cloudflare Workers support to main `autotel` package. Introduces `autotel/workers` and `autotel/cloudflare` entry points that re-export the functional API and Cloudflare-specific instrumentation from `autotel-cloudflare`, providing better DX for Cloudflare users while keeping the core package modular. Updates package exports, build config, and documentation.
- Updated dependencies [5d05a3e]
  - autotel@3.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [b1f3704]
  - autotel@3.0.0

## 1.0.3

### Patch Changes

- dc4908d: Updated deps
- Updated dependencies [dc4908d]
  - autotel@2.26.3

## 1.0.2

### Patch Changes

- Updated dependencies [abe7674]
  - autotel@2.26.2

## 1.0.1

### Patch Changes

- Updated dependencies [dc471ef]
  - autotel@2.26.1

## 1.0.0

### Patch Changes

- Updated dependencies [8003fad]
  - autotel@2.26.0
