# autotel-web

## 1.15.0

### Minor Changes

- dbd968d: Observe a browser session, and tell automated sessions apart from people's.

  `withBrowserSession()` (`autotel-playwright/session`) wraps a Playwright
  `BrowserContext` in one `browser.session` span and records what the session
  cost: `browser.session.cpu.time`, `.memory.usage`, `.network.io`, `.pages` and
  `.console.errors`, with console output as `browser.console` events and every
  uncaught page exception on the span. It takes a `BrowserContext` rather than a
  test fixture, so agents and scrapers driving a browser in production get the
  same view, exported to whatever backend `init()` already points at. The span is
  active for the callback, so work started inside it joins the trace.

  `autotel-web` now sets `user_agent.synthetic.type: 'test'` on the resource when
  `navigator.webdriver` is set, which every browser automation framework does.
  Segment on it to keep automated sessions in their own panels.

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

## 1.14.1

### Patch Changes

- a271e71: Trace Chrome's built-in AI APIs, stop exporting to collectors nobody
  configured, and fix four ways browser telemetry went missing.

  ## New package: autotel-builtin-ai

  OpenTelemetry instrumentation for
  [Chrome's built-in AI APIs](https://developer.chrome.com/docs/ai/built-in).
  Traces `availability()`, `create()` and every session method across all eight
  built-in AI globals, and records the facts the platform does not keep:

  - **Whether an availability guard was passed the options it was guarding.**
    `availability()` answers for the options you hand it, not for model readiness,
    so `availability() !== 'available'` — the guard Chrome's own docs show —
    refuses on browsers where the call would have worked.
  - **How long `create()` blocked on a model download.** 190,163 ms measured,
    against 1–3 ms warm.
  - **Whether a download monitor firing meant a download happened.** It fires
    either way, so a progress bar flashes 0→100 for returning visitors.
  - **Time to first token** on streaming calls, which exists only while the stream
    is running.
  - **Whether a session could report its own sampling mode.** `samplingMode` reads
    back `null` when `topK` or `temperature` was used.

  Two entry points, matching `autotel-webmcp`: the default wires autotel-web's
  `span()` in, and `autotel-builtin-ai/core` takes your own span factory with no
  telemetry dependency. Payload capture is off by default.

  ## No endpoint means no export

  With no endpoint from `init()`, YAML or `OTEL_EXPORTER_OTLP_ENDPOINT`, autotel
  now exports nothing. The Node SDK's default is the opposite: leave the processor
  lists unset and it installs its own OTLP exporter aimed at
  `http://localhost:4318`, so "no endpoint configured" quietly became "export to
  localhost" — a doomed request per batch, forever, with no error naming the
  cause. Autotel passes empty processor lists for **both traces and logs**
  instead. `OTEL_LOGS_EXPORTER` is still left to govern itself, because that is
  the specification's own switch.

  Not exporting and not tracing are different things, so a `TracerProvider` is
  still registered when there is nothing to export. Without one nothing records,
  `traceparent` stops being injected, and a service with no endpoint of its own
  can no longer pass the trace to the next one.

  A caller's explicit `spanProcessors: []` is a real off switch too; empty and
  absent used to be indistinguishable.

  ## Canonical log lines to a logger and OTLP at once

  `canonicalLogLines.logger` now takes an array, and the new `canonicalLogLines.otel`
  sends the same wide line through the OpenTelemetry Logs API alongside it — so a
  platform's own log view keeps the lines while OTLP carries them to Loki or
  another backend. It defaults to `true` only when no `logger` is given, which is
  the previous either/or behaviour. Setting `otel: true` also wires the endpoint's
  log exporter, unless `logs: false` says otherwise; without that the lines went
  to a no-op provider and never arrived. A failing logger no longer stops the
  others from receiving the line.

  ## autotel-backends

  `createGrafanaConfig()` no longer doubles the signal path when the endpoint you
  paste already ends in `/v1/traces` — traces went to `/otlp/v1/traces/v1/traces`
  while logs, built from the stripped base, arrived correctly.

  Every preset that selects a non-default `protocol` now names the optional peer
  dependency it needs, in the JSDoc and in the error thrown when it is missing.
  Bundlers do not follow the lazy `require` that loads those exporters, so they
  have to be direct dependencies of the application — and the failure otherwise
  surfaces at `init()`, which in a serverless app means the first traced request
  in production.

  ## autotel-web fixes
  - **`endpoint: ''`** is honoured as the documented same-origin configuration
    again, rather than read as "no endpoint". It was disabling every export in
    lean mode: spans, logs and events, silently.
  - **Full mode beacons on the way out**, as lean mode already did. Events and
    console logs sit in a 2-second batch and a page being navigated away from has
    no next tick, so the end of every visit — `session.end` included — was exactly
    the part that never arrived.
  - **A partial remote frustration override no longer disables the other
    detector.** Remote `{ captureDeadClicks: false }` stopped rage clicks too,
    even though their remote value was absent and documented to leave the local
    setting alone.
  - **A failed model stream is recorded as a failure.** The source erroring left
    the span either successful or open forever, while the caller saw a broken
    stream.
  - **`debug` plus `captureConsoleLogs` no longer loops.** The exporter narrates
    each flush on the console, and exporting its own narration queued the record
    that caused the next flush, for as long as the page was open.

## 1.14.0

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

## 1.13.3

### Patch Changes

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

## 1.13.2

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

## 1.13.1

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

## 1.13.0

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

## 1.12.8

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

## 1.12.7

### Patch Changes

- 756345d: Skills no longer ship inside the npm package tarballs. They now live at the repo root under `skills/`, grouped into `core/`, `frameworks/`, `integrations/`, and `contributing/`, as a single source of truth discovered by the skills CLI (`npx skills add jagreehal/autotel --skill <name>`). `skills` is removed from each package's `files` field, so installing a package no longer adds its skill to `node_modules`. Install skills explicitly with the CLI instead.

## 1.12.6

### Patch Changes

- 3d9e31c: Relicense from MIT to Apache-2.0. The `license` field now reads `Apache-2.0`, and the package ships the Apache-2.0 `LICENSE`. This changes the licence only; there are no API changes. Prior releases remain available under their original MIT terms. See `NOTICE` and `TRADEMARKS.md` in the repository root for attribution and the "autotel" trademark policy.

## 1.12.5

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

## 1.12.4

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

## 1.12.1

### Patch Changes

- 4ce86fc: Refresh package dependencies across the workspace and keep generated lockfile state in sync.

  Add OTLP/protobuf ingestion support to `autotel-devtools` for traces, logs, and metrics. The devtools HTTP receiver now accepts both OTLP/JSON and OTLP/protobuf payloads on the existing `/v1/traces`, `/v1/logs`, and `/v1/metrics` endpoints, decodes protobuf payloads with embedded OTLP schemas, and includes interop coverage using the OpenTelemetry protobuf serializers.

## 1.12.0

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

## 1.11.6

### Patch Changes

- 1a8bedd: Updated dependencies

## 1.11.5

### Patch Changes

- 5e146a7: Streamline package surface and align skills with the [Agent Skills specification](https://agentskills.io/specification).
  - Drop `@tanstack/intent` from runtime and dev dependencies, plus the auto-generated `bin/intent.js` shims. Skills still ship under each package's `skills/` directory and are discovered by spec-compliant agents (Claude Code, Cursor, Cline, etc.) via filesystem scan — no consumer-side CLI required.
  - Remove the `autotel/workers` and `autotel/cloudflare` entry points from `autotel`. Cloudflare Workers users should import directly from `autotel-cloudflare` (and its `/logger`, `/sampling`, `/events` subpaths). `autotel` no longer peer-depends on `autotel-cloudflare` or `autotel-edge`.
  - Strip non-spec frontmatter (`type`, `library`, `library_version`, `sources`, `requires`) from all `SKILL.md` files; keep only spec-defined fields (`name`, `description`, optional `license`).
  - Move user-facing skills (`migrate-to-autotel`, `tune-sampling`, `debug-missing-spans`, `build-audit-trails`) into `packages/autotel/skills/` so consumers receive them automatically via npm. Contributor-only skills (`create-autotel-adapter`, `create-autotel-instrumentation`, `create-autotel-exporter`) remain under the repo-root `skills/` directory.
  - Realign `autotel`'s peer dependency ranges to match published versions on npm.
  - Release workflow now refreshes `pnpm-lock.yaml` after `changeset version` so the next Version Packages PR ships with a consistent lockfile.

## 1.11.4

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

## 1.11.3

### Patch Changes

- 5d05a3e: Add Cloudflare Workers support to main `autotel` package. Introduces `autotel/workers` and `autotel/cloudflare` entry points that re-export the functional API and Cloudflare-specific instrumentation from `autotel-cloudflare`, providing better DX for Cloudflare users while keeping the core package modular. Updates package exports, build config, and documentation.

## 1.11.2

### Patch Changes

- dc4908d: Updated deps

## 1.11.1

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

## 1.11.0

### Minor Changes

- 88b4eab: Add error tracking with PostHog integration
  - **autotel-web**: Rich error capture in full mode - stack trace parsing (Chrome/Firefox/Safari), exception chains via error.cause, per-type rate limiting, configurable suppression rules, manual `captureException()` API, and automatic PostHog detection to avoid double-capture
  - **autotel**: New `posthog: { url }` init option and `POSTHOG_LOGS_URL` env var for zero-config OTLP log export to PostHog
  - **autotel-subscribers**: `captureException()` on PostHogSubscriber for sending errors via PostHog capture API, auto-detection of error spans in the event pipeline, and PostHog `$exception_list` formatting

- 88b4eab: Add PII redaction to all PostHog export paths. Two-layer approach: regex value scanning
  for emails, phones, credit cards, JWTs in error messages and stack traces, plus slow-redact
  path-based redaction for known sensitive fields in structured event attributes.
  - Extract `createStringRedactor()` utility from core `AttributeRedactingProcessor`
  - Add `RedactingLogRecordProcessor` wrapper for PostHog OTLP logs
  - Add redactor support to `posthog-error-formatter` (exception.value, abs_path)
  - Add `redactPaths` and `stringRedactor` options to `PostHogSubscriber`
  - Duplicate string redactor in `autotel-web` for browser error tracking
  - Wire `attributeRedactor` from `init()` through to all PostHog paths automatically

## 1.10.1

### Patch Changes

- 65b2fc9: - Bug fixes and dependency updates across packages.
  - example-vitest: API tests use a random port (when `API_BASE_URL`/`PORT` unset) to avoid EADDRINUSE on port 3000.

## 1.10.0

### Minor Changes

- 1155c72: - **autotel-backends**: Add Grafana backend; export and type updates.
  - **autotel, autotel-\***: Dependency bumps, docs/comment updates, and version alignment across the monorepo.

## 1.9.0

### Minor Changes

- c710c71: Add option to hide free/busy times (or selected attributes) in console export and related exporters.

## 1.8.0

### Minor Changes

- d1bd8cd: - **autotel-sentry**: README updates : clarify Sentry SDK + OTel scenario, link to Sentry OTLP docs, note that Sentry ingestion request spans are not sent, fix `SentrySpanProcessor` backtick typo, add spec-volatility note.
  - **autotel-backends**: Preserve caught error in Google Cloud config : attach original error as `cause` when throwing the user-facing error so the `preserve-caught-error` lint rule is satisfied.

## 1.7.1

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

## 1.7.0

### Minor Changes

- c68a580: - **autotel**: Add correlation ID support for event-driven observability (stable join key across events, logs, and spans via AsyncLocalStorage; optional baggage propagation). Add events configuration for `init()`: `includeTraceContext`, `traceUrl`, and baggage enrichment with allow/deny and transforms. Event queue and event subscriber now attach correlation ID and trace context to events. New `autotel/correlation-id` and `autotel/events-config` types used internally; init accepts `events` option.
  - **autotel-subscribers**: EventSubscriber base class and adapters (PostHog, Mixpanel, Amplitude) updated to use `autotel/event-subscriber` types and AutotelEventContext; graceful shutdown and payload normalization aligned with new event context and correlation ID.
  - **autotel-edge**, **autotel-cloudflare**, **autotel-aws**, **autotel-backends**, **autotel-tanstack**, **autotel-terminal**, **autotel-plugins**, **autotel-cli**, **autotel-mcp**, **autotel-web**: Version bumps for compatibility with autotel core.

## 1.6.1

### Patch Changes

- acfd0de: Add comprehensive test coverage for Datadog backend configuration, including validation, direct cloud ingestion, agent mode, and OTLP logs export functionality.

## 1.6.0

### Minor Changes

- 47c70fb: Update dependencies across all packages:
  - **OpenTelemetry**: Update to v2.5.0 (core packages) and v0.211.0 (SDK packages)
  - **AWS SDK**: Update all client packages from v3.972.0 to v3.975.0
  - **TypeScript ESLint**: Update from v8.53.1 to v8.54.0
  - **Turbo**: Update from v2.7.5 to v2.7.6
  - **Vitest**: Update from v4.0.17 to v4.0.18
  - **@types/node**: Update from v25.0.9 to v25.0.10
  - **Cloudflare Workers Types**: Update from v4.20260120.0 to v4.20260124.0

## 1.5.0

### Minor Changes

- 8256dac: Add comprehensive awaitly integration example demonstrating workflow instrumentation with autotel OpenTelemetry. The new `awaitly-example` app showcases successful workflows, error handling, decision tracking, cache behavior, and visualization features. Updated prettier to 3.8.1 across all packages.

## 1.4.1

### Patch Changes

- 3e12422: Update dependencies across all packages:
  - OpenTelemetry packages: 0.208.0 → 0.210.0
  - OpenTelemetry SDK packages: 2.2.0 → 2.4.0
  - import-in-the-middle: 2.0.1 → 2.0.4
  - pino: 10.1.0 → 10.1.1
  - TypeScript ESLint: 8.52.0 → 8.53.0
  - vitest: 4.0.16 → 4.0.17
  - @types/node: 25.0.3 → 25.0.8

## 1.4.0

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

## 1.3.0

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

## 1.2.0

### Minor Changes

- 79f49aa: Updated example

## Released

Initial release as `autotel-web` (renamed from `autotel-web`).
