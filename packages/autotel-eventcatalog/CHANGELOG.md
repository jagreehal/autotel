# Changelog

## 11.0.1

### Patch Changes

- 4b7ad78: chore: routine dependency updates

  Refresh runtime and peer dependency ranges across published packages (`ncu`, 3-day release-age cooldown).

  The core `autotel` package moves to the latest OpenTelemetry libraries (stable `2.9.x`, experimental `0.220.x`, semantic-conventions `1.42.x`). This required adapting to a breaking change in `@opentelemetry/sdk-logs`: `BatchLogRecordProcessor` and `SimpleLogRecordProcessor` now take a `{ exporter }` options object instead of a positional exporter argument.

  Notable peer range bumps for consumers: `autotel-aws` (AWS SDK `3.1081`), `autotel-cloudflare` (`@cloudflare/workers-types` v5), `autotel-pact` (`@pact-foundation/pact` v17), `autotel-terminal` (`ai` v7).
  - autotel-subscribers@41.0.4

## 11.0.0

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
  - autotel-subscribers@41.0.0

## 10.0.0

### Patch Changes

- autotel-subscribers@40.0.0

## 9.0.0

### Patch Changes

- autotel-subscribers@39.0.0

## 8.0.0

### Patch Changes

- autotel-subscribers@38.0.0

## 7.0.0

### Patch Changes

- autotel-subscribers@37.0.0

## 6.0.0

### Patch Changes

- Updated dependencies [1c43d26]
  - autotel-subscribers@36.0.0

## 5.0.0

### Patch Changes

- autotel-subscribers@35.0.0

## 4.0.1

### Patch Changes

- 4ce86fc: Refresh package dependencies across the workspace and keep generated lockfile state in sync.

  Add OTLP/protobuf ingestion support to `autotel-devtools` for traces, logs, and metrics. The devtools HTTP receiver now accepts both OTLP/JSON and OTLP/protobuf payloads on the existing `/v1/traces`, `/v1/logs`, and `/v1/metrics` endpoints, decodes protobuf payloads with embedded OTLP schemas, and includes interop coverage using the OpenTelemetry protobuf serializers.

- Updated dependencies [4ce86fc]
  - autotel-subscribers@34.1.1

## 4.0.0

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

### Patch Changes

- Updated dependencies [fb6cba7]
  - autotel-subscribers@34.1.0

## 3.0.0

### Patch Changes

- Updated dependencies [30a485b]
  - autotel-subscribers@34.0.0

## 2.0.0

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
  - autotel-subscribers@33.0.0

## 1.0.0

### Minor Changes

- de31d28: The "get to 10" pass. Closes the review-board's outstanding watch items
  and a couple they didn't surface.

  **Public JSON contract.** Three versioned JSON Schemas ship with the
  package: `schemas/drift-report-v0.1.0.json`,
  `schemas/drift-summary-v0.1.0.json`, and
  `schemas/stamp-summary-v0.1.0.json`. Each output envelope carries a
  `spec:` field downstream consumers can read to refuse unknown major
  versions. New `contract.test.ts` validates emitted output against the
  schemas AND byte-compares against committed golden fixtures, so a PR
  that silently changes a published field name now fails CI with a clear
  message.

  **Renderers as adapters.** The Markdown / Terminal / JSON renderers
  moved into `src/renderers/` with a small `Renderer` interface and a
  `getRenderer(name)` registry. The CLI's `--format` flag now dispatches
  through the registry instead of hardcoding two cases — adding SARIF,
  Slack-flavoured markdown, GitHub Check Runs API, etc. is a single new
  file. The core diff and policy modules don't move and never reference
  the registry. Backwards-compatible: `import { renderMarkdown } from
'autotel-eventcatalog'` still works.

  **Action hardening.**
  - `marocchino/sticky-pull-request-comment` pinned to a specific commit
    SHA (supply-chain control).
  - A failure of the comment step is downgraded to a `::warning::` so the
    drift signal is never lost to a flaky GitHub API call. Behind
    `continue-on-comment-failure` input (defaults to `true`; set to
    `false` to keep the old behaviour).
  - `package-version` default changed from `latest` to `^0` so a new
    major release doesn't silently land on user CI.

  **README.** Opens with the dual-tool framing (drift verifier + stamp
  generator). New "What this package does NOT do" boundary statement. New
  "Public JSON contract" and "Renderers (advanced)" sections.

  Backwards-compatible for every existing CLI and library consumer.

  Total tests: 78 unit + 11 e2e (was 58 + 11 before this changeset).

- de31d28: Initial release of `autotel-eventcatalog`. Diffs an autotel architecture
  snapshot against an EventCatalog and reports the drift: events observed but
  undocumented, events documented but never observed, field paths in payloads
  not declared in the schema, and producers / channels seen but not catalogued.

  Ships as a library and a CLI:

  ```bash
  autotel-eventcatalog drift \
    --snapshot ./services/test/snapshot.json \
    --catalog ./catalog \
    --output drift.md \
    --fail-on-drift   # exit 1 when drift is detected — wire this into CI
  ```

  v0 covers existence drift and field-path drift. Type drift, value drift, and
  auto-writing missing catalog entries are deferred to later releases.

- de31d28: Three small follow-ups from review notes, applied:
  1. **Count extraction moved next to the diff types**. `countDriftReport`
     (in `diff.ts`) and `countDriftEntries` / `countDriftDelta` (in
     `diff-vs-base.ts`) produce the per-category and total counts that
     dashboards, CI summaries, and reports need. `cli.ts`'s `buildSummary`
     no longer duplicates the extraction logic. `hasDrift` is now a thin
     wrapper around `countDriftReport(...).total > 0`. The new `total`
     field matches the dashboard's existing `countDrift()` semantic
     (individual paths inside `fieldDrift` are counted, not just events).
     New `DriftCounts` type exported from the library.
  2. **`stamp --summary-output` ships**. Mirrors the existing `drift
--summary-output` so CI can answer "did this PR need to re-stamp?"
     from a structured JSON file rather than parsing stderr. The summary
     carries a versioned `spec: 'autotel-eventcatalog-stamp-summary/v0.1.0'`
     marker and reports `attempted / inserts / replaces / changedFiles /
skipped / hadChanges`. `StampUpdate` gains a `changed: boolean` flag
     so re-stamping with identical content correctly reports as a no-op
     replace.
  3. **`renderTerminal` becomes a real export**. Tests cover the
     structure-preserved-decorations-stripped contract. Added
     `renderDeltaTerminal` for symmetric coverage of the PR-style delta
     view. Both useful for Slack messages, log files, and anywhere a
     plain-text rendering beats markdown.

  13 new tests, all passing (58 unit + 11 e2e total).

- de31d28: Add `--base-snapshot` mode and a composite GitHub Action for PR drift checking.

  `autotel-eventcatalog drift --base-snapshot <path> --snapshot <path> --catalog <path>`
  reports only the drift the PR introduces, ignoring pre-existing drift. New
  `compareDriftReports()` and `renderDeltaMarkdown()` library exports do the
  same thing programmatically.

  The new `action.yml` ships in the package so any repository can wire drift
  checking into its PR pipeline with one step:

  ```yaml
  - uses: jagreehal/autotel-eventcatalog@v0
    with:
      snapshot: ./services/test/snapshot.json
      catalog: ./catalog
      base-ref: origin/${{ github.base_ref }}
      fail-on-drift: true
      comment-on-pr: true
  ```

  The action runs the CLI, posts a sticky comment with the drift report on
  the PR, and fails the check only when the PR introduces _new_ drift.

- de31d28: Add a `stamp` subcommand to `autotel-eventcatalog` that writes a runtime
  evidence block into each event mdx between
  `<!-- autotel:stamp-start -->` and `<!-- autotel:stamp-end -->` markers.

  The block carries everything autotel observed in the snapshot for that
  event — volume, last-seen, producer, channel, and the full list of dotted
  field paths — so the static catalog page itself shows runtime evidence
  alongside the hand-written narrative, not in a separate dashboard.

  ```bash
  autotel-eventcatalog stamp \
    --snapshot ./services/test/snapshot.json \
    --catalog ./catalog
  ```

  Subsequent runs are idempotent: content between the markers is replaced,
  not duplicated. `--dry-run` prints the update plan without writing files,
  suitable for a CI sanity check. The library also exposes `stampCatalog()`
  and `buildStampBlock()` for programmatic use.

### Patch Changes

- de31d28: Two correctness fixes flagged in code review:

  **P0**: The CLI only exits non-zero on drift when `--fail-on-drift` is set.
  The bundled GitHub Action's internal script captured `STATUS=$?` from the
  CLI without passing `--fail-on-drift`, so the action's `drift-detected`
  output and the downstream "Fail on drift" step never fired even when
  drift was present. Fixed by always passing `--fail-on-drift` from the
  action's internal script — the user-facing `fail-on-drift` input now
  governs whether the workflow step fails, but the action's drift signal
  is no longer gated on it.

  **P1**: `readCatalogState` matched literal `'/'` separators for
  directory classification. On Windows runners the path separator is `\`,
  so the `'/versioned/'` exclusion and the `services/events/channels`
  classification both silently misbehaved. Paths are now normalised to a
  canonical POSIX form before string-matching, so classification works
  identically on every platform.

  The CLI exit-code contract is now documented as:

  0 — no drift
  1 — drift detected (only when `--fail-on-drift` is set)
  2 — bad arguments
  other — hard failure (surface to the user)

- de31d28: Tighten the policy layer based on a code-review pass.
  - `PolicyEvaluationResult` drops the redundant `mode` field. `reason` is
    retained and now used: the CLI prints it on stderr at the end of every
    drift run so CI logs say _"Drift detected in current snapshot."_ or
    _"No new drift introduced compared to baseline snapshot."_ — explaining
    the exit code rather than just emitting it.
  - The CLI no longer silently rewrites `--policy all` to `--policy
new-only` when `--base-snapshot` is present. The effective policy is
    derived at the use site: explicit flag wins, otherwise default to
    `new-only` when a baseline is supplied, else `all`. Same behaviour for
    users who omit `--policy`; no more "we secretly mutated your flag"
    surprise for users who set it explicitly.
  - The JSON output (`--format json`) is now versioned with a
    `spec: 'autotel-eventcatalog-report/v0.1.0'` marker on every envelope,
    so downstream tooling can detect and refuse unknown major versions.
    Exported as `REPORT_SPEC` from the library.
  - New e2e test suite (`cli.e2e.test.ts`) spawns the built CLI against
    fixture catalogs and asserts exit codes + outputs for: clean state
    with `--fail-on-drift`, drift with `--fail-on-drift`, drift without
    `--fail-on-drift` (the original P0 regression class), `--policy
new-only` without `--base-snapshot`, versioned JSON output, unknown
    flags, and `stamp --dry-run`. Run via `pnpm test:e2e`.

- Updated dependencies [de31d28]
  - autotel-subscribers@32.1.0

All notable changes to `autotel-eventcatalog` land here. Entries are
generated by [Changesets](https://github.com/changesets/changesets) at
release time from the files in `.changeset/`; this file is the
authoritative history once each release ships.

For the current scope of the package, see [README.md](README.md). For
the version policy (when shapes change, when contracts break), see
[docs/UPGRADING.md](docs/UPGRADING.md).

<!-- Future Changesets-generated entries will be inserted above this line. -->
