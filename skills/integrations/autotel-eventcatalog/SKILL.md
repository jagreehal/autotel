---
name: autotel-eventcatalog
description: >
  Use this skill when keeping an EventCatalog honest against runtime behaviour — the autotel-eventcatalog drift command to diff the catalog against an autotel snapshot in CI, generate to scaffold catalog resources from a snapshot, stamp to write runtime evidence into event pages, or map to draw the topology with each edge labelled by the evidence behind it.
---

# autotel-eventcatalog

Diffs your [EventCatalog](https://www.eventcatalog.dev) against what the code actually does at runtime. The `ArchitectureSnapshotSubscriber` from `autotel-subscribers` records a `snapshot.json` during a test run — every event that fired, its payload fields and runtime types, its producer and channel. This package reads that snapshot and compares it to the catalog.

It consumes snapshots; it does not produce them. It runs no web server. It touches catalog files only between its stamp markers.

## When to use

- Fail a PR when someone adds an event but forgets to document it (`drift`).
- Scaffold catalog resources from an existing snapshot (`generate`).
- Keep event pages showing real runtime counts and last-seen (`stamp`).
- Draw the topology so each relationship shows the evidence behind it (`map`).

## Commands

| Command    | Mode      | Does                                                                       |
| ---------- | --------- | -------------------------------------------------------------------------- |
| `drift`    | read-only | Diffs catalog against snapshot; reports Markdown/JSON/text. The PR check.  |
| `generate` | write     | Scaffolds services, events, channels, inferred schemas, and relationships. |
| `stamp`    | write     | Writes a runtime evidence block into each event's `index.mdx`.             |
| `map`      | read-only | Renders the topology as one self-contained HTML file, edges labelled.      |

All four take an autotel snapshot JSON and an EventCatalog directory, and ship a versioned JSON summary you can gate CI on.

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

### Draw the topology

```bash
npx autotel-eventcatalog map --snapshot snapshot.json --catalog ./catalog --output map.html
```

One self-contained HTML file, with every edge labelled by the evidence behind it:

| Edge state                  | Means                                                     |
| --------------------------- | --------------------------------------------------------- |
| **observed**                | A real `track()` call crossed it; stroke scales to volume |
| **declared, never seen**    | The catalog says it happens; this run never saw it        |
| **ran, not in the catalog** | It happened and nobody wrote it down                      |
| **consumer asserted**       | The event fired; its delivery is a claim from the catalog |

Three modes via `--mode`: `static` (commit it, read it in a PR), `replay` (markers move at a rate drawn from observed counts), and `live` (`--live-url <sse>`, and a marker crosses an edge the moment that event fires). Motion is reserved for evidence, so a declared-but-never-seen edge stays still in every mode.

`buildLiveMap()` and `renderLiveMapHtml()` are exported for building your own view, and `normaliseEventId()` matches dotted `track()` names to PascalCase catalog ids the same way the drift report does.

Counts are attributed per relationship from the snapshot's `sources` — one entry per `(producer, channel)` pair — so two services publishing the same event name each keep their own traffic. A snapshot written before that field is accepted, and the edge says its count is an event total.

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
