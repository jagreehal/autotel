---
'autotel-eventcatalog': minor
'autotel-subscribers': minor
---

### autotel-pact

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
