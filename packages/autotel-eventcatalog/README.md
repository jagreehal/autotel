# autotel-eventcatalog

**Your tests become living architecture docs.**

Two tools for keeping an [EventCatalog](https://www.eventcatalog.dev) in
sync with what your [autotel](https://github.com/jagreehal/autotel)-instrumented
code does at runtime:

| Command     | Mode      | What it does                                                                                                                                                                              |
| ----------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`drift`** | read-only | Diffs the catalog against a snapshot. Reports findings as Markdown, JSON, or plain text. The PR check that catches "you added an event but forgot to document it."                        |
| **`stamp`** | write     | Writes a runtime evidence block (counts, last-seen, field paths) into each event's `index.mdx` between idempotent markers. Keeps the static catalog page reflecting production behaviour. |

Both share inputs: an autotel snapshot JSON file and an EventCatalog
directory. Both ship a versioned JSON summary you can gate CI on. The
`drift` command also ships as a one-line GitHub Action with a sticky PR
comment.

Same model as Pact, for event architectures.

## What this package does NOT do

To keep the scope tight:

- **Does not produce snapshots.** Snapshots come from
  [`autotel-subscribers`'s `ArchitectureSnapshotSubscriber`](../autotel-subscribers).
  This package only consumes them.
- **Does not run any web server or dashboard.** Live dashboards live in
  example apps. This package is a CLI plus library plus action.
- **Does not infer types.** Field-path drift is set-difference on dotted
  paths. Type inference from small samples is unreliable; we don't do it.
- **Does not modify catalog files outside the stamp markers.** Everything
  the `stamp` command writes is between `<!-- autotel:stamp-start -->`
  and `<!-- autotel:stamp-end -->`. Outside those markers is yours.

## Install

```bash
pnpm add -D autotel-eventcatalog
```

Requires that your services use autotel and `ArchitectureSnapshotSubscriber`
from `autotel-subscribers/architecture-snapshot` to produce a snapshot.

## Use

### From the CLI

```bash
autotel-eventcatalog drift \
  --snapshot ./services/test/snapshot.json \
  --catalog ./catalog \
  --output ./drift.md \
  --summary-output ./drift-summary.json \
  --policy all \
  --fail-on-drift     # exit 1 on drift; wire this into CI
```

### From code

```typescript
import {
  loadSnapshot,
  readCatalogState,
  diffCatalogAgainstSnapshot,
  renderMarkdown,
  renderTerminal, // plain-text, for Slack / log files / non-MD terminals
  renderJson, // versioned envelope for downstream tooling
  countDriftReport, // per-category counts that match the dashboard hero badge
  hasDrift,
  stampCatalog, // write runtime evidence into your catalog's event mdx
  buildStampSummary, // count of inserts / replaces / no-ops / skipped
} from 'autotel-eventcatalog';

const snapshot = await loadSnapshot('./services/test/snapshot.json');
const catalog = await readCatalogState('./catalog');
const report = diffCatalogAgainstSnapshot(snapshot, catalog);

console.log(renderMarkdown(report));
console.log('findings:', countDriftReport(report).total);
if (hasDrift(report)) process.exit(1);
```

### As a GitHub Action

The package ships a composite action so any repository can wire drift checking
into its PR pipeline with a single step:

```yaml
# .github/workflows/eventcatalog-drift.yml
name: eventcatalog drift
on:
  pull_request:
    branches: [main]
jobs:
  drift:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 } # so the action can read the base branch

      # Produce the snapshot however you like; typically by running your
      # integration tests with ArchitectureSnapshotSubscriber wired in.
      - run: pnpm install --frozen-lockfile
      - run: pnpm services:snapshot

      - uses: jagreehal/autotel-eventcatalog@v0
        with:
          snapshot: ./services/test/snapshot.json
          catalog: ./catalog
          base-ref: origin/${{ github.base_ref }} # compare to PR base
          fail-on-drift: true # fail the PR on new drift
          comment-on-pr: true # post a sticky comment
```

CLI policy modes:

- `--policy all`: fail on any drift in the current snapshot.
- `--policy new-only`: fail only on drift introduced vs `--base-snapshot`.

What lands on the PR:

- A sticky comment titled "Architecture drift: what this change introduces"
  with sections for new events, removed events, field-path drift, and
  drift the PR resolved.
- The check fails only when this PR introduces _new_ drift. Pre-existing
  drift is reported for context but does not block.
- The drift report is also written to `$RUNNER_TEMP/autotel-eventcatalog-drift.md`
  and printed in the job log.

## What gets caught

| Drift class                              | Example finding                                            |
| ---------------------------------------- | ---------------------------------------------------------- |
| **Events observed but undocumented**     | `order.cancelled` emitted by code; no entry in catalog     |
| **Events documented but never observed** | `LegacyEvent` in catalog; never seen in tests              |
| **Field-path drift (extra)**             | `personalization_seed` in payload; not declared in schema  |
| **Field-path drift (missing)**           | `customerId` declared in schema; never present in payloads |
| **Services observed but undocumented**   | `OrdersService` is a producer; no service page             |
| **Channels observed but undocumented**   | `orders.events` carries messages; no channel page          |

## What v0 deliberately does not catch

- **Type drift**: `amount` declared `number` but observed as `string`.
- **Value drift**: `status: "placed"` observed but not in declared enum.

Type and value inference from small payload samples is notoriously bad
(over-narrow types, missing optionality, no enums). v1 will accept Zod
schemas at the `track()` call site so type drift is detected against
declared schemas rather than inferred ones.

## Public JSON contract

Three versioned JSON shapes are shipped with the package as JSON Schema
files (`schemas/` directory). Downstream tooling (your own GitHub Actions,
dashboards, Slack bots) should validate against these:

| Schema                              | Emitted by                   | Consumed by                              |
| ----------------------------------- | ---------------------------- | ---------------------------------------- |
| `schemas/drift-report-v0.1.0.json`  | `drift --format json`        | Any downstream parser                    |
| `schemas/drift-summary-v0.1.0.json` | `drift --summary-output ...` | CI gating, dashboards                    |
| `schemas/stamp-summary-v0.1.0.json` | `stamp --summary-output ...` | "Did this PR forget to re-stamp?" checks |

Every envelope carries a `spec: 'autotel-eventcatalog-…/vX.Y.Z'` field
that downstream code can use to refuse unknown major versions. The shapes
are locked by golden contract tests inside this package: a PR that
changes them without bumping the spec version will fail CI.

## Renderers (advanced)

`drift --format <name>` dispatches through a small renderer registry. The
built-ins are `markdown`, `terminal`, `json`. The registry is exported
from the library so applications and other tooling can add their own:

```typescript
import { RENDERERS, type Renderer } from 'autotel-eventcatalog';

const sarifRenderer: Renderer = {
  name: 'sarif',
  description: 'Static Analysis Results Interchange Format',
  renderReport(report) {
    /* ... */ return '';
  },
  renderDelta(delta) {
    /* ... */ return '';
  },
};
// Programmatic consumers can plug it in. The CLI is also extensible via
// a follow-up release that supports loading renderers from a config file.
```

The core diff and policy modules are renderer-agnostic; adding a new
output target should never require touching `diff.ts` or `policy.ts`.

## What writes to the catalog

`drift` is **read-only**. It diffs the snapshot against the catalog and
reports findings. It never modifies catalog files.

`stamp` is the **write path**. By design, it injects a runtime evidence
block into each event mdx between idempotent markers
(`<!-- autotel:stamp-start -->` / `<!-- autotel:stamp-end -->`). Re-runs
replace the content between the markers; nothing outside the markers is
touched. Run with `--dry-run` to preview the plan first.

Pass `--summary-output stamp.json` to write a versioned summary file
(`autotel-eventcatalog-stamp-summary/v0.1.0`) describing how many files
were inserted, replaced, no-op'd, or skipped. Useful for CI checks that
need to gate on "did this PR forget to re-stamp?".

## Working example

See [`apps/example-eventcatalog`](../../apps/example-eventcatalog) in the
monorepo. It has a working e-commerce catalog and a snapshot. Running
`pnpm catalog:drift` from that app prints a drift report that surfaces
three findings, including a deliberately-introduced `personalization_seed`
field that the schema does not declare.

## Documentation

| If you want to…                                        | Read                                                 |
| ------------------------------------------------------ | ---------------------------------------------------- |
| Consume the JSON output from your own tool             | [`docs/CONTRACT.md`](docs/CONTRACT.md)               |
| Write a custom renderer (SARIF, Slack, your dashboard) | [`docs/EXTENDING.md`](docs/EXTENDING.md)             |
| Debug a CLI exit code or a CI failure                  | [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) |
| Upgrade between versions safely                        | [`docs/UPGRADING.md`](docs/UPGRADING.md)             |
| See what shipped in each release                       | [`CHANGELOG.md`](CHANGELOG.md)                       |
| Contribute to the package                              | [`CONTRIBUTING.md`](CONTRIBUTING.md)                 |
| Validate the published JSON shapes                     | [`schemas/README.md`](schemas/README.md)             |

## Used by

_If you adopt this in production, open a PR adding your team to this
section. We'd like to know who depends on the contract before shipping
breaking changes, and seeing a name here helps future adopters gauge
the project's maturity._

- _no public adopters yet; be the first_

## License

MIT.
