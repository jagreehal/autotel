---
name: autotel-eventcatalog
description: >
  Use this skill when keeping an EventCatalog honest against runtime behaviour — the autotel-eventcatalog drift command to diff the catalog against an autotel snapshot in CI, generate to scaffold catalog resources from a snapshot, or stamp to write runtime evidence into event pages.
---

# autotel-eventcatalog

Diffs your [EventCatalog](https://www.eventcatalog.dev) against what the code actually does at runtime. The `ArchitectureSnapshotSubscriber` from `autotel-subscribers` records a `snapshot.json` during a test run — every event that fired, its payload fields and runtime types, its producer and channel. This package reads that snapshot and compares it to the catalog.

It consumes snapshots; it does not produce them. It runs no web server. It touches catalog files only between its stamp markers.

## When to use

- Fail a PR when someone adds an event but forgets to document it (`drift`).
- Scaffold catalog resources from an existing snapshot (`generate`).
- Keep event pages showing real runtime counts and last-seen (`stamp`).

## Commands

| Command    | Mode      | Does                                                                       |
| ---------- | --------- | -------------------------------------------------------------------------- |
| `drift`    | read-only | Diffs catalog against snapshot; reports Markdown/JSON/text. The PR check.  |
| `generate` | write     | Scaffolds services, events, channels, inferred schemas, and relationships. |
| `stamp`    | write     | Writes a runtime evidence block into each event's `index.mdx`.             |

All three take an autotel snapshot JSON and an EventCatalog directory, and ship a versioned JSON summary you can gate CI on.

## Core patterns

### Drift check in CI

```bash
npx autotel-eventcatalog drift --snapshot snapshot.json --catalog ./catalog --format markdown
```

`drift` also ships as a one-line GitHub Action with a sticky PR comment. Field-path drift is set-difference on dotted paths; type/value drift is checked against declared schema constraints.

### Scaffold from a snapshot

```bash
npx autotel-eventcatalog generate --snapshot snapshot.json --catalog ./catalog
```

### Stamp runtime evidence

```bash
npx autotel-eventcatalog stamp --snapshot snapshot.json --catalog ./catalog
```

`stamp` writes only between `<!-- autotel:stamp-start -->` and `<!-- autotel:stamp-end -->`. Everything outside those markers stays yours.

## Common mistakes

### HIGH: Expecting drift without a snapshot

The snapshot comes from `autotel-subscribers`'s `ArchitectureSnapshotSubscriber` during a test run. Wire that subscriber first, or `drift` has nothing to compare.

### MEDIUM: Editing inside the stamp markers by hand

`stamp` overwrites everything between its markers on the next run. Put your own prose outside them.

## Related

- `autotel-subscribers` — produces the snapshot this package reads.
- `autotel-pact` — the same evidence model for HTTP/message contracts.

## Version

CLI plus library plus GitHub Action. Consumes snapshots from `autotel-subscribers`.
