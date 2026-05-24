# The public JSON contract

`autotel-eventcatalog` ships **four versioned JSON shapes** as published
JSON Schema files. Downstream tooling (your own GitHub Actions,
dashboards, Slack bots, custom CI checks) should read these.

| Schema file                                                                       | Produced by                        | Spec field                                     |
| --------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------- |
| [`schemas/drift-report-v0.2.0.json`](../schemas/drift-report-v0.2.0.json)         | `drift --format json`              | `autotel-eventcatalog-report/v0.2.0`           |
| [`schemas/drift-summary-v0.2.0.json`](../schemas/drift-summary-v0.2.0.json)       | `drift --summary-output <path>`    | `autotel-eventcatalog-drift-summary/v0.2.0`    |
| [`schemas/stamp-summary-v0.1.0.json`](../schemas/stamp-summary-v0.1.0.json)       | `stamp --summary-output <path>`    | `autotel-eventcatalog-stamp-summary/v0.1.0`    |
| [`schemas/generate-summary-v0.1.0.json`](../schemas/generate-summary-v0.1.0.json) | `generate --summary-output <path>` | `autotel-eventcatalog-generate-summary/v0.1.0` |

Each envelope carries a `spec:` field. Downstream code should refuse to
parse an unknown major version.

## Why this matters

Without a versioned contract, every JSON field becomes implicit API
surface. A refactor that renames `shouldFail` to `failing` silently breaks
every downstream consumer.

With a versioned contract:

- The schemas are the canonical shape; they live in this package and in
  the published npm artifact.
- The byte-equal golden fixtures in `src/__fixtures__/` make accidental
  shape changes fail CI inside this package.
- The `spec:` field gives downstream consumers a single string to gate
  on.

## Version policy

We follow semver on the schema's URL path (`v0.1.0`):

- **Minor bump** (`v0.1.0` → `v0.2.0`): adds optional fields. Existing
  consumers continue to parse new output. Producer adds the field with a
  sensible default.
- **Major bump** (`v0.1.0` → `v1.0.0`): breaks shape by renaming,
  removing, or changing types. Existing consumers should detect via
  `spec` and refuse to parse.
- **Patch** is not used. If a typo lands in a description we fix it
  in place; the shape is the contract, not the prose.

In v0, fields _will_ be added (we'll move from `v0.1.0` → `v0.2.0` when
we add SARIF-friendly fields, for example). The shape will not be broken
inside v0; breaking changes wait for v1.

## Schema details

### `drift-summary-v0.2.0`

Use this for **CI gating**. It's the smallest, most stable shape.

```json
{
  "spec": "autotel-eventcatalog-drift-summary/v0.2.0",
  "mode": "all",
  "shouldFail": true,
  "reason": "Drift detected in current snapshot.",
  "counts": {
    "observedButUndocumentedEvents": 0,
    "documentedButUnseenEvents": 1,
    "fieldDriftEvents": 1,
    "fieldDriftPaths": 1,
    "undocumentedServices": 0,
    "undocumentedChannels": 0,
    "total": 2
  }
}
```

**Field-by-field:**

- `mode`: which policy was applied. `"all"` = fail on any drift in the
  current snapshot. `"new-only"` = fail only on drift introduced
  compared to a base snapshot. Knowing this is useful for downstream
  consumers that want to render a different message per mode.
- `shouldFail`: the gating boolean. This is what your CI step ultimately
  decides on. Always reflects the policy you asked for; the CLI's exit
  code only differs if `--fail-on-drift` was set.
- `reason`: a short human-readable explanation. Suitable for Slack
  posts, log lines, or PR status descriptions.
- `counts.total`: the headline number. Matches the dashboard "N
  findings" badge: sums of all individual paths (not events).
- `counts.fieldDriftEvents` vs `counts.fieldDriftPaths`: the distinction
  matters. If three events each have two extra fields, `fieldDriftEvents:
3` but `fieldDriftPaths: 6`.

### `stamp-summary-v0.1.0`

Use this to gate **"did this PR forget to re-stamp?"** checks.

```json
{
  "spec": "autotel-eventcatalog-stamp-summary/v0.1.0",
  "dryRun": false,
  "attempted": 4,
  "skipped": 0,
  "inserts": 0,
  "replaces": 4,
  "changedFiles": 0,
  "hadChanges": false
}
```

**Field-by-field:**

- `attempted`: every snapshot event the stamper considered.
- `skipped`: snapshot events with no matching catalog entry.
- `inserts` vs `replaces`: first-time stamps vs. updating an existing
  marked block.
- `changedFiles` vs `replaces`: a replace might produce _identical_
  content if the snapshot hasn't changed. `changedFiles` only counts
  files whose bytes differ. This is the field to gate on.
- `hadChanges`: convenience boolean for `changedFiles > 0`. If your CI
  has just run `stamp` and `hadChanges === true`, the PR forgot to
  commit the freshly-stamped catalog. Fail it.

### `drift-report-v0.2.0` (the full envelope)

Use this when you need the full structured findings, not just counts.

```json
{
  "spec": "autotel-eventcatalog-report/v0.2.0",
  "mode": "all",
  "report": {
    "snapshotGeneratedAt": "2026-05-22T00:00:00.000Z",
    "snapshotService": "fixture",
    "events": {
      "observedButUndocumented": ["order.cancelled"],
      "documentedButUnseen": ["LegacyEvent"],
      "fieldDrift": [
        {
          "event": "recommendation.generated",
          "extra": ["personalization_seed"],
          "missing": []
        }
      ]
    },
    "services": { "observedButUndocumented": [] },
    "channels": { "observedButUndocumented": [] }
  }
}
```

When `--base-snapshot` is supplied (PR-style "what this change
introduces" mode), the envelope contains a `delta` instead of a `report`,
matching the schema's `oneOf` branch.

## Consuming the contract

### Option 1: read the spec, then trust the fields

The shortest workflow. Relies on the published schema for documentation,
not for runtime validation.

```typescript
const summary = JSON.parse(readFileSync('drift-summary.json', 'utf8'));
if (!summary.spec?.startsWith('autotel-eventcatalog-drift-summary/v0.')) {
  throw new Error(`Unsupported spec: ${summary.spec}`);
}
if (summary.shouldFail) {
  await slack.post(`${summary.counts.total} drift findings on this PR.`);
}
```

### Option 2: validate with ajv (or any JSON Schema validator)

```typescript
import Ajv from 'ajv';
import schema from 'autotel-eventcatalog/schemas/drift-summary-v0.2.0.json';

const ajv = new Ajv();
const validate = ajv.compile(schema);

const summary = JSON.parse(readFileSync('drift-summary.json', 'utf8'));
if (!validate(summary)) {
  throw new Error(
    `Drift summary failed validation: ${ajv.errorsText(validate.errors)}`,
  );
}
```

The schemas use only standard JSON Schema 2020-12 features, so any
mainstream validator works.

### Option 3: TypeScript types from the package

If you're already in a TypeScript project, the package exports the types:

```typescript
import type {
  DriftReport,
  DriftDelta,
  DriftCounts,
  JsonReportEnvelope,
} from 'autotel-eventcatalog';

function describe(report: JsonReportEnvelope): string {
  if (report.mode === 'all') {
    return `${report.report.events.observedButUndocumented.length} new events`;
  }
  return `${report.delta.introduced.events.observedButUndocumented.length} new events`;
}
```

## Consumer recipes

### A custom GitHub Action step that posts the count to Slack

```yaml
- uses: jagreehal/autotel-eventcatalog@v0
  id: drift
  with:
    snapshot: ./services/test/snapshot.json
    catalog: ./catalog

- name: Slack ping when drift exists
  if: steps.drift.outputs.drift-detected == 'true'
  run: |
    SUMMARY=$(cat "${{ runner.temp }}/autotel-eventcatalog-summary.json")
    COUNT=$(node -e "console.log(JSON.parse(process.argv[1]).counts.total)" "$SUMMARY")
    curl -X POST -H 'Content-Type: application/json' \
      -d "{\"text\":\"⚠️ ${COUNT} drift findings on PR #${{ github.event.number }}\"}" \
      "${{ secrets.SLACK_WEBHOOK }}"
```

### A nightly dashboard that polls the snapshot

Render the JSON envelope into your own UI. Validate the `spec:` field on
load; refuse to render anything you don't recognise.

```typescript
const res = await fetch('https://my-runner/drift.json');
const envelope = await res.json();
if (envelope.spec !== 'autotel-eventcatalog-report/v0.2.0') {
  return showVersionMismatchBanner(envelope.spec);
}
renderReport(envelope.report);
```

### A pre-commit hook that fails when stamps are stale

```bash
#!/usr/bin/env bash
SUMMARY=$(mktemp)
npx autotel-eventcatalog stamp \
  --snapshot ./services/test/snapshot.json \
  --catalog ./catalog \
  --summary-output "$SUMMARY"
HAD_CHANGES=$(jq -r .hadChanges "$SUMMARY")
if [ "$HAD_CHANGES" = "true" ]; then
  echo "✗ Catalog stamp is stale. Run 'pnpm catalog:stamp' and commit."
  exit 1
fi
```

## What is NOT part of the contract

Things downstream consumers should _not_ depend on:

- **Stdout output** of `drift` and `stamp`. It's for humans reading
  terminal output. Use `--output <path>` or `--summary-output <path>`
  if you need a stable target.
- **Exit code beyond 0/1/2/other**. We document `0` = clean, `1` =
  drift (with `--fail-on-drift`), `2` = bad arguments. Anything else
  is a hard CLI error and the contract is "tell the user."
- **Markdown formatting details**: bullet style, exact section headings,
  line breaks. Parse the JSON if you need structure; markdown is for
  humans.
- **File paths in `StampUpdate.filePath`**. They're absolute on the
  emitting machine. If you need stable identifiers, use `catalogId`.
- **Order of array elements** unless explicitly stated. Field paths in
  `DriftCounts` are sorted; event lists are sorted by name; `fieldDrift`
  entries are sorted by event. Anything else is implementation-defined.

If you're depending on something not listed in a schema and not
documented here, file an issue. We'll either bake it into the contract
or help you find another way.
