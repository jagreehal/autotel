---
'autotel-eventcatalog': minor
---

Three small follow-ups from review notes, applied:

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
