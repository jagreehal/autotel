# autotel-devtools

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
