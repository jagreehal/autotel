# Changelog

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
