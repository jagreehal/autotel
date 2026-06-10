# autotel

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
