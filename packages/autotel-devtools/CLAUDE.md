# autotel-devtools

Standalone OTLP receiver with a Svelte 5-based web UI for local development observability.

## Architecture

Three build outputs:

- **Server** (tsdown): Node.js library + CLI: receives OTLP over HTTP, stores it in sqlite, answers queries, streams to the browser over WebSocket
- **Embedded widget** (`widget.global.js`, Vite IIFE): `<autotel-devtools>` custom element with Shadow DOM isolation. **Reduced view set**: it is a guest in someone else's product page, so every kilobyte is one their users download
- **Full-page viewer** (`fullpage.global.js`, same config with `FULLPAGE=1`): every view, with a looser budget than the embedded bundle

Both browser bundles come from **one entry and one component library**; the only intended difference is which view registry is bundled (`src/widget/views/registry.ts` vs `registry.lean.ts`, swapped by a resolver plugin in `vite.widget.config.ts`). `TAB_DEFS` is filtered against the registry, so a build cannot offer a tab whose view it did not bundle. `GET /widget.js?mode=fullpage` serves the full bundle; a bare `/widget.js`, what an embedder's script tag requests, serves the reduced one.

## Quick Commands

```bash
pnpm build              # Build server (tsup) + widget (Vite IIFE)
pnpm test               # Run all tests
pnpm lint               # Lint source
pnpm type-check         # TypeScript check
pnpm storybook          # Launch Storybook for widget components
pnpm test:dist          # Built ESM smoke test + widget raw/gzip budgets
```

## Package Exports

- `.`: `createDevtools()` factory, `DevtoolsServer`, `DevtoolsSpanExporter`, `DevtoolsLogExporter`, `DevtoolsRemoteExporter`, `ErrorAggregator`, types
- `./server`: `DevtoolsServer`, exporters, OTLP parsing (`parseOtlpTraces`, `parseOtlpLogs`), HTTP routes (`attachDevtoolsRoutes`, `createDevtoolsHttpServer`), telemetry limits (`resolveTelemetryLimits`, `appendWithLimit`), `DevtoolsStore`
- `./exporter`: `DevtoolsSpanExporter` (standalone)

## Key Files

- `src/index.ts`: Main entry, `createDevtools()` factory
- `src/cli.ts`: CLI binary (`npx autotel-devtools`); includes the `claude` subcommand that starts the receiver and launches Claude Code wired to it
- `src/server/`: WebSocket server, HTTP routes, OTLP parsing, exporters (`exporter.ts`, `log-exporter.ts`, `remote-exporter.ts`), error aggregation, telemetry limits, resource utils
- `src/widget/`: Svelte 5 UI components, runes-backed signal store, WebSocket client, custom element

## Query language + store

- **`src/query/`** is plain TypeScript shared by both halves: `tokenize.ts` → `parse.ts` (recursive descent) → `compile.ts` (AST → SQL WHERE fragment + bound params). One parser serves both halves: the server compiles with it and the widget lints with it, so you see a syntax error on the keystroke rather than after a round trip.
- **The attribute equality index does not pay for itself, measured.** `compile.ts` routes an attribute `=` through an `EXISTS` over `attribute_occurrences`. Measured on 50,000 spans through `queryTraces`, that is _slower_ than the plain `json_extract` scan it replaced: 22.71ms vs 15.98ms on a 100-row match, 52.11ms vs 35.26ms on a 1-row match. The plan explains it: both formulations still scan spans, and the correlated `EXISTS` adds an index probe per span row. Driving from the index instead (`entity_id IN (SELECT ...)`) recovers about 18%, which is inside noise. Do not extend this path to `IN`, presence or prefix expecting a win, and treat removing it as a live option.
- **Injection boundary** (`compile.ts`): every value from query text becomes a `?` parameter, and every identifier comes from a caller-supplied `SignalSchema`. An unknown field becomes a bound parameter to `json_extract` rather than an interpolated column, so arbitrary attribute keys are queryable without being trusted. The tests in `src/query/__tests__/compile.test.ts` keep that true.
- **`src/server/store/store.ts`** is `DevtoolsStore` over **`node:sqlite`** (stdlib on Node 24, which the repo already requires, so no dependency). `traces` holds one row per trace, `spans` holds detail with each span's own service denormalised so span-level filters need no join. A span's identity is `(trace_id, span_id)`, never `span_id` alone. Keyset pagination, WAL, count caps, and a logical byte cap (512 MiB memory / 2 GiB disk defaults).
- **Both OTLP transports share `DevtoolsServer.ingestOtlp`.** HTTP (`:4318`) and gRPC (`:4317`) must never grow separate parsing or agent-folding behaviour. The programmatic embed stays HTTP/WS-only unless the caller starts `startOtlpGrpcReceiver`; embedding must not claim an extra port.
- SQLite parses `REGEXP` but ships no implementation; the store registers one. An invalid pattern matches nothing rather than throwing, because the user is mid-typing.
- `DevtoolsServer` writes every merged trace to the store **and** keeps the in-memory live tail. Neither is derived from the other: the tail is what a fresh client is handed and what streams over WS; the store is what queries and restarts read.
- **The store carries a schema version** (`PRAGMA user_version`, `SCHEMA_VERSION` in `store.ts`). A `--db` file stamped by a build this one cannot read is refused at open, naming the path, rather than surfacing later as an opaque "no such column" from whichever query ran first. Version `0` means a file written before the guard, which is adopted and stamped, because the migrations above it already cover every shape such a file can be in.
- **Span events and links are indexed in `span_events` / `span_links`**, so `event.name = cache.miss` and `link.trace_id = upstream` are queryable. The JSON on the span row stays as the payload the waterfall renders; these tables are the query index over it, the same split `attribute_occurrences` makes against the attributes blob. They are written and cleared with their span, swept by `removeOrphanedAttributes`, and backfilled on open for a file written before they existed.
- **`SPAN_ROW_JOIN` hardcodes the `s` alias** that `queryTraces` gives the spans table, the way `attributeIndex.entitySql` already depends on it. Unqualified column names cannot work here: `span_events` has a `trace_id` too, so SQLite would resolve the inner scope and the join would compare a row to itself. The event and link tests fail if the alias moves.
- **The read surface is compressed, and that is why the payload shape is not.** `sendJson` gzips any response over 1 KiB when the client accepts it (negotiated off `res.req`, so no call site threads a request), and the WebSocket server sets `perMessageDeflate`, which `ws` leaves off by default. Measured through `POST /api/query/traces`: a 4,891-span trace goes 1,861 KiB to 47 KiB, 40x. Reshaping the payload the way otel-desktop-viewer does was measured against this and rejected: deduping scopes is 6% _worse_ once deflate runs, dropping the repeated trace id buys 2%, and a start-time offset buys nothing, against a decode step on every consumer and a baseline hazard for spans that merge in later batches. Only dropping `endTime` still wins after compression, at 32%, which is what `src/wire/` does.
- **The server answers in full and streams compact.** Every HTTP response carries a complete `TraceData`, so anything a person can `curl` needs no codec and no consumer has to learn which fields might be missing. The WebSocket stream is the single exception, because it is continuous, high-volume, and read by a widget shipped from the same binary. Do not encode an HTTP response to save bytes: gzip already covers that, and a second shape on the public surface costs every reader more than it saves.
- **`src/wire/` is the only place that knows the compact shape**, and it is exported at `autotel-devtools/wire` so someone writing their own `/ws` client is one `decodeTraces` call from the shape every other surface hands back. `websocket.ts` is the only caller in this package.
- **`endTime` is dropped conditionally, not assumed.** Ingest always sets `duration` to `endTime - startTime`, so in practice every span sheds the field, but an embedder calling `ingestTraces` directly is bound by no such invariant and a wrong `endTime` draws a waterfall bar of the wrong width rather than failing. The encoder keeps any `endTime` its `duration` cannot reproduce.
- `POST /api/query/traces` sits behind the same origin guard as the other read-back routes. A parse failure is a **400 with positioned errors**, never a 500.

## Time window and live tail

- **`src/widget/timeWindow.ts`**: one window for every tab. Presets are stored as _intents_ (`{type:'preset',preset:'15m'}`) so they keep tracking now; custom ranges store their bounds. **"All" means nobody chose a window**: a view may fit its own data then, and must not crop any other window, because an empty 15-minute window is the answer rather than a rendering problem.
- **`src/widget/liveTail.ts`**: freezing is a _consequence_ of what you did (typed / scrolled / selected / bounded the window), so there is no toggle to manage. The store tracks each reason on its own, so clearing a selection while a query is active does not resume the stream. `resumed` clears every reason.
- **`src/widget/signalQuery.svelte.ts`** ties these together. Three behaviours are load-bearing: a superseded response never lands (sequence number + abort), an error never blanks the list (last good page stays, problem shown alongside), and the server origin is resolved when each request starts because an embedded child may be constructed before its parent publishes the WebSocket URL.
- Query bars complete built-in fields and attribute keys discovered through `GET /api/query/{traces|logs}/fields`. `attribute_values` supports value-first discovery, while `attribute_occurrences` is the indexed equality path. Completion and discovery are optional: a failure must never stop a query from running.

## UI primitives (bits-ui)

- **bits-ui v2** backs the overlay primitives (popover, dialog, combobox, tooltip). Our OKLCH tokens and Tailwind classes are unchanged: bits-ui supplies focus management, keyboard nav and aria wiring, and no styling.
- **Shadow-DOM portals**: bits-ui defaults its portal target to `document.body`, which in the embedded widget is the _host page_, outside our shadow root and outside our CSS. `Widget.svelte` wraps the tree in `<BitsConfig defaultPortalTo={...}>` pointed at a container from `components/ui/portal.ts`. `src/widget/__tests__/shadowPortal.test.ts` pins this; a `ShadowRoot` is a `DocumentFragment`, not an `Element`, so the target must be a div _inside_ it.
- bits-ui triggers open on the pointer sequence, so a bare `.click()` in a test leaves them closed. Dispatch pointerdown/mousedown/pointerup/mouseup, and `await tick()` after mount so effects have attached the handlers.

## Metrics

- **Two parsers, on purpose.** `parseOtlpMetrics` (in `otlp.ts`) flattens a histogram to its `count` for the Agents tab's counter-shaped session model; `parseOtlpMetricStreams` (in `metric-streams.ts`) keeps buckets, bounds, sum/min/max, quantiles and **exemplars** for charts. Both read the same POST. Do not collapse them: widening the first would ripple through `autotel-agents`, a browser-safe package that owns its own model.
- **Series identity** is a content hash over `(name, kind, unit, full resource, scope, point attributes)` with keys **sorted**. Service name alone is not resource identity: two hosts or pods emitting the same point at the same timestamp must remain separate lines. Too coarse an identity collapses every line into one meaningless average; both failure modes are silent.
- **Metric retention is per series**, never global: a global cap lets one chatty instrument evict every other series, blanking the quiet chart someone was watching.
- The server reduces metric queries to the requested chart budget. Gauges and sums use first/min/max/last sampling; distribution points merge compatible buckets and cap exemplars. Do not move this budget back into the browser.
- **`widget/charts/aggregate.ts`** holds the arithmetic that is easy to get wrong without noticing, so it stays testable away from the components: it differences cumulative counters into **per-second** rates rather than per-interval deltas, reads a **counter reset as an increment from zero** rather than a negative spike, keeps explicit and exponential histograms in their native buckets, **interpolates quantiles within** their bucket rather than snapping to a bound, and keeps each downsample bucket's **extremes** rather than its mean so a spike survives. `TimeSeriesChart` draws the values it receives; the parent owns transforms so rate cannot be applied twice or forced on when its toggle is off.
- **Exemplars are the payoff**: they link a point on a chart to the trace that produced it, and `MetricsView` deep-links them into the Traces tab.
- We **removed** `MetricData` (`event | funnel | outcome | value`): nothing produced it, so the tab could never render anything. Do not reintroduce a second metric model.

## Coding-agent observability (Agents tab)

- Claude Code / opencode emit OTel **metrics + log events** (no traces). `src/server/otlp.ts` `parseOtlpMetrics` (data points, Sum/Gauge/Histogram) and `parseOtlpAgentEvents` decode them; `src/server/otlp-proto.ts` METRICS_PROTO decodes data points too, for protobuf parity.
- The server folds them into an `AgentSessionStore` via the **`autotel-agents`** package (workspace dep) and broadcasts `agents` over WS (full-state, like `errors`). The widget renders them in `AgentsView.svelte` (`src/widget/components/`); store signals live in `store.svelte.ts` (`agentSessionsSignal`, `selectedAgentSession…`, `agentAggregateSignal`).
- `autotel-agents` is browser-safe (no `node:*`); all session reduction logic lives there, not in the widget. Add a new agent (e.g. Codex) by adding one adapter in that package: no devtools change.
- Test data: `src/widget/components/__fixtures__/agents.ts` builds realistic sessions through the real reducers (used by `AgentsView.stories.ts` + `__tests__/AgentsView.test.ts`).

## WebMCP tab

- `autotel-webmcp` emits `webmcp.install` / `.tool.register` / `.tool.execute` / `.tool.withdraw`. `src/server/webmcp-aggregator.ts` folds them into a tool surface; `POST /api/query/webmcp` serves it; `WebMcpView.svelte` renders it. Types live in `widget/types.ts`, so widget code never imports from `src/server`.
- **The fold drains every page** (the `queryErrors` pattern). A partial fold does not fail, it under-reports — "2 tools dropped annotations" when the answer is 6 — and gets more wrong the more traffic there is.
- **Lifecycle state is chronological and predates the activity window.** Store pages arrive newest-first, so the fold sorts spans before reducing them. A bounded query reads lifecycle history through the window end, then counts executions only inside the requested window; otherwise a long-lived tool becomes "not observed" as soon as its registration ages out.
- **"Currently offered" is scoped to the latest `webmcp.installation.id`.** A reload withdraws nothing, so without that scope the previous page load's tools read as still available. A tool seen only in executions is `observedAtRegistration: false` and makes no claim about annotations or schema.
- **Full-page only.** It carries no chart code and was still 146.4 kB gzip against the embedded bundle's 145 kB. Revisit when something else gets cheaper, not by raising the budget.
- Captured payloads are masked behind a reveal toggle and scrubbed by the shared `redact()` in `widget/utils.ts` — the same one `AgentsView` uses. Opting into capture is not opting into display.

## Derived views and the working set

- **Nothing derived reads `tracesSignal` directly.** Service Map, Flow, Security, Resources, GenAI and Errors fold over `windowedTracesSignal` / `windowedErrorGroupsSignal`, which prefer the **store-backed working set** (`workingSet.svelte.ts`) and fall back to the live tail only when the server is unreachable. Reading the raw signal reintroduces the bug this replaced: a view describing the last hundred traces while the toolbar names an hour.
- **An empty store answer is an answer.** Falling back to the tail on empty would show traces from outside the window that was asked for. The fallback is keyed on `workingSetStatusSignal`, not on emptiness.
- **The working set drops superseded responses** (sequence number + abort). The window can change faster than a fetch completes, and a stale answer draws a map of the wrong period.
- **The server re-aggregates errors**, and the browser never recomputes them: `POST /api/query/errors` runs a fresh `ErrorAggregator` over every stored trace page, so grouping and fingerprinting follow the same rules the live WS path uses. Working-set aggregation follows every cursor too; never replace this with a large fixed limit, which is still silent truncation.

## Metrics charts

- Three modes, and which are offered depends on the instrument: time series always; **heatmap** and **percentiles** only for histograms, which are the only ones with buckets. Meaningless controls are **hidden rather than disabled**: a gauge gets no rate (a level has none) and no stack (stacked levels sum to a number nobody measured). A disabled button makes the reader work out why.
- **Stacking aligns on the union of timestamps**, never by array position: two series sampled at different moments would otherwise pin one's value to the other's moment, drawing a chart that looks right and is wrong.
- **Heatmap intensity normalises against the busiest cell**, or one spike flattens everything else to the same shade; a non-empty cell keeps a floor on opacity so a count of 1 beside 9,000 is still visible.
- **A quantile point with no observations is skipped** rather than plotted as zero: a zero p99 reads as "everything was instant".

## Cross-cutting invariants

- **A deep link carries the window, not just the id.** `traceDeepLink` in `store.ts` serializes the trace's own bounds plus a minute of air, using the widget's `serializeWindow`, and the store test parses the result back with the widget's `parseNavHash` so the two ends cannot drift into agreeing on nothing. Without the window a link an agent hands a human opens on the viewer's default range, which has rolled past the trace, and reports "no traces" for telemetry that is still there. Each entry in `slowestSpans` carries its own link, because landing on the span under discussion beats landing on the trace containing it.
- **Navigating pushes history, adjusting replaces it.** `historyModeFor` in `url-sync.ts` decides: a change of tab, trace or span is somewhere you can want to come back from, while a window, sort or query-bar keystroke refines where you already are. Pushing the latter would bury the previous page under one entry per character. A fragment-only Back fires `hashchange`, which the existing listener already turns back into state, so no `popstate` handler is needed.
- **Every clock routes through `timeFormat.ts`**, so one setting moves all of them, and `Intl` does the zone arithmetic (DST, half-hour offsets, changed rules) rather than any hand-rolled offset. The preference persists per viewer rather than riding in the URL: a shared link should open on the sender's _window_, which is what they are pointing at, but a reader in another region wants their own clock or UTC.
- **The time window is global.** `timeWindowSignal` in the store, read by every controller and every derived view. A view that ignores it is worse than no window at all: the control says the range is narrowed and the screen disagrees. Derived views read `windowedTracesSignal` / `windowedErrorGroupsSignal`, never the raw signals. Error groups are matched by **overlap** (`lastSeen >= start && firstSeen <= end`), because a group spans a range and testing `firstSeen` alone hides an error that began before the window and is still happening.
- **The WebSocket answers on both loopback listeners.** A loopback bind creates two listeners, one per IP family, because `localhost` resolves to `::1` on macOS and `127.0.0.1` elsewhere. `DevtoolsServer` therefore builds its `WebSocketServer` with `noServer` and owns the `upgrade` event, so `attachWebSocket` can point a second listener at the _same_ server: one client set, one broadcast. Two `WebSocketServer`s would give a client that only ever hears from one of them. **A caller of `listenLoopbackDualStack` must attach the WebSocket as well as the routes** — attaching only routes is what produced the original bug, where telemetry arrived over HTTP and the live tail silently never connected.
- **Retention runs on a timer** (30s, `unref`'d, cleared on close). We exposed it and left it uncalled for a while, and the symptom, unbounded growth, shows up only after hours.
- **The live tail and the store are both written on ingest**, and neither derives from the other: the tail is what a fresh client is handed and what streams over WS, the store is what queries and restarts read.
- Every UI component has a paired `*.stories.ts` (catalogue, no assertions) and `*.test.ts` (behaviour). A story that stubs a global must restore it. Use Storybook's `beforeEach`, which takes a teardown; a decorator that replaces `globalThis.fetch` and walks away leaks into every later story.
- `scripts/check-widget-size.mjs` enforces the browser bundle budgets: embedded ≤ 500,000 raw / 145,000 gzip; full-page ≤ 700,000 raw / 210,000 gzip. Raise them only when you have weighed the size against what it buys, never as routine build maintenance.

## Comparison, coverage and reproduction

- **`POST /api/analysis/compare` borrows the ranking from `autotel/analysis`**, loaded on demand. `autotel` is a _peer_ dependency, so a viewer pointed at a plain OpenTelemetry SDK may not have it: a top-level import would turn a missing feature into a server that will not start, which is why the import is inside the handler and its absence is a 501 with an install hint.
- **Both sides of a comparison are populations, not pages.** `cohortRows` scans up to 20,000 spans a side, far past a list page, because the fractions are only as honest as the sample. It throws on an unparseable query rather than returning an empty cohort, since an empty cohort surfaces as "no difference found", which is a different and much more misleading answer than "your query is wrong". The client keeps `empty` distinct from `ok` with no differences for the same reason.
- **`GET /api/coverage` answers the one question a telemetry backend cannot.** `autotel map` reads the source and records every entry point; the store knows what emitted. The join is the feature. A missing `autotel.map.json` is a **404 with instructions**, never an empty report: zero routes and zero _unseen_ routes are indistinguishable in a count, and "0 of 0" would tell someone their app is covered when nothing has ever scanned it.
- **The coverage join is deliberately conservative.** A route counts as seen only on evidence naming it, and a name match is method-specific so `GET /orders` cannot vouch for `POST /orders`. A false "seen" stops someone looking at a handler that is genuinely silent, which is worse than admitting uncertainty.
- **`curlFromSpan` is a starting point, not a replay, and the UI says so.** A span carries method and URL reliably, headers only where captured, and a body never — nor should it. Both attribute vocabularies are read, since semconv renamed these at 1.0 and plenty of running services still emit the old names.
- **Contract violations are read, never computed.** A `TelemetryContract` is a TypeScript module in the service's own repo, so the app is the only thing that can validate against it; a viewer reading exported spans has no contract and never will. `autotel-schema`'s processor validates and stamps `autotel.schema.violations` / `.severity` / `.codes` onto the span (opt in with `stampViolations`), and `utils/schemaViolations.ts` reads those three attributes. **Devtools takes no dependency on `autotel-schema` and must not grow one** — the split is what makes the violation visible wherever the span lands, not only here.
- **Compare and Coverage are full-page only.** They are exploratory views, and the embedded widget is a guest in someone else's page.

## Boundaries

- **Widget uses Svelte 5** (runes). Reactive state goes through a signal shim over runes (`src/widget/signals.svelte.ts`) that preserves a `.value` API, consumed by `store.svelte.ts`. Components are Tailwind-utility-only: **no `<style>` blocks** (they wouldn't reach the shadow root)
- **Widget CSS**: Tailwind CSS inlined into IIFE bundle via PostCSS
- **Shadow DOM**: Widget CSS is isolated, does not leak into host page
- **Server build**: tsup (ESM + CJS). **Widget build**: Vite IIFE (separate config)
- Do not add Node.js APIs to widget code (it runs in the browser)
- Works with both autotel and standard OpenTelemetry: any OTLP-compatible exporter can send data to it
- OTLP receivers accept **both JSON and protobuf** bodies, dispatched on `Content-Type` (`application/x-protobuf` → decoded in `src/server/otlp-proto.ts` via embedded proto definitions; otherwise OTLP/JSON). The two paths must preserve the same metric arms and fields, including exemplars, summary quantiles, and explicit/exponential histogram buckets.
