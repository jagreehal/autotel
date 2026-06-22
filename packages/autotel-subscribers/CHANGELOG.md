# autotel-subscribers

## 41.0.2

### Patch Changes

- Updated dependencies [0b1e332]
  - autotel@4.2.2

## 41.0.1

### Patch Changes

- Updated dependencies [38ae023]
  - autotel@4.2.1

## 41.0.0

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

- Updated dependencies [ec47ec8]
  - autotel@4.2.0

## 40.0.0

### Patch Changes

- Updated dependencies [12c6b6d]
  - autotel@4.1.0

## 39.0.0

### Patch Changes

- Updated dependencies [db0cce2]
  - autotel@4.0.0

## 38.0.0

### Patch Changes

- Updated dependencies [140fc76]
  - autotel@3.7.0

## 37.0.0

### Patch Changes

- Updated dependencies [47a69ac]
  - autotel@3.6.0

## 36.0.0

### Minor Changes

- 1c43d26: Security alerting and triage tooling.

  **autotel-subscribers**: new `SecuritySubscriber` (`autotel-subscribers/security`) — forwards `security.*` events from the Events pipeline to a webhook/SIEM or custom handler, gated by `minSeverity`, with normalized `SecurityAlert` payloads carrying severity/category/outcome/reason and trace correlation. Webhook delivery uses the same hardened pipeline as `WebhookSubscriber` (timeout-bounded requests, classified errors, exponential-backoff retries via `maxRetries`/`timeoutMs`/`retryDelayMs`).

  **autotel-cli**: new `autotel security` command group. `security summary` aggregates security events (by severity/category/outcome, top events), suspicious-request signals, and denied responses (401/403/429, top clients) over a time window; `security events` lists spans carrying the `security.*` schema with `--category`/`--severity` filters. Both emit the standard `{ ok, command, data }` JSON envelope on any supported backend.

### Patch Changes

- Updated dependencies [1c43d26]
- Updated dependencies [3ab5dc3]
  - autotel@3.5.0

## 35.0.2

### Patch Changes

- Updated dependencies [bb9a1b7]
  - autotel@3.4.2

## 35.0.1

### Patch Changes

- Updated dependencies [ea2cb4a]
  - autotel@3.4.1

## 35.0.0

### Patch Changes

- Updated dependencies [20a1186]
  - autotel@3.4.0

## 34.1.1

### Patch Changes

- 4ce86fc: Refresh package dependencies across the workspace and keep generated lockfile state in sync.

  Add OTLP/protobuf ingestion support to `autotel-devtools` for traces, logs, and metrics. The devtools HTTP receiver now accepts both OTLP/JSON and OTLP/protobuf payloads on the existing `/v1/traces`, `/v1/logs`, and `/v1/metrics` endpoints, decodes protobuf payloads with embedded OTLP schemas, and includes interop coverage using the OpenTelemetry protobuf serializers.

- Updated dependencies [4ce86fc]
  - autotel@3.3.1

## 34.1.0

### Minor Changes

- fb6cba7: ### autotel-pact

  First public release. Runtime evidence for Pact contracts: a green Pact suite proves compatibility; this package proves relevance by recording which contracted interactions were actually exercised, by whom, and how recently. Four independent evidence sources feed a single audit matrix.

  **Consumer side**
  - `withPactInteraction(pact, handler, opts)` wraps `MessageConsumerPact.verify()`. It opens an autotel span with `pact.*` attributes, runs the underlying verification, and appends a `source: test, role: consumer` ledger entry.
  - `withHttpPactInteraction(pact, interaction, testFn)` mirrors the same shape on `PactV3.executeTest()`.
  - `autotel-pact/auto-wrap` is a vitest/jest setup entry that monkey-patches `MessageConsumerPact.prototype.verify` and `PactV3.prototype.executeTest`. Adopting is a single config-file line. The patch is idempotent and a no-op when Pact-JS is not installed.
  - Pass `interactionId: 'order.created.v1'` to keep audit rows stable across `expectsToReceive` renames. The audit matches on `interactionId` first and description as fallback.

  **Provider side**
  - `withProviderVerification(verifierOpts, wrapOpts)` runs the Pact Verifier inside an autotel span. On success it fans out one ledger row per interaction in the pact file with `role: 'provider'`. On failure it emits a single `provider_verification_run` record, because the failure cannot be attributed to one interaction.
  - `skipVerifier: true` skips loading and calling the Verifier and emits the success-path rows from the pact file alone. For demos, smoke tests, and audit-pipeline exercises; not for production CI.

  **Production observation**
  - `PactLedgerSpanProcessor` plus `tagPactInteraction({...})` lets you record `source: production` evidence from any span whose handler is part of a contracted interaction. Outcome is derived from `span.status.code` (OTel `ERROR` becomes `failed`).
  - Bounded queue with drop-oldest-on-full eviction so newest evidence survives sustained pressure. Throttled warning on each drop wave. Fail-open writes: a ledger I/O error reports via `onWriteError` and never breaks the app.
  - `appendLedgerEntryAsync` applies producer-side backpressure. Callers await drainage past 4096 pending writes so memory cannot grow unbounded.

  **Pact Broker enrichment**
  - The audit CLI reads the latest Pact Broker verification per consumer/provider pair when `--broker-url` (or `PACT_BROKER_BASE_URL`) is set. Supports bearer token and basic auth.
  - The audit row distinguishes "broker said no" from "broker unreachable or errored" via the `broker_error` field. `--gate=broker` exits non-zero on either condition, so a transient broker outage cannot silently pass CI.
  - Broker verification is at pact-pair granularity, not per-interaction. The package documents this limitation in every surface that shows the column.

  **Audit CLI**
  - `autotel-pact audit` prints a nine-column table: STATUS, CONTRACTED, TEST_SEEN, PROD_SEEN, PROVIDER_VERIFIED, BROKER_VERIFIED, CONSUMER → PROVIDER, KIND, INTERACTION. Status is OK (contracted and seen in test), STALE (contracted, not seen in test), or SHADOW (seen anywhere with no contract).
  - Gates: `--gate` (default) fails on STALE rows; `--gate=strict` also fails on SHADOW rows; `--gate=broker` fails when any contracted row lacks broker proof or the broker was unreachable.
  - `--json` emits the v0.2.0 audit matrix; counts use names that match the v0.2 semantics: `contracted_and_test_seen`, `contracted_not_test_seen`, `test_or_prod_seen_not_contracted`.

  **Schemas**
  - `autotel-pact-ledger-entry/v0.2.0` and `autotel-pact-audit-matrix/v0.2.0`, published as JSON Schema under `schemas/`. Every persisted artifact carries a `spec` envelope so downstream tooling can refuse unknown majors.

  **Coverage**
  - 91 unit tests across 13 files. End-to-end demo in `apps/example-contract-testing` exercises every evidence path (TEST_SEEN, STALE, SHADOW, PROVIDER_VERIFIED, PROD_SEEN) and asserts the resulting matrix programmatically.

  ### autotel-eventcatalog

  `stamp` and `generate` commands now accept `--format json` for machine-readable stdout output, matching what `drift` already does. Default remains `text`.

  Other improvements:
  - `loadSnapshot` produces actionable error messages (`Snapshot not found`, `Snapshot is empty`, `Snapshot is not valid JSON`, …) instead of raw `ENOENT` / `SyntaxError`.
  - The undocumented `--version` flag for `generate` is now shown in `--help`.
  - The `schemas/README.md` documents why `v0.1.0` schemas are preserved alongside `v0.2.0`.
  - Removed an unsafe inline type cast in `diff.ts` (`fieldStats` is already correctly typed on `EventObservation`).

  ### autotel-subscribers

  `ArchitectureSnapshotSubscriber.toSnapshot()` and `.writeToFile()` now accept an optional `freezeTimestamps: string` option. When supplied, every timestamp in the output (`generatedAt`, plus each event's `firstSeen` / `lastSeen`) is replaced with that value — useful when writing a snapshot intended to be committed to a repository as a stable artifact.

  Production code that captures real observation timestamps should not pass this option; it exists for snapshot-as-documentation workflows where byte-stability matters more than wall-clock accuracy.

  The legacy `toSnapshot(now)` form (passing a bare clock function) continues to work for backward compatibility.

## 34.0.0

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

## 33.0.0

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

### Patch Changes

- Updated dependencies [9fbbc3a]
  - autotel@3.2.0

## 32.1.0

### Minor Changes

- de31d28: Add `ArchitectureSnapshotSubscriber` — captures `track()` events into a
  deterministic JSON snapshot describing what events your code emits, the
  field paths inside their payloads, and (via the `_autotel.channel` /
  `_autotel.producer` attribute convention) which service and channel each
  event belongs to. The snapshot is the input to the forthcoming
  `autotel-eventcatalog` generator and is designed to be committed alongside
  your code so the catalog and the runtime can be diffed in PR review.

  ```typescript
  import { init } from 'autotel';
  import { ArchitectureSnapshotSubscriber } from 'autotel-subscribers/architecture-snapshot';

  const snapshot = new ArchitectureSnapshotSubscriber({ service: 'orders' });
  init({ service: 'orders', subscribers: [snapshot] });
  // ... exercise the system ...
  await snapshot.writeToFile('./.autotel/snapshot.json');
  ```

  The snapshot format is versioned (`autotel-architecture/v0.1.0`) and
  deliberately small — existence + field-path drift only in v0. Type and value
  drift are deferred to a later release.

## 32.0.1

### Patch Changes

- Updated dependencies [3966db0]
  - autotel@3.1.1

## 32.0.0

### Patch Changes

- Updated dependencies [614d414]
  - autotel@3.1.0

## 31.1.3

### Patch Changes

- Updated dependencies [ee60622]
  - autotel@3.0.7

## 31.1.2

### Patch Changes

- Updated dependencies [8d5d84d]
  - autotel@3.0.6

## 31.1.1

### Patch Changes

- 1a8bedd: Updated dependencies
- Updated dependencies [1a8bedd]
  - autotel@3.0.5

## 31.1.0

### Minor Changes

- 72dd565: Add comprehensive middleware system and composition strategies for event subscribers
  - New middleware system with 15+ composable factories: `retryMiddleware`, `rateLimitMiddleware`, `circuitBreakerMiddleware`, `batchingMiddleware`, `enrichmentMiddleware`, `filterMiddleware`, `transformMiddleware`, `samplingMiddleware`, `timeoutMiddleware`, `loggingMiddleware`, and more
  - New composition strategies for multi-subscriber setups: `parallel`, `failover`, `round-robin`, `random`, `race`, and `mirrored`
  - HTTP client abstraction with timeout support, proper error handling, and automatic response parsing
  - Smart error classification: distinguishes between retriable (5xx, network, rate-limit) and non-retriable (4xx validation, auth) errors
  - Idempotency and rate limiting stores with in-memory implementations
  - Event logging middleware for audit trails and observability
  - Comprehensive JSDoc documentation for all new APIs

## 31.0.4

### Patch Changes

- Updated dependencies [3a21282]
  - autotel@3.0.4

## 31.0.3

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

## 31.0.2

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
  - autotel@3.0.2

## 31.0.1

### Patch Changes

- 5d05a3e: Add Cloudflare Workers support to main `autotel` package. Introduces `autotel/workers` and `autotel/cloudflare` entry points that re-export the functional API and Cloudflare-specific instrumentation from `autotel-cloudflare`, providing better DX for Cloudflare users while keeping the core package modular. Updates package exports, build config, and documentation.
- Updated dependencies [5d05a3e]
  - autotel@3.0.1

## 31.0.0

### Patch Changes

- Updated dependencies [b1f3704]
  - autotel@3.0.0

## 30.0.3

### Patch Changes

- dc4908d: Updated deps
- Updated dependencies [dc4908d]
  - autotel@2.26.3

## 30.0.2

### Patch Changes

- Updated dependencies [abe7674]
  - autotel@2.26.2

## 30.0.1

### Patch Changes

- Updated dependencies [dc471ef]
  - autotel@2.26.1

## 30.0.0

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

- Updated dependencies [8003fad]
  - autotel@2.26.0

## 29.0.5

### Patch Changes

- Updated dependencies [f4ac1c3]
  - autotel@2.25.5

## 29.0.4

### Patch Changes

- Updated dependencies [32e088f]
  - autotel@2.25.4

## 29.0.3

### Patch Changes

- Updated dependencies [3a5b723]
  - autotel@2.25.3

## 29.0.2

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

- Updated dependencies [7d77567]
  - autotel@2.25.2

## 29.0.1

### Patch Changes

- c6010e1: Improve package compatibility and tooling consistency across the monorepo.
  - Add CommonJS build output/exports where missing (including `autotel` entrypoints and backend/MCP package builds) to improve `require()` interoperability.
  - Roll forward shared dependency versions across affected packages/apps to keep examples and libraries aligned on the same toolchain.

- Updated dependencies [c6010e1]
  - autotel@2.25.1

## 29.0.0

### Minor Changes

- 04c370a: This release rolls out a monorepo-wide refresh across the Autotel package family with coordinated minor updates.

  Highlights:
  - Align package internals and workspace metadata for the next release wave.
  - Improve reliability of test and quality workflows used across packages.
  - Keep package behavior and public APIs consistent while shipping incremental enhancements across the ecosystem.

### Patch Changes

- Updated dependencies [04c370a]
  - autotel@2.25.0

## 28.0.1

### Patch Changes

- Updated dependencies [3438fe4]
  - autotel@2.24.1

## 28.0.0

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

### Patch Changes

- Updated dependencies [88b4eab]
- Updated dependencies [88b4eab]
  - autotel@2.24.0

## 27.0.1

### Patch Changes

- 65b2fc9: - Bug fixes and dependency updates across packages.
  - example-vitest: API tests use a random port (when `API_BASE_URL`/`PORT` unset) to avoid EADDRINUSE on port 3000.
- Updated dependencies [65b2fc9]
  - autotel@2.23.1

## 27.0.0

### Minor Changes

- eb28f60: **autotel**
  - **Request logger**: `getRequestLogger(ctx?, options?)` with `set()`, `info()`, `warn()`, `error()`, `getContext()`, and `emitNow(overrides?)`. Optional `onEmit` callback for manual fan-out. Writes to span attributes/events so canonical log lines still emit one wide event per request.
  - **Structured errors**: `createStructuredError()`, `getStructuredErrorAttributes()`, `recordStructuredError()`. Supports `message`, `why`, `fix`, `link`, `code`, `status`, `cause`, `details`.
  - **parseError**: `parseError(error)` returns `{ message, status, why?, fix?, link?, code?, details?, raw }` for frontend/API consumers. Export from main entry and `autotel/parse-error`.
  - **Drain pipeline**: `createDrainPipeline()` for batching, retry with backoff, flush, and shutdown. Use with `canonicalLogLines.drain`. Export from main entry and `autotel/drain-pipeline`.
  - **Canonical log lines**: `shouldEmit`, `drain`, `onDrainError`, `keep` (declarative tail sampling), and `pretty` (tree-formatted dev output) options. Adds `duration` (formatted) field alongside `duration_ms`. Respects `autotel.log.level` span attribute for explicit level. New types `CanonicalLogLineEvent`, `KeepCondition`.
  - **formatDuration**: `formatDuration(ms)` formats milliseconds as human-readable strings (`45ms`, `1.2s`, `1m 5s`).

### Patch Changes

- Updated dependencies [eb28f60]
- Updated dependencies [f772504]
  - autotel@2.23.0

## 26.0.0

### Minor Changes

- 1155c72: - **autotel-backends**: Add Grafana backend; export and type updates.
  - **autotel, autotel-\***: Dependency bumps, docs/comment updates, and version alignment across the monorepo.

### Patch Changes

- Updated dependencies [1155c72]
  - autotel@2.22.0

## 25.0.0

### Minor Changes

- c710c71: Add option to hide free/busy times (or selected attributes) in console export and related exporters.

### Patch Changes

- Updated dependencies [c710c71]
  - autotel@2.21.0

## 24.0.0

### Patch Changes

- Updated dependencies [6b67787]
  - autotel@2.20.0

## 23.0.1

### Patch Changes

- f6fe506: Fix flaky Segment subscriber test by awaiting Segment initialization in the init test and ensuring assertions run after async setup.

## 23.0.0

### Minor Changes

- d1bd8cd: - **autotel-sentry**: README updates : clarify Sentry SDK + OTel scenario, link to Sentry OTLP docs, note that Sentry ingestion request spans are not sent, fix `SentrySpanProcessor` backtick typo, add spec-volatility note.
  - **autotel-backends**: Preserve caught error in Google Cloud config : attach original error as `cause` when throwing the user-facing error so the `preserve-caught-error` lint rule is satisfied.

### Patch Changes

- Updated dependencies [d1bd8cd]
  - autotel@2.19.0

## 22.0.1

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

- Updated dependencies [ecf920e]
  - autotel@2.18.1

## 22.0.0

### Patch Changes

- Updated dependencies [23ed022]
  - autotel@2.18.0

## 21.0.0

### Patch Changes

- Updated dependencies [e62eb75]
  - autotel@2.17.0

## 20.0.0

### Minor Changes

- 8a6769a: x

### Patch Changes

- Updated dependencies [8a6769a]
  - autotel@2.16.0

## 19.0.0

### Minor Changes

- c68a580: - **autotel**: Add correlation ID support for event-driven observability (stable join key across events, logs, and spans via AsyncLocalStorage; optional baggage propagation). Add events configuration for `init()`: `includeTraceContext`, `traceUrl`, and baggage enrichment with allow/deny and transforms. Event queue and event subscriber now attach correlation ID and trace context to events. New `autotel/correlation-id` and `autotel/events-config` types used internally; init accepts `events` option.
  - **autotel-subscribers**: EventSubscriber base class and adapters (PostHog, Mixpanel, Amplitude) updated to use `autotel/event-subscriber` types and AutotelEventContext; graceful shutdown and payload normalization aligned with new event context and correlation ID.
  - **autotel-edge**, **autotel-cloudflare**, **autotel-aws**, **autotel-backends**, **autotel-tanstack**, **autotel-terminal**, **autotel-plugins**, **autotel-cli**, **autotel-mcp**, **autotel-web**: Version bumps for compatibility with autotel core.

### Patch Changes

- Updated dependencies [c68a580]
  - autotel@2.15.0

## 18.0.2

### Patch Changes

- Updated dependencies [78202aa]
  - autotel@2.14.2

## 18.0.1

### Patch Changes

- acfd0de: Add comprehensive test coverage for Datadog backend configuration, including validation, direct cloud ingestion, agent mode, and OTLP logs export functionality.
- Updated dependencies [acfd0de]
  - autotel@2.14.1

## 18.0.0

### Minor Changes

- 47c70fb: Update dependencies across all packages:
  - **OpenTelemetry**: Update to v2.5.0 (core packages) and v0.211.0 (SDK packages)
  - **AWS SDK**: Update all client packages from v3.972.0 to v3.975.0
  - **TypeScript ESLint**: Update from v8.53.1 to v8.54.0
  - **Turbo**: Update from v2.7.5 to v2.7.6
  - **Vitest**: Update from v4.0.17 to v4.0.18
  - **@types/node**: Update from v25.0.9 to v25.0.10
  - **Cloudflare Workers Types**: Update from v4.20260120.0 to v4.20260124.0

### Patch Changes

- Updated dependencies [47c70fb]
  - autotel@2.14.0

## 17.0.0

### Minor Changes

- 8256dac: Add comprehensive awaitly integration example demonstrating workflow instrumentation with autotel OpenTelemetry. The new `awaitly-example` app showcases successful workflows, error handling, decision tracking, cache behavior, and visualization features. Updated prettier to 3.8.1 across all packages.

### Patch Changes

- Updated dependencies [8256dac]
  - autotel@2.13.0

## 16.0.1

### Patch Changes

- 3e12422: Update dependencies across all packages:
  - OpenTelemetry packages: 0.208.0 → 0.210.0
  - OpenTelemetry SDK packages: 2.2.0 → 2.4.0
  - import-in-the-middle: 2.0.1 → 2.0.4
  - pino: 10.1.0 → 10.1.1
  - TypeScript ESLint: 8.52.0 → 8.53.0
  - vitest: 4.0.16 → 4.0.17
  - @types/node: 25.0.3 → 25.0.8
- Updated dependencies [3e12422]
  - autotel@2.12.1

## 16.0.0

### Minor Changes

- 8831cf8: Add canonical log lines (wide events) feature to automatically emit spans as comprehensive log records. Implements the "canonical log line" pattern: one log line per request with all context, making logs queryable as structured data instead of requiring string search.

  **autotel:**
  - New `canonicalLogLines` option in `init()` config
  - `CanonicalLogLineProcessor` for automatic span-to-log conversion
  - Supports root spans only, custom message format, min level filtering
  - Works with any logger (Pino, Winston) or OTel Logs API
  - Attribute redaction support for sensitive data

### Patch Changes

- Updated dependencies [8831cf8]
  - autotel@2.12.0

## 15.0.0

### Patch Changes

- Updated dependencies [92206af]
  - autotel@2.11.0

## 14.1.0

### Minor Changes

- 723c889: ### autotel-terminal
  - Improve keyboard input handling with stdin detection for better compatibility in non-TTY environments
  - Add unique React keys to prevent rendering conflicts when spans have duplicate IDs
  - Gracefully handle environments where raw mode is not supported

  ### autotel-cloudflare
  - Update `@cloudflare/workers-types` dependency to latest version

  ### autotel-subscribers
  - Update `@cloudflare/workers-types` dependency to latest version

## 14.0.0

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

### Patch Changes

- Updated dependencies [e5337b0]
  - autotel@2.10.0

## 14.0.0

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

### Patch Changes

- Updated dependencies [86ae1a8]
  - autotel@2.10.0

## 13.0.0

### Patch Changes

- Updated dependencies [05f2d95]
  - autotel@2.9.0

## 12.0.0

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

### Patch Changes

- Updated dependencies [e904227]
  - autotel@2.8.0

## 11.0.0

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

### Patch Changes

- Updated dependencies [bc0e668]
  - autotel@2.7.0

## 10.0.0

### Patch Changes

- Updated dependencies [2ae2ece]
  - autotel@2.6.0

## 9.0.0

### Patch Changes

- Updated dependencies [745ab4c]
  - autotel@2.5.0

## 8.0.0

### Patch Changes

- Updated dependencies [31edf41]
  - autotel@2.4.0

## 7.0.0

### Patch Changes

- Updated dependencies [38f0462]
  - autotel@2.4.0

## 6.0.0

### Patch Changes

- Updated dependencies [bb7c547]
  - autotel@2.3.0

## 5.0.0

### Minor Changes

- 79f49aa: Updated example

### Patch Changes

- Updated dependencies [79f49aa]
  - autotel@2.2.0

## 4.1.0

### Minor Changes

- ec3b0c7: Add YAML configuration support and zero-config auto-instrumentation
  - **YAML Configuration**: Configure autotel via `autotel.yaml` files with environment variable substitution
  - **Zero-config setup**: New `autotel/auto` entry point for automatic initialization from YAML or environment variables
  - **ESM loader registration**: New `autotel/register` entry point for easier ESM instrumentation setup without NODE_OPTIONS
  - **Improved CommonJS compatibility**: Better support for CommonJS plugins and instrumentations

## Released

Initial release as `autotel-subscribers` (renamed from `autotel-subscribers`).
