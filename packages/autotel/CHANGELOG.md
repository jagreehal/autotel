# autotel

## 7.6.1

### Patch Changes

- cb05004: Show one tracing shape across the examples, the agent docs, and the skill.

  Reusable work is wrapped with `trace('operation.name', fn)`, and the span is
  read through the ambient `ctx` import:

  ```ts
  import { trace, ctx } from 'autotel';

  export const createUser = trace('user.create', async (data) => {
    ctx.setAttribute('user.id', data.id);
    return db.users.create(data);
  });
  ```

  `ctx` resolves the active span at property access, so a helper several frames
  inside a traced body reaches the same span without being handed anything, and
  `getRequestLogger()` reads that span when called with no arguments.

  `withTracing({ name })((ctx) => fn)` keeps its place for wrappers that want the
  context as an argument, and `instrument({ key, fn })` remains the options form
  of the wrapper. `AGENTS.md`, `docs/AGENT-GUIDE.md` and
  `.claude/skills/autotel` now name when each one fits.

  The `apps/book-chapters` examples run on these forms, under explicit span
  names, and `pnpm --filter @autotel/book-chapters test` covers every one.

## 7.6.0

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

## 7.5.0

### Minor Changes

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

## 7.4.0

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

## 7.3.0

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

## 7.2.0

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

## 7.1.0

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

## 7.0.1

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

## 7.0.0

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

## 6.5.0

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

## 6.4.1

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

## 6.4.0

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

## 6.3.0

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

## 6.2.1

### Patch Changes

- 7bad202: Fix `Metric` recording into a no-op meter, and honour `OTEL_METRIC_EXPORT_INTERVAL`.

  Two bugs that combined to mean business metrics never reached Prometheus.

  `Config` resolves `metrics.getMeter()` when the module is imported, which is always before `init()` registers a MeterProvider. The metrics API hands back a no-op meter until a provider exists and never revisits that decision, so every counter and histogram created through `new Metric(...)` or `getMetrics(...)` silently recorded nothing. The meter is now re-resolved on read unless the caller supplied their own instance. Existing tests missed it because they call `configure({ meterName })` in setup, which happened to re-resolve.

  `PeriodicExportingMetricReader` hardcodes a 60s interval and only `NodeSDK` reads the standard env var, but autotel builds the reader itself. `OTEL_METRIC_EXPORT_INTERVAL` and `OTEL_METRIC_EXPORT_TIMEOUT` are now honoured, so a short-lived process or a local demo can export often enough for `rate()` to return anything. Unset, the SDK defaults are untouched.

## 6.2.0

### Minor Changes

- 0f518c6: Support OTLP protobuf, and send to PostHog.

  **`protocol: 'http/protobuf'`** is now a first-class option alongside `'http'`
  and `'grpc'`. Until now autotel could only send OTLP/HTTP with a **JSON** body,
  because `protocol: 'http'` resolves to
  `@opentelemetry/exporter-trace-otlp-http`, which serializes JSON. Several
  vendors — Pydantic Logfire and PostHog among them — accept protobuf only and
  drop a JSON body without an error, so telemetry silently went nowhere.

  The protobuf exporters are optional peer dependencies, loaded on demand like the
  gRPC ones, so nothing is added to the default install:

  ```bash
  pnpm add @opentelemetry/exporter-trace-otlp-proto
  ```

  `OTEL_EXPORTER_OTLP_PROTOCOL` now follows the spec: `http/protobuf` selects
  protobuf rather than being treated as a synonym for `http`, `http/json` and
  `http` both select JSON, and `grpc` is unchanged. **If you already set
  `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`, you were getting JSON and will now
  get protobuf** — which is what you asked for, but it means installing
  `@opentelemetry/exporter-trace-otlp-proto` or your exporter will fail loudly at
  startup rather than quietly sending the wrong encoding.

  **`createLogfireConfig` is fixed on two counts**, both confirmed by a live
  write-then-read round trip:

  - it emitted `protocol: 'http'`, so traces were serialized as JSON and Logfire
    discarded them silently
  - it defaulted to the shared `logfire-api.pydantic.dev` host, which returns 401
    for ingest. Logfire's own SDK resolves the region host from the token
    client-side rather than relying on server-side routing

  `region` is now **required** — both ingest and the query API are region-specific,
  and a mismatch returns a bare 401 that names neither cause, so guessing it is
  worse than asking. Anyone who adopted this preset should upgrade; the previous
  version delivered nothing.

  **`createPostHogConfig`** is new. PostHog ingests OTLP traces, logs and metrics,
  so product analytics and distributed traces can share a destination:

  ```typescript
  import { createPostHogConfig } from 'autotel-backends/posthog';

  init(
    createPostHogConfig({
      projectToken: process.env.POSTHOG_PROJECT_TOKEN!,
      service: 'my-app',
      region: 'eu', // or 'us'
    }),
  );
  ```

  It handles the `/i` path prefix PostHog's OTLP receiver lives under, so signals
  land on `/i/v1/traces`, `/i/v1/logs` and `/i/v1/metrics`. This is the telemetry
  path; `autotel-subscribers/posthog` remains the separate route for product
  events.

  `createLangfuseConfig` is unaffected — Langfuse accepts both JSON and protobuf.

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

## 6.1.0

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

## 6.0.0

### Major Changes

- 756345d: Process shutdown handlers are now opt-in instead of auto-registered on import.

  Importing `autotel` no longer installs `SIGTERM`/`SIGINT` listeners. Long-running
  applications opt in via `init()`:

  ```typescript
  init({
    service: 'checkout-api',
    processHandlers: true, // SIGTERM/SIGINT + fatal errors, 2s shutdown timeout
  });
  ```

  Or override individual defaults:

  ```typescript
  init({
    service: 'checkout-api',
    processHandlers: {
      signals: ['SIGTERM'], // default: ['SIGTERM', 'SIGINT']
      fatalErrors: false, // default: true (uncaughtException + unhandledRejection)
      shutdownTimeoutMs: 5_000, // default: 2_000
    },
  });
  ```

  Enabled signals flush telemetry via `shutdown()` (bounded by `shutdownTimeoutMs`,
  default 2s) and exit with the conventional signal status (143 for SIGTERM, 130 for
  SIGINT); fatal errors exit with status 1. Applications that manage their own
  shutdown should keep their own handlers and call `await shutdown()` explicitly.

  Also: `shutdown()` now suppresses unreachable-endpoint exporter errors
  (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`) across `AggregateError` and `cause`
  chains, not just a top-level `ECONNREFUSED`.

### Patch Changes

- 756345d: Skills no longer ship inside the npm package tarballs. They now live at the repo root under `skills/`, grouped into `core/`, `frameworks/`, `integrations/`, and `contributing/`, as a single source of truth discovered by the skills CLI (`npx skills add jagreehal/autotel --skill <name>`). `skills` is removed from each package's `files` field, so installing a package no longer adds its skill to `node_modules`. Install skills explicitly with the CLI instead.

## 5.0.0

### Major Changes

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

## 4.3.0

### Minor Changes

- 4f4f074: Scenario conformance: flow-level contracts with completion boundaries.

  `autotel-schema` gains a `scenarios` section in `defineContract()` — declare which events one exercised flow must emit, their cardinality (`'exactly 1'`, `'at most 3'`, ranges), required ancestor→descendant topology edges, and a first-class completion boundary (`terminal-event`, `root-span-closed`, `externally-reconciled`). `checkScenario()` polls collected spans until the boundary closes, a definitive violation appears, or the observation budget is spent, and returns one of **three** outcomes: `conformant`, `non-conformant`, or `incomplete` — so infrastructure slowness is never reported as behavioural regression. Absence is definitive only after closure; unexpected errors and exceeded `max` cardinality fail fast while the flow is still open; undeclared events are additive (reported, never failing). `proposeScenario()` drafts a contract from N recorded runs (record → propose → commit).

  `autotel` gains `TestSpanCollector.peekTrace(traceId, rootSpanId?)` — a non-destructive read of a trace's finished spans, so a scenario checker can poll while an async flow is still emitting. Its `SerializedSpan` output feeds `checkScenario()` directly.

### Patch Changes

- 4f4f074: Fix `flush()` silently exporting nothing on `@opentelemetry/sdk-node` 0.220+.

  `flush()` and flush-on-shutdown force-flushed spans via `sdk.getTracerProvider()`, which returns `undefined` on sdk-node 0.220+ (OpenTelemetry 2.x). The guard treated `undefined` as "nothing to flush", so pending spans were never exported — breaking flush-before-return in serverless and any synchronous read of a span collector right after a traced call. A new `getForceFlushableProvider()` helper falls back to the globally registered provider and unwraps the API's `ProxyTracerProvider` to reach the delegate that actually implements `forceFlush`. Applied to `flush()` and all three auto-flush sites in the functional API.

## 4.2.5

### Patch Changes

- 3d9e31c: Relicense from MIT to Apache-2.0. The `license` field now reads `Apache-2.0`, and the package ships the Apache-2.0 `LICENSE`. This changes the licence only; there are no API changes. Prior releases remain available under their original MIT terms. See `NOTICE` and `TRADEMARKS.md` in the repository root for attribution and the "autotel" trademark policy.

## 4.2.4

### Patch Changes

- 4b7ad78: chore: routine dependency updates

  Refresh runtime and peer dependency ranges across published packages (`ncu`, 3-day release-age cooldown).

  The core `autotel` package moves to the latest OpenTelemetry libraries (stable `2.9.x`, experimental `0.220.x`, semantic-conventions `1.42.x`). This required adapting to a breaking change in `@opentelemetry/sdk-logs`: `BatchLogRecordProcessor` and `SimpleLogRecordProcessor` now take a `{ exporter }` options object instead of a positional exporter argument.

  Notable peer range bumps for consumers: `autotel-aws` (AWS SDK `3.1081`), `autotel-cloudflare` (`@cloudflare/workers-types` v5), `autotel-pact` (`@pact-foundation/pact` v17), `autotel-terminal` (`ai` v7).

## 4.2.3

### Patch Changes

- 830b6a4: docs(test-span-collector): fix stale `@example` for OpenTelemetry SDK v2

  The `TestSpanCollector` JSDoc example used `getAutotelTracerProvider().addSpanProcessor(...)`, which no longer exists on SDK v2 providers, so following it produced a collector that never received spans. The example now shows the working wiring — construct a `NodeTracerProvider` with the processors and register it via `setAutotelTracerProvider()`, then create spans through `getAutotelTracer()` — and points to `createTraceCollector()` (`autotel/testing`) and `InMemorySpanExporter` (`autotel/exporters`) for high- and low-level testing.

## 4.2.2

### Patch Changes

- 0b1e332: Refresh the AI SDK guidance across published skills and docs.
  - document `autotelTelemetry()` as the primary Vercel AI SDK integration
  - document `subscribeAiTelemetry()` as the zero-config fallback
  - move `observeAiSdkResult()` and `autotel-genai/ai-sdk` guidance into the legacy/enrichment path
  - update review skills to stop recommending `experimental_telemetry`

## 4.2.1

### Patch Changes

- 38ae023: Fix browser/edge bundlers failing to build when `autotel` is in the module graph.

  Several modules imported Node builtins with **named** imports (e.g.
  `import { createRequire } from 'node:module'`,
  `import { AsyncLocalStorage } from 'node:async_hooks'`, plus `node:crypto`,
  `node:fs`, `node:url`). When a downstream app bundles for the browser, tools like
  Vite rewrite Node builtins to a stub that exports nothing, and Rollup hard-errors
  on the unresolved named binding ("`createRequire` is not exported by
  `__vite-browser-external`") — breaking the consumer's build even when the code is
  only ever reached on the server.

  These are now namespace imports (`import * as nodeModule from 'node:module'`,
  accessed as `nodeModule.createRequire`), which carry the runtime value without a
  named binding for the bundler to resolve. Where a builtin was used only as a type
  (`AsyncLocalStorage<T>`), a `import type` is used, which is erased at build. Node
  runtime behaviour is unchanged. The built `dist` now contains no named imports of
  Node builtins.

  A lint guard (`no-restricted-syntax` in `eslint.config.mjs`) now bans named value
  imports of `node:` builtins in `src`, so this can't silently regress —
  `import type` and namespace imports remain allowed.

  Also includes incidental, behaviour-preserving lint cleanups in `request-logger.ts`
  (`let` → `const`, redundant `?? {}` spreads removed) surfaced while touching the file.

## 4.2.0

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

## 4.1.0

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

## 4.0.0

### Major Changes

- db0cce2: **BREAKING:** Move all GenAI / LLM instrumentation out of core `autotel` into the
  dedicated **`autotel-genai`** package (published separately), which emits the
  canonical OpenTelemetry GenAI semantic conventions (`gen_ai.*`, semconv v1.42.0).
  Core `autotel` is now generic and AI-free.

  Removed from `autotel`:
  - `traceLLM` / `LLMConfig` (from `autotel` and `autotel/semantic-helpers`).
  - `estimateLLMCost`, `recordLLMCost`, `MODEL_PRICING`, `GEN_AI_COST_ATTRIBUTE`,
    `ModelPricing`, `TokenUsage`, `EstimateCostOptions`.
  - `genAiMetricViews`, `llmHistogramAdvice`, `GEN_AI_DURATION_BUCKETS_SECONDS`,
    `GEN_AI_TOKEN_USAGE_BUCKETS`, `GEN_AI_COST_USD_BUCKETS`.
  - `recordPromptSent`, `recordResponseReceived`, `recordRetry`, `recordToolCall`,
    `recordStreamFirstToken` and their event types.
  - The `genAI` attribute builder, `GenAIAttributes`, and the `GenAIAttrs` type
    (these used a non-spec `gen.ai.*` namespace and are not carried over).

  `traceDB`, `traceHTTP`, and `traceMessaging` remain in core.

  **Migration:** install `autotel-genai` and update imports — attribute names are
  now canonical (`gen_ai.*`, `input_tokens`/`output_tokens`, `gen_ai.provider.name`):

  ```diff
  - import { traceLLM, recordLLMCost, genAiMetricViews } from 'autotel';
  + import { traceGenAI } from 'autotel-genai/trace';
  + import { recordLLMCost } from 'autotel-genai/cost';
  + import { genAiMetricViews } from 'autotel-genai/metrics';
  ```

  Agent identity/delegation/policy/audit helpers (formerly the `autotel-agent`
  package) now live in `autotel-genai/agent`.

  **`autotel-cloudflare`:** the Workers AI binding now emits the canonical
  `gen_ai.provider.name` (`cloudflare-workers-ai`) instead of the deprecated
  `gen_ai.system`.

## 3.7.0

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

## 3.6.0

### Minor Changes

- 47a69ac: New `autotel/validate` export — make input-validation mismatches observable at your boundaries. `defineValidator(name, schema, options)` wraps any Zod-style `safeParse` schema and records every mismatch as a `validation.*` span attribute plus an `autotel.validation.mismatches` counter, with a per-validator `reject` (record then throw a 400-shaped structured error) or `observe` (record then return raw input) mode.

  PII-safe by construction: only field paths, issue codes, and the declared type are recorded — never the offending value or the validator's error message. Not a security feature by default; escalation to the security path is an explicit opt-in via `onValidationMismatch()`, never package-presence-driven. Attribute/metric constants are exported dependency-free from `autotel/validation-attributes`. Fail-open: a recorder bug never breaks the validated boundary.

  `defineEvent` is unchanged (still throws on a bad payload); its schema-hash helper is now shared with the validation layer via an internal `stable-hash` module.

## 3.5.0

### Minor Changes

- 1c43d26: New `autotel/security-schema` export — the dependency-free single source of truth for the security telemetry wire schema: `SecuritySeverity` + rank/parse/compare/escalate helpers, `SECURITY_ATTR` span-attribute keys, `SECURITY_METRICS` metric names, default denied statuses, and the HTTP status attribute fallback order. `autotel-audit`, `autotel-subscribers`, and `autotel-devtools` now consume the schema from here instead of re-declaring it.

### Patch Changes

- 3ab5dc3: chore: update dependencies + migrate workspace to vite 8

  Routine dependency refresh via npm-check-updates (3-day publish cooldown).
  - **Dev tooling:** vitest 4.1.8, `@types/node`, tsx, typescript-eslint 8.60.1, eslint 10.4.1, svelte 5.56, storybook 10.4.2, etc.
  - **Runtime/peer (published packages):** aws-sdk 3.1063, `@tanstack/{react,solid}-start` 1.168.25, hono 4.12.23, `@sentry/node` 10.56, `@cloudflare/workers-types`, react 19.2.7, ai-sdk / ai 6.0.197, `@traceloop/node-server-sdk` 0.27, google-auth-library 10.7, protobufjs 8.6, svelte 5.56.

  **Vite 8:** forced `vite ^8` across the workspace via a pnpm override. autotel was already partly on vite 8 (`@sveltejs/vite-plugin-svelte` 7 and `@vitejs/plugin-react` 6 both require it); storybook (svelte-vite), the astro docs, and the tanstack-start example all build cleanly on vite 8.

  eslint is held at `^9` in `apps/example-nextjs` (a private example) — `eslint-config-next` 16 / `eslint-plugin-react` are not yet eslint-10 compatible. Published packages are unaffected.

## 3.4.2

### Patch Changes

- bb9a1b7: Restructure the DevTools widget UX and add a configurable TanStack instrument() preset.
  - **autotel-devtools**: extract reusable abstractions (`useListKeyboardNav`, `useZoomPan`, `matchesNeedle`, `SearchInput`), decompose the `Panel` and restore its resize UX, unify the drag mechanic and tab bar across surfaces so no view is unreachable, and collapse the pause-buffer into a stream table.
  - **autotel-tanstack**: add a configurable `instrument()` preset; `auto.ts` now delegates to it.
  - **autotel**: export `isInitialized` from the package entry point.

## 3.4.1

### Patch Changes

- ea2cb4a: ### autotel-devtools — CLI port shorthand, busy-port fallback, theme fix
  - **Port as a positional:** `npx autotel-devtools 4319` is shorthand for `--port 4319`; an explicit `--port`/`-p` always wins. Invalid ports exit with code 2.
  - **Busy-port fallback:** if the requested port is in use, the receiver walks forward (up to 20 consecutive ports) and binds the first free one, printing a warning with the actual port. Startup URLs and OTLP hints use the bound port.
  - **Bind-phase crash fix:** swallow WebSocketServer `error` re-emissions from `ws` during `EADDRINUSE` recovery so port-fallback probing no longer crashes the process.
  - **Theme in shadow DOM:** apply `data-theme` on the shadow host (via `getRootNode().host`) instead of `document.querySelector('autotel-devtools')`, so light/dark tokens resolve inside the widget stylesheet.

  ### autotel — lazy `node-require` for edge runtimes

  Defer `createRequire()` until the first `safeRequire()` / `requireModule()` / `nodeRequire()` call so merely importing `node-require` (and re-exports such as `track`) no longer throws in runtimes without a module path (e.g. Cloudflare Workers / workerd). Optional lookups still degrade to `undefined` via `safeRequire()`; `nodeRequire.resolve` (and `resolve.paths`) are forwarded lazily.

## 3.4.0

### Minor Changes

- 20a1186: Add opt-in function I/O capture to `trace()` / `instrument()` via `captureInput` / `captureOutput`.

  When enabled per call, the function arguments and return value are serialized (JSON, truncated at 4096 chars) onto the span as `autotel.input` / `autotel.output`. A single argument is captured directly; multiple arguments are captured as an array. Both default to `false`, so nothing changes unless you opt in. This is the standard convention visualizers (incl. the autotel-devtools Flow view) read to show plain functions with the same input/output detail as AI tool calls.

  ```ts
  const loadPortfolio = trace(
    { name: 'loadPortfolio', captureInput: true, captureOutput: true },
    (ctx) => async (req: { userId: string }) => fetchPortfolio(req.userId),
  );
  ```

  Avoid on arguments containing secrets/PII, or pair with a redacting span processor.

## 3.3.1

### Patch Changes

- 4ce86fc: Refresh package dependencies across the workspace and keep generated lockfile state in sync.

  Add OTLP/protobuf ingestion support to `autotel-devtools` for traces, logs, and metrics. The devtools HTTP receiver now accepts both OTLP/JSON and OTLP/protobuf payloads on the existing `/v1/traces`, `/v1/logs`, and `/v1/metrics` endpoints, decodes protobuf payloads with embedded OTLP schemas, and includes interop coverage using the OpenTelemetry protobuf serializers.

## 3.3.0

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

## 3.2.0

### Minor Changes

- 9fbbc3a: Close the loop from "code declares the event contract" through to "catalog reflects the runtime" — schemas declared at the `track()` call site flow through telemetry into the catalog generator and drift detector with no inference guesswork.

  ### `autotel`
  - **New: `defineEvent(name, schema, options?)`.** Returns a `DefinedEvent` that validates the payload at runtime (via the schema's `safeParse`) and carries the JSON Schema and a stable SHA-256 schema hash through `track()` as part of the `EventTrackingOptions`. Designed for Zod (`{ toJsonSchema: (s) => z.toJSONSchema(s) }`) but accepts any schema with a `safeParse` method. Imported from `autotel`.
  - **New `schema?: EventSchemaMetadata` field** on `EventTrackingOptions`. The `EventQueue` carries it onto the `EventPayload` so any contract-aware subscriber (`ArchitectureSnapshotSubscriber`, custom subscribers) sees the declared schema verbatim. Optional and backwards-compatible — bare `track()` calls continue to work.
  - **PII redaction now only applies to string values.** The default sensitive-key patterns (`/token/i`, `/auth/i`, …) used to overwrite _any_ matching value — including numbers and booleans — with the literal string `"[REDACTED]"`. That broke type stability for fields like `promptTokens` / `completionTokens` (LLM usage counters) and gave nothing in return: secrets in user code are overwhelmingly strings. Numeric and boolean attributes now pass through untouched. Same change applied to `AttributeRedactingProcessor`. Existing tests that asserted booleans got redacted have been updated to reflect the new (correct) behaviour.

  ### `autotel-subscribers`
  - **`ArchitectureSnapshotSubscriber` records `fieldStats` for every observed event.** For each dotted field path it tracks the runtime types it saw (`string`, `number`, `object`, …) and up to 20 primitive sample values, merging across observations. The new `FieldStats` type is added to `EventObservation`. Existing snapshots stay valid — `fieldStats` is optional.
  - **Captures declared schemas from `defineEvent`.** When a `track()` call originated from `defineEvent`, the subscriber stores the declared `{ source: 'zod', jsonSchema, hash }` on the observation as `EventObservation.schema?`. Snapshots that go through bare `track()` are unchanged.
  - **Captures consumer-service attribution.** A new optional `_autotel.consumers: string[]` convention on the event attributes is read into `EventObservation.consumers?`, so the snapshot now describes consumer relationships in addition to producer / channel.

  ### `autotel-eventcatalog`
  - **New `generate` command** — scaffolds services, events, channels, and producer/consumer/channel-routing edges from a snapshot. Skip-if-exists: catalog files that already exist are left completely untouched. When the snapshot's `EventObservation.schema?.jsonSchema` is present (declared at the `track()` call site), it is written verbatim to the event's `schema.json`. Otherwise the schema is inferred from runtime `fieldStats` as a fallback — captured in the operations log as `schemaSource: 'declared' | 'inferred'`. CLI flags: `--snapshot`, `--catalog`, `--dry-run`, `--edges-only`, `--version`, `--summary-output`. Versioned summary envelope (`schemas/generate-summary-v0.1.0.json`) pinned by a contract test.
  - **Type drift and value drift** — `diffCatalogAgainstSnapshot` now consumes `fieldStats` to detect runtime-vs-declared mismatches. Drift detector handles the JSON Schema `integer` vs JS `number` impedance mismatch deliberately: declared `integer` accepts observed `number` at the type level, but sample values are checked against `Number.isInteger` — so a runtime `1.5` against an `integer` declaration still flags. No false positives on integer fields, no swept-under-the-rug genuine signal. New `drift-report-v0.2.0.json` and `drift-summary-v0.2.0.json` schemas pin the richer wire format; v0.1.0 envelopes are still emitted for backwards-compatible consumers.
  - **`SnapshotDiff` interop renderer** — `toSnapshotDiffFromReport(report)` and `toSnapshotDiffFromDelta(delta)` produce EventCatalog's own `SnapshotDiff` shape (with `ResourceChange[]` and `RelationshipChange[]`), so drift findings can flow into upstream catalog tooling that already understands that format. Exposed as the new `eventcatalog-snapshot-diff` renderer.
  - **Catalog state now read via `@eventcatalog/sdk`** instead of a bespoke filesystem walker. `CatalogEvent`, `CatalogService` and `CatalogChannel` extend the SDK's `Event`, `Service` and `Channel` types directly, so any field the SDK adds in future is picked up without changes here. The package gains `@eventcatalog/sdk` as a runtime dependency.
  - **Workaround for an upstream SDK bug** — `addEventToChannel` in `@eventcatalog/sdk@2.21.2` corrupts catalog layout (turns `index.mdx` into a directory) because of a string-vs-regex bug in path splitting. `generate` sets the channel pointer directly on the event's frontmatter when calling `writeEvent`, sidestepping the bad code path. The fix is filed upstream as [event-catalog/eventcatalog#2567](https://github.com/event-catalog/eventcatalog/pull/2567); the workaround can be removed once that ships.

  ### What this means in practice

  The reference app (`apps/example-eventcatalog`) has been migrated to `defineEvent` for all five domain events. Running `pnpm services:snapshot && pnpm catalog:drift` against the resulting catalog now prints `No drift detected. Catalog and runtime agree.` That's the steady-state goal — every additional drift finding from here is genuine signal of code-vs-catalog divergence.

## 3.1.1

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

## 3.1.0

### Minor Changes

- 614d414: Make `trace(name, fn)` dispatch survive minified parameter names.

  `autotel`'s `trace(name, fn)` dispatches between immediate-execution (`(ctx) => result`) and factory-wrap (`(arg) => result`) modes by inspecting the first parameter NAME of `fn` against an allowlist (`ctx`, `traceContext`, etc.). When a consumer's bundler minifies — esbuild's `minify: true`, terser, etc. — `ctx` is renamed to a single letter, the allowlist stops matching, trace falls into factory mode, and the wrapped function is returned instead of awaited.

  For `autotel-aws/lambda`'s `wrapHandler` this caused deployed Lambdas to crash at invocation time with `TypeError: Wrong arguments at _RAPIDClient.postInvocationResponse` — the runtime received a function as the response and couldn't serialize it.

  **New API in `autotel`**: `markAsImmediate(fn)` attaches a symbol to `fn` that pins it to immediate-execution dispatch, bypassing parameter-name introspection. Library authors who wrap user handlers should use it.

  **Fix in `autotel-aws`**: `wrapHandler` and `traceLambda` now wrap their inner trace function with `markAsImmediate(...)`, making them robust to downstream minification.

  No source changes are required for users of `wrapHandler`/`traceLambda` — the fix is internal. Users calling `trace(name, fn)` directly in their own code with a minifier on the call site can apply `markAsImmediate` themselves if needed.

## 3.0.7

### Patch Changes

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

## 3.0.6

### Patch Changes

- 8d5d84d: Clarify edge vs Node entry points and tighten Cloudflare logger packaging.
  - **`autotel-cloudflare`**: Move `autotel-edge` to a required peer dependency (devDependency for this package’s tests) so Workers apps declare the edge foundation explicitly. Import execution-logger helpers from `autotel-edge/logger` instead of the root export. Document a logs-only quickstart via `autotel-cloudflare/logger`, a `nodejs_compat` compatibility matrix per subpath, and cross-links to related packages.
  - **`autotel-edge`**: Re-export `TraceContext` from `autotel-edge/logger` for execution-logger consumers. Add See also links in the README.
  - **`autotel-drizzle`**: Document Drizzle `>= 0.45.2` peer requirement, Node-only scope, and D1-on-Workers guidance via `autotel-cloudflare/bindings`. Add See also links.
  - **`autotel`**: Add an entry-point map (Node vs Cloudflare vs edge) and See also links in the README.

## 3.0.5

### Patch Changes

- 1a8bedd: Updated dependencies

## 3.0.4

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

## 3.0.3

### Patch Changes

- 5e146a7: Streamline package surface and align skills with the [Agent Skills specification](https://agentskills.io/specification).
  - Drop `@tanstack/intent` from runtime and dev dependencies, plus the auto-generated `bin/intent.js` shims. Skills still ship under each package's `skills/` directory and are discovered by spec-compliant agents (Claude Code, Cursor, Cline, etc.) via filesystem scan — no consumer-side CLI required.
  - Remove the `autotel/workers` and `autotel/cloudflare` entry points from `autotel`. Cloudflare Workers users should import directly from `autotel-cloudflare` (and its `/logger`, `/sampling`, `/events` subpaths). `autotel` no longer peer-depends on `autotel-cloudflare` or `autotel-edge`.
  - Strip non-spec frontmatter (`type`, `library`, `library_version`, `sources`, `requires`) from all `SKILL.md` files; keep only spec-defined fields (`name`, `description`, optional `license`).
  - Move user-facing skills (`migrate-to-autotel`, `tune-sampling`, `debug-missing-spans`, `build-audit-trails`) into `packages/autotel/skills/` so consumers receive them automatically via npm. Contributor-only skills (`create-autotel-adapter`, `create-autotel-instrumentation`, `create-autotel-exporter`) remain under the repo-root `skills/` directory.
  - Realign `autotel`'s peer dependency ranges to match published versions on npm.
  - Release workflow now refreshes `pnpm-lock.yaml` after `changeset version` so the next Version Packages PR ships with a consistent lockfile.

## 3.0.2

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
  - autotel-cloudflare@2.18.9
  - autotel-edge@3.16.7

## 3.0.1

### Patch Changes

- 5d05a3e: Add Cloudflare Workers support to main `autotel` package. Introduces `autotel/workers` and `autotel/cloudflare` entry points that re-export the functional API and Cloudflare-specific instrumentation from `autotel-cloudflare`, providing better DX for Cloudflare users while keeping the core package modular. Updates package exports, build config, and documentation.
- Updated dependencies [5d05a3e]
  - autotel-cloudflare@2.18.8
  - autotel-edge@3.16.6

## 3.0.0

### Major Changes

- b1f3704: Align with OpenTelemetry's Span Event API deprecation direction.

  **Breaking (type-level)**
  - `recordException` and `addEvent` are removed from the public `SpanMethods` /
    `TraceContext` type surface. The runtime methods remain bound for the
    deprecation window so existing call sites keep working and span-timeline
    views stay populated, but new code should not depend on them.

  **New**
  - `ctx.recordError(error)` — the ergonomic, ctx-bound replacement for the
    deprecated `ctx.recordException(error)`. Sets ERROR status, structured
    `error.*` attributes (including `why`/`fix`/`link` from
    `createStructuredError`), and during the back-compat window also routes
    through `recordException` so existing span-timeline views stay populated.
    Accepts `unknown` so it can be called directly with the value caught from a
    `catch` block — no `as Error` cast needed.
  - `ctx.track(event, data?)` — the ergonomic, ctx-bound replacement for the
    deprecated `ctx.addEvent(name, attrs)`. Delegates to the standalone `track()`
    function (so events flow through the configured event subscribers and pick
    up trace context automatically). Use this from inside a `trace((ctx) => ...)`
    callback when you have a `ctx` handle in scope; the standalone `track()`
    remains available for code paths without a `ctx`.
  - `recordStructuredError(ctx, error)` no longer requires `recordException` on
    the context — it feature-detects and gracefully degrades to span status only.
  - Internal `emitCorrelatedEvent(ctx, name, attrs)` helper used by autotel's
    workflow, messaging, gen-ai, request logger, and webhook modules. Routes
    through `addEvent` while available; falls back to flat,
    sequence-prefixed attributes (`autotel.event.<n>.<name>.<key>`) so multiple
    events with the same name don't overwrite one another.
  - Hybrid `trace` export: still callable as `trace(fn)` for autotel
    instrumentation, and now also carries the full `@opentelemetry/api`
    `TraceAPI` surface (`trace.getActiveSpan()`, `trace.getTracer()`,
    `trace.setSpan()`, …). Existing OTel code that does
    `import { trace } from 'autotel'` works without modification. The pure
    TraceAPI singleton remains available as `otelTrace`.
  - Broadened native OTel re-exports from `autotel`:
    `Span`, `SpanContext`, `SpanAttributes`, `Tracer`, `TracerProvider`,
    `Context`, `Attributes`, `AttributeValue`, `Link`, `TimeInput`, `HrTime`,
    `Baggage`, `BaggageEntry`, `Exception`, `TraceFlags`, `TraceState`,
    `TextMapSetter`, `TextMapGetter`. Apps and plugins can drop the
    `@opentelemetry/api` direct dependency in most cases.
  - `MIGRATION.md` documents the v3 transition: prefer the request logger and
    `recordStructuredError` for application code; `addEvent` /
    `recordException` are compatibility-only.

  **Migration**

  ```ts
  // Before
  ctx.addEvent('checkout.payment_started', { method, amount });
  ctx.recordException(error);

  // After
  ctx.track('checkout.payment_started', { method, amount });
  ctx.recordError(error); // or recordStructuredError(ctx, error) outside trace()
  ```

  Existing span-event data and backend views remain supported. Internal SDK glue
  that operates on raw OTel `Span` objects (e.g. `span.recordException` inside
  `functional.ts`) is unaffected — the deprecation targets the application-facing
  API surface.

## 2.26.3

### Patch Changes

- docs/skills: align guidance with OTel span-event deprecation direction. New instrumentation should prefer correlated log-based events; span-event APIs are compatibility-first.
- add `MIGRATION.md` for v3 transition guidance from span-event-style emission to log-based correlated events.

- dc4908d: Updated deps

## 2.26.2

### Patch Changes

- abe7674: **autotel-mcp**
  - **LLM cost attribution in USD.** `get_llm_usage`, `get_llm_expensive_traces`, `get_llm_slow_traces`, and `get_llm_model_stats` now compute and return `costUsd` alongside tokens, and `rankExpensiveTraces` sorts by spend rather than token count. Pricing catalog covers current Anthropic (Claude 3/4/4.5/4.6/4.7), OpenAI (GPT-4/4.1/4o, o1/o3), Google Gemini 1.5/2.0/2.5, Mistral, and Llama families; unknown models are tracked as `unpricedRequests` so coverage gaps are visible. Override via `AUTOTEL_LLM_PRICES_JSON=/path/to/prices.json`.
  - **Grafana LLM dashboard as MCP resource.** New `otel://dashboards` index and `otel://dashboards/grafana-llm` payload serve a six-panel Grafana dashboard (request rate, error rate, tokens/sec by type, p50/p95/p99 latency, per-model breakdown) targeting OTel GenAI Prometheus metric names. Agents can hand users the JSON to import directly.
  - **Import convention.** Stripped `.js` extensions from 170 relative imports across `src/` and `test/` to match the no-extension style used by `autotel` core and `autotel-drizzle`. External package subpath imports (e.g. `@modelcontextprotocol/sdk/server/mcp.js`) are unchanged.

  **autotel**
  - **LLM-tuned histogram buckets.** New `GEN_AI_DURATION_BUCKETS_SECONDS` (0.01s–300s, covers reasoning-model tails), `GEN_AI_TOKEN_USAGE_BUCKETS` (1–4M, right-skewed), and `GEN_AI_COST_USD_BUCKETS` (sub-cent–$50) exported from `autotel`. Pass `genAiMetricViews()` to your `MeterProvider` to apply them to the OTel GenAI instrument names (`gen_ai.client.operation.duration`, `gen_ai.client.token.usage`, `gen_ai.client.cost.usd`), or use `llmHistogramAdvice(kind)` for per-instrument advice.
  - **GenAI span event helpers.** New `recordPromptSent`, `recordResponseReceived`, `recordRetry`, `recordToolCall`, and `recordStreamFirstToken` helpers pin event names and attribute keys to the OTel GenAI semantic conventions. Produces timestamped markers (`gen_ai.prompt.sent`, `gen_ai.response.received`, `gen_ai.retry`, `gen_ai.tool.call`, `gen_ai.stream.first_token`) that render as dots on trace timelines in Jaeger / Tempo / Langfuse / Arize.

## 2.26.1

### Patch Changes

- dc471ef: Enhanced request logger with fork support for async background work, execution logger for edge runtimes, structured errors with internal context, init locking for framework plugins, silent/minLevel logging, and attribute redaction for PII compliance.

## 2.26.0

### Minor Changes

- 8003fad: feat: migrate autotel-devtools into monorepo and upgrade to TypeScript 6.0
  - migrate `autotel-devtools` (standalone OTLP receiver + Preact web UI) into the monorepo with tsup server build and Vite IIFE widget build
  - add `devtools` support to `autotel.init()` for local `autotel-devtools` usage, including optional embedded startup and shutdown cleanup
  - improve `autotel-web` browser span export behavior by avoiding exporter recursion, feature-detecting `sendBeacon`, and reading HTTP methods from `Request` objects
  - narrow the `autotel-edge` factory marker fix to source code so downstream bundlers do not misoptimize required initializers
  - upgrade all packages to TypeScript 6.0: add `tsconfig.build.json` with `ignoreDeprecations: "6.0"` for tsup DTS generation, add explicit `"types": ["node"]` where missing, set `rootDir` where needed
  - fix Astro docs content collection config for Starlight loader API change
  - fix Playwright version mismatch between autotel-playwright and example-playwright-e2e
  - add `@tanstack/intent` to autotel runtime dependencies (required by published bin)

## 2.25.5

### Patch Changes

- f4ac1c3: Tanstack span collector

## 2.25.4

### Patch Changes

- 32e088f: Use boxed values in AsyncLocalStorage so `enterOrRun()` can mutate the existing store on runtimes without `enterWith()` (Cloudflare Workers). This keeps baggage and context updates visible within the same traced callback. `startActiveSpan` calls now also explicitly pass the parent context.

## 2.25.3

### Patch Changes

- 3a5b723: Added sampling options

## 2.25.2

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

## 2.25.1

### Patch Changes

- c6010e1: Improve package compatibility and tooling consistency across the monorepo.
  - Add CommonJS build output/exports where missing (including `autotel` entrypoints and backend/MCP package builds) to improve `require()` interoperability.
  - Roll forward shared dependency versions across affected packages/apps to keep examples and libraries aligned on the same toolchain.

## 2.25.0

### Minor Changes

- 04c370a: This release rolls out a monorepo-wide refresh across the Autotel package family with coordinated minor updates.

  Highlights:
  - Align package internals and workspace metadata for the next release wave.
  - Improve reliability of test and quality workflows used across packages.
  - Keep package behavior and public APIs consistent while shipping incremental enhancements across the ecosystem.

## 2.24.1

### Patch Changes

- 3438fe4: Fix snapshot recording mode and keyboard navigation
  - Fix stale closure: add `recording` to useEffect dependency arrays for log and span listeners so snapshot mode actually activates
  - Fix unreachable auto-stop: check record limit before truncating to maxSpans so recording auto-pauses at 200 events
  - Fix keyboard navigation: add arrow-key handling for service-summary and errors views

## 2.24.0

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

## 2.23.1

### Patch Changes

- 65b2fc9: - Bug fixes and dependency updates across packages.
  - example-vitest: API tests use a random port (when `API_BASE_URL`/`PORT` unset) to avoid EADDRINUSE on port 3000.

## 2.23.0

### Minor Changes

- eb28f60: **autotel**
  - **Request logger**: `getRequestLogger(ctx?, options?)` with `set()`, `info()`, `warn()`, `error()`, `getContext()`, and `emitNow(overrides?)`. Optional `onEmit` callback for manual fan-out. Writes to span attributes/events so canonical log lines still emit one wide event per request.
  - **Structured errors**: `createStructuredError()`, `getStructuredErrorAttributes()`, `recordStructuredError()`. Supports `message`, `why`, `fix`, `link`, `code`, `status`, `cause`, `details`.
  - **parseError**: `parseError(error)` returns `{ message, status, why?, fix?, link?, code?, details?, raw }` for frontend/API consumers. Export from main entry and `autotel/parse-error`.
  - **Drain pipeline**: `createDrainPipeline()` for batching, retry with backoff, flush, and shutdown. Use with `canonicalLogLines.drain`. Export from main entry and `autotel/drain-pipeline`.
  - **Canonical log lines**: `shouldEmit`, `drain`, `onDrainError`, `keep` (declarative tail sampling), and `pretty` (tree-formatted dev output) options. Adds `duration` (formatted) field alongside `duration_ms`. Respects `autotel.log.level` span attribute for explicit level. New types `CanonicalLogLineEvent`, `KeepCondition`.
  - **formatDuration**: `formatDuration(ms)` formats milliseconds as human-readable strings (`45ms`, `1.2s`, `1m 5s`).

- f772504: **trace()** now supports a **zero-argument factory pattern**: when you pass a function that takes no parameters and returns another function, `trace()` correctly detects it as a trace factory and instruments the returned function. Use this for patterns like logging context factories, e.g. `trace(() => (i: number) => i + 1)` or `trace('fetchData', () => async (query: string) => ...)`.

## 2.22.0

### Minor Changes

- 1155c72: - **autotel-backends**: Add Grafana backend; export and type updates.
  - **autotel, autotel-\***: Dependency bumps, docs/comment updates, and version alignment across the monorepo.

## 2.21.0

### Minor Changes

- c710c71: Add option to hide free/busy times (or selected attributes) in console export and related exporters.

## 2.20.0

### Minor Changes

- 6b67787: - **autotel**: Export `getTraceContext`, `isTracing`, `enrichWithTraceContext`, and `resolveTraceUrl` from trace-helpers; export `OtelTraceContext` type; add `resolveTraceUrl(template, traceId)` for trace URL templates (supports `OTEL_TRACE_URL_TEMPLATE` env var); add `autotel/test-span-collector` entry point.
  - **autotel-playwright**: New package. Playwright fixture: one OTel span per test, injects W3C trace context into `page` and `requestWithTrace` for requests to your API; `step()` helper for child spans; optional `autotel-playwright/reporter` for runner-side spans.
  - **autotel-vitest**: New package. Vitest fixture: one OTel span per test so instrumented code under test appears as child spans; optional reporter for suite/test spans; re-exports autotel/testing utilities.

## 2.19.0

### Minor Changes

- d1bd8cd: - **autotel-sentry**: README updates : clarify Sentry SDK + OTel scenario, link to Sentry OTLP docs, note that Sentry ingestion request spans are not sent, fix `SentrySpanProcessor` backtick typo, add spec-volatility note.
  - **autotel-backends**: Preserve caught error in Google Cloud config : attach original error as `cause` when throwing the user-facing error so the `preserve-caught-error` lint rule is satisfied.

## 2.18.1

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

## 2.18.0

### Minor Changes

- 23ed022: - **autotel-plugins**: Add BigQuery and Kafka plugins.
  - **BigQuery**: OpenTelemetry instrumentation for `@google-cloud/bigquery` (query, insert, load, copy, extract, job tracking; optional query sanitization and GCP semantic attributes). No official OTel support; optional peer dependency.
  - **Kafka**: Composition layer for use with `@opentelemetry/instrumentation-kafkajs`: processing span wrapper with context mode (inherit/link/none), batch lineage for fan-in trace correlation, and correlation ID policy. Re-exports messaging constants and helpers from `common/constants`.
    Kafka plugin EDA enhancements : add `withProducerSpan` and `injectTraceHeaders` for PRODUCER semantics, processing-span context mode, batch lineage attributes, and correlation ID header support.
  - **autotel**: Version alignment with autotel-plugins.
  - **autotel-terminal**: Terminal trace viewer updates : README and setup docs, internal refactor (lib/), and CHANGELOG.

## 2.17.0

### Minor Changes

- e62eb75: - **autotel-plugins**: Add BigQuery and Kafka plugins.
  - **BigQuery**: OpenTelemetry instrumentation for `@google-cloud/bigquery` (query, insert, load, copy, extract, job tracking; optional query sanitization and GCP semantic attributes). No official OTel support; optional peer dependency.
  - **Kafka**: Composition layer for use with `@opentelemetry/instrumentation-kafkajs`: processing span wrapper with context mode (inherit/link/none), batch lineage for fan-in trace correlation, and correlation ID policy. Re-exports messaging constants and helpers from `common/constants`.
  - **autotel**: Version alignment with autotel-plugins.

## 2.16.0

### Minor Changes

- 8a6769a: x

## 2.15.0

### Minor Changes

- c68a580: - **autotel**: Add correlation ID support for event-driven observability (stable join key across events, logs, and spans via AsyncLocalStorage; optional baggage propagation). Add events configuration for `init()`: `includeTraceContext`, `traceUrl`, and baggage enrichment with allow/deny and transforms. Event queue and event subscriber now attach correlation ID and trace context to events. New `autotel/correlation-id` and `autotel/events-config` types used internally; init accepts `events` option.
  - **autotel-subscribers**: EventSubscriber base class and adapters (PostHog, Mixpanel, Amplitude) updated to use `autotel/event-subscriber` types and AutotelEventContext; graceful shutdown and payload normalization aligned with new event context and correlation ID.
  - **autotel-edge**, **autotel-cloudflare**, **autotel-aws**, **autotel-backends**, **autotel-tanstack**, **autotel-terminal**, **autotel-plugins**, **autotel-cli**, **autotel-mcp**, **autotel-web**: Version bumps for compatibility with autotel core.

## 2.14.2

### Patch Changes

- 78202aa: Add logger instrumentation validation to `autotel doctor` command and update documentation for Winston/Bunyan setup.

  **autotel-cli:**
  - Add logger instrumentation check to `autotel doctor` that validates Winston, Bunyan, and Pino instrumentation packages are installed when configured
  - Parse source code to detect `autoInstrumentations` configuration and warn if instrumentation packages are missing
  - Add `logger-checker` utility to extract and validate logger instrumentation setup

  **autotel:**
  - Update README to clarify that Winston and Bunyan instrumentation packages must be installed separately, even though they're included in `@opentelemetry/auto-instrumentations-node`
  - Fix misleading "auto-detects" claims - all loggers require explicit `autoInstrumentations` configuration
  - Update Pino, Winston, and Bunyan examples to show correct setup with `autoInstrumentations` array

## 2.14.1

### Patch Changes

- acfd0de: Add comprehensive test coverage for Datadog backend configuration, including validation, direct cloud ingestion, agent mode, and OTLP logs export functionality.

## 2.14.0

### Minor Changes

- 47c70fb: Update dependencies across all packages:
  - **OpenTelemetry**: Update to v2.5.0 (core packages) and v0.211.0 (SDK packages)
  - **AWS SDK**: Update all client packages from v3.972.0 to v3.975.0
  - **TypeScript ESLint**: Update from v8.53.1 to v8.54.0
  - **Turbo**: Update from v2.7.5 to v2.7.6
  - **Vitest**: Update from v4.0.17 to v4.0.18
  - **@types/node**: Update from v25.0.9 to v25.0.10
  - **Cloudflare Workers Types**: Update from v4.20260120.0 to v4.20260124.0

## 2.13.0

### Minor Changes

- 8256dac: Add comprehensive awaitly integration example demonstrating workflow instrumentation with autotel OpenTelemetry. The new `awaitly-example` app showcases successful workflows, error handling, decision tracking, cache behavior, and visualization features. Updated prettier to 3.8.1 across all packages.

## 2.12.1

### Patch Changes

- 3e12422: Update dependencies across all packages:
  - OpenTelemetry packages: 0.208.0 → 0.210.0
  - OpenTelemetry SDK packages: 2.2.0 → 2.4.0
  - import-in-the-middle: 2.0.1 → 2.0.4
  - pino: 10.1.0 → 10.1.1
  - TypeScript ESLint: 8.52.0 → 8.53.0
  - vitest: 4.0.16 → 4.0.17
  - @types/node: 25.0.3 → 25.0.8

## 2.12.0

### Minor Changes

- 8831cf8: Add canonical log lines (wide events) feature to automatically emit spans as comprehensive log records. Implements the "canonical log line" pattern: one log line per request with all context, making logs queryable as structured data instead of requiring string search.

  **autotel:**
  - New `canonicalLogLines` option in `init()` config
  - `CanonicalLogLineProcessor` for automatic span-to-log conversion
  - Supports root spans only, custom message format, min level filtering
  - Works with any logger (Pino, Winston) or OTel Logs API
  - Attribute redaction support for sensitive data

## 2.11.0

### Minor Changes

- 92206af: Add canonical log lines (wide events) feature to automatically emit spans as comprehensive log records. Implements the "canonical log line" pattern: one log line per request with all context, making logs queryable as structured data instead of requiring string search.

  **autotel:**
  - New `canonicalLogLines` option in `init()` config
  - `CanonicalLogLineProcessor` for automatic span-to-log conversion
  - Supports root spans only, custom message format, min level filtering
  - Works with any logger (Pino, Winston) or OTel Logs API

  **@jagreehal/example-canonical-logs:**
  - New demo app showcasing canonical log lines vs traditional logging
  - Demonstrates the difference between scattered log lines and one wide event per request

## [Unreleased]

### Added

- **Canonical Log Lines (Wide Events)** - Automatically emit spans as comprehensive log records with all context. Implements the "canonical log line" pattern: one log line per request with all attributes, making logs queryable as structured data instead of requiring string search.
  - New `canonicalLogLines` option in `init()` config
  - `CanonicalLogLineProcessor` for automatic span-to-log conversion
  - Supports root spans only, custom message format, min level filtering
  - Works with any logger (Pino, Winston) or OTel Logs API
  - See [Canonical Log Lines documentation](./README.md#canonical-log-lines-wide-events) and [demo app](../../apps/example-canonical-logs)

## 2.10.0

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

## 2.10.0

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

## 2.9.0

### Minor Changes

- 05f2d95: Add messaging adapters, webhook tracing, and distributed workflow support:
  - **`autotel/messaging/adapters`** - Pre-built adapter configurations for common messaging systems (NATS JetStream, Temporal, Cloudflare Queues) with system-specific attribute extraction and context propagation support. Includes Datadog trace context extractor for cross-platform compatibility.
  - **`autotel/webhook`** - "Parking Lot" pattern for tracing async callbacks and webhooks that return hours or days later. Park trace context when initiating operations and retrieve it when callbacks arrive, maintaining end-to-end trace correlation across long-lived async operations.
  - **`autotel/workflow-distributed`** - Distributed workflow tracing with cross-service correlation using W3C baggage propagation. Track workflows that span multiple microservices by propagating workflow identity (workflowId, stepName, stepIndex) via message headers.
  - **`autotel/messaging-testing`** - Testing utilities and helpers for messaging system integration tests.

## 2.8.0

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

## 2.7.0

### Minor Changes

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

## 2.6.0

### Minor Changes

- 2ae2ece: Add ESM misconfiguration detection and improve documentation
  - Add `isESMMode()` detection to provide context-aware error messages when `@opentelemetry/auto-instrumentations-node` fails to load
  - ESM users now get detailed setup instructions including the correct `autotel/register` pattern
  - Add informational warning when using `integrations` in ESM mode, guiding users to the recommended `getNodeAutoInstrumentations()` pattern
  - Update README.md with modern ESM setup instructions using `autotel/register` (Node 18.19+)
  - Document requirement to install `@opentelemetry/auto-instrumentations-node` as a direct dependency for ESM apps

## 2.5.0

### Minor Changes

- 745ab4c: Add zero-config built-in logger option. Users can now use autotel without providing a logger - a built-in structured JSON logger with automatic trace context injection is used by default. The built-in logger supports dynamic log level control per-request and can be used directly via `createBuiltinLogger()` from 'autotel/logger'. Internal autotel logs are now silent by default to avoid spam.

## 2.4.0

### Minor Changes

- 31edf41: Lazy-load logger + auto instrumentation packages so we only require
  optional peers when a matching logger/integration is configured. Expose
  test hooks for the loader so we can simulate different setups without
  installing every instrumentation locally.

## 2.4.0

### Minor Changes

- 38f0462: Fixed TypeScript type inference for `trace()` function when using the two-argument form (`trace(name, fn)`) or options form (`trace(options, fn)`). Factory functions with no arguments now correctly infer their return types instead of defaulting to `unknown`.

## 2.3.0

### Minor Changes

- bb7c547: Add support for array attributes in trace context

  Extended `setAttribute` and `setAttributes` methods to support array values (string[], number[], boolean[]) in addition to primitive values, aligning with OpenTelemetry's attribute specification. This allows setting attributes like tags, scores, or flags as arrays.

## 2.2.0

### Minor Changes

- 79f49aa: Updated example

## Released

Initial release as `autotel` (renamed from `autotel`).
