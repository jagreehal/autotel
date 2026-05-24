# autotel-eventcatalog

Keep your [EventCatalog](https://www.eventcatalog.dev) honest about what
the code actually does at runtime.

> **New here?** [autotel](https://github.com/jagreehal/autotel) is an
> ergonomic OpenTelemetry wrapper for Node.js: you call `trace()`, `span()`
> and `track(eventName, payload)` in your service code and it emits spans
> and domain events. The `ArchitectureSnapshotSubscriber` from
> `autotel-subscribers` listens to those events during a test run and
> writes a `snapshot.json` describing every event that fired, the fields
> in its payload, the runtime types of those fields, who produced it and
> on what channel. This package reads that snapshot and compares it to
> your catalog.

Three tools:

| Command        | Mode      | What it does                                                                                                                                                                              |
| -------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`drift`**    | read-only | Diffs the catalog against a snapshot. Reports findings as Markdown, JSON, or plain text. The PR check that catches "you added an event but forgot to document it."                        |
| **`generate`** | write     | Scaffolds EventCatalog resources from a snapshot: services, events, channels, inferred JSON Schemas, and producer↔event↔channel relationships.                                            |
| **`stamp`**    | write     | Writes a runtime evidence block (counts, last-seen, field paths) into each event's `index.mdx` between idempotent markers. Keeps the static catalog page reflecting production behaviour. |

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
- **Does not infer drift contracts from payload samples during `drift`.**
  Field-path drift is set-difference on dotted paths. Type/value drift is
  checked only against declared schema constraints. (`generate` can scaffold
  schemas from snapshot evidence; `drift` still compares against declared
  schemas.)
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

```bash
autotel-eventcatalog generate \
  --snapshot ./services/test/snapshot.json \
  --catalog ./catalog
```

Re-runnable: existing catalog files are skipped, never overwritten. New
events / services / channels from the snapshot are added on top.
Producer (`sends`), consumer (`receives`), and channel routing edges
are wired automatically. Pass `--dry-run` to preview, `--edges-only`
to re-sync relationships without touching resource bodies, or
`--version 2.0.0` to override the default version for newly created
resources.

### Schema sources

When `generate` writes an event's `schema.json`, it picks the schema
in this order:

1. **Declared schema** — if the snapshot's event observation carries a
   `schema.jsonSchema` (recorded by `ArchitectureSnapshotSubscriber`
   when a `track()` call was made through [`defineEvent`](#defineevent-zod-schemas-at-the-call-site)),
   that schema is used verbatim.
2. **Inferred schema** — otherwise, the schema is inferred from observed
   `fieldStats` (runtime types per dotted path) as a fallback. This
   gets a new project from zero to a usable catalog on the first run;
   `defineEvent` is the path to a robust, single-source-of-truth
   contract once you're ready.

The choice is recorded in the operations log and the `generate-summary`
JSON envelope as `schemaSource: 'declared' | 'inferred'`, so CI can
surface adoption.

#### `defineEvent`: Zod schemas at the call site

In your service code, replace bare `track('event.name', payload)` calls
with `defineEvent` and a Zod schema:

```typescript
import { defineEvent } from 'autotel';
import { z } from 'zod';

export const orderPlacedEvent = defineEvent(
  'order.placed',
  z.object({
    orderId: z.string(),
    customerId: z.string(),
    totalCents: z.number(),
    items: z.array(z.object({ sku: z.string(), quantity: z.number() })),
  }),
  { toJsonSchema: (schema) => z.toJSONSchema(schema) },
);

// At the call site:
orderPlacedEvent.track({ orderId, customerId, totalCents, items });
```

The schema is now the single source of truth: TypeScript catches drift
at compile time, `safeParse` validates payloads at runtime, and
`ArchitectureSnapshotSubscriber` carries the JSON Schema forward into
the snapshot — so `generate` writes the _same_ schema your code
enforces, no inference guesswork.

### From code

```typescript
import {
  loadSnapshot,
  generateCatalogFromSnapshot,
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
await generateCatalogFromSnapshot({
  snapshot,
  catalogPath: './catalog',
  dryRun: false,
});

const catalog = await readCatalogState('./catalog');
const report = diffCatalogAgainstSnapshot(snapshot, catalog);

console.log(renderMarkdown(report));
console.log('findings:', countDriftReport(report).total);
if (hasDrift(report)) process.exit(1);
```

### What a run actually prints

After the example app's services have been migrated to `defineEvent`
and the catalog's schemas align with what the code emits, running
`pnpm catalog:drift` from `apps/example-eventcatalog` prints:

```
# Architecture drift report

No drift detected. Catalog and runtime agree.
```

Exit code 0, CI passes. That's the steady-state goal: the catalog and
the running code make the same claims and the drift detector confirms
it. Every additional finding is genuine signal of code-vs-catalog
divergence — a new event added without a schema, a removed producer
still listed, a schema field that no longer ships.

Type drift handles the JSON Schema ↔ JavaScript impedance mismatch
deliberately: a declared `integer` accepts an observed `number` at the
type level, then sample values are checked against `Number.isInteger`
so a runtime `1.5` against a declared `integer` still flags. No false
positives, no swept-under-the-rug genuine signal.

The example app exercises both the happy path and the payment-failure
path so the snapshot covers every documented event. Value drift would
fire if, for instance, a `declineCode` outside the declared enum
appeared at runtime — try replacing `card_declined` with something else
in `build-snapshot.ts` and re-running to see it.

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
  with sections for new events, removed events, field-path drift, type drift,
  value drift, and drift the PR resolved.
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
| **Type drift**                           | `amount` declared `number`; observed `string`              |
| **Value drift (enum mismatch)**          | `status: "placed"` observed; schema enum excludes it       |
| **Services observed but undocumented**   | `OrdersService` is a producer; no service page             |
| **Channels observed but undocumented**   | `orders.events` carries messages; no channel page          |

**How type and value drift work in practice.**

1. `ArchitectureSnapshotSubscriber` records `fieldStats` per event during
   a test run — for each dotted path it captures the runtime types it
   saw (`string`, `number`, `object`, …) and up to 20 primitive sample
   values. Verified by
   [`snapshot-fieldstats.integration.test.ts`](../../apps/example-eventcatalog/services/test/snapshot-fieldstats.integration.test.ts),
   which runs the real `placeOrder` → `handleOrderPlaced` →
   `handlePaymentCaptured` → `generateRecommendation` flow and asserts
   `fieldStats.totalCents.types` contains `"number"`,
   `fieldStats.currency.sampleValues` contains `"GBP"`, etc.
2. `readCatalogState` parses each event's JSON Schema (via `schemaPath`
   in the catalog frontmatter) into a map of declared `types` and `enum`
   values per path.
3. `diffCatalogAgainstSnapshot` cross-joins the two: any path whose
   observed runtime type is not in the declared types becomes a
   `typeDrift` entry; any sample value not in the declared enum becomes
   a `valueDrift` entry. Both feed `countDriftReport` and the markdown
   renderer.

You can now pass first-class Zod metadata from `track()` call sites (via
`defineEvent(...)` in `autotel`) so contracts can be declared in code and
propagated into runtime snapshots.

## Public JSON contract

Four versioned JSON shapes are shipped with the package as JSON Schema
files (`schemas/` directory). Downstream tooling (your own GitHub Actions,
dashboards, Slack bots) should validate against these:

| Schema                                 | Emitted by                      | Consumed by                              |
| -------------------------------------- | ------------------------------- | ---------------------------------------- |
| `schemas/drift-report-v0.2.0.json`     | `drift --format json`           | Any downstream parser                    |
| `schemas/drift-summary-v0.2.0.json`    | `drift --summary-output ...`    | CI gating, dashboards                    |
| `schemas/stamp-summary-v0.1.0.json`    | `stamp --summary-output ...`    | "Did this PR forget to re-stamp?" checks |
| `schemas/generate-summary-v0.1.0.json` | `generate --summary-output ...` | scaffold/edge generation auditing        |

Every envelope carries a `spec: 'autotel-eventcatalog-…/vX.Y.Z'` field
that downstream code can use to refuse unknown major versions. The shapes
are locked by golden contract tests inside this package: a PR that
changes them without bumping the spec version will fail CI.

## Renderers (advanced)

`drift --format <name>` dispatches through a small renderer registry. The
built-ins are `markdown`, `terminal`, `json`, `eventcatalog-snapshot-diff`.
The registry is exported
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
two findings, including a deliberately-introduced `personalization_seed`
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
