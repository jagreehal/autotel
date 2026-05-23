# Troubleshooting

## Exit codes

The `drift` CLI exits with a documented set of codes:

| Code  | Meaning        | When                                                               |
| ----- | -------------- | ------------------------------------------------------------------ |
| `0`   | Clean          | No drift, OR drift exists but `--fail-on-drift` was not set        |
| `1`   | Drift detected | `--fail-on-drift` was set AND the policy decided this is a failure |
| `2`   | Bad arguments  | Missing required flag, unknown flag, invalid value                 |
| other | Hard error     | The CLI itself crashed; surface the stderr                         |

The `stamp` CLI exits `0` on success, `2` on bad arguments. It does not
have a drift-style failure mode; it either writes or it doesn't.

**If you wrap the CLI in a script:** check for codes 0/1 as expected
behaviour and treat anything else as a hard error to surface. The
[bundled action](../action.yml) does exactly this.

## Common errors

### "Both --snapshot and --catalog are required."

You omitted one of the two required arguments. Either is fine to forget;
the message says which.

### "--policy new-only requires --base-snapshot."

`--policy new-only` compares your current snapshot against a baseline.
Without a baseline, there's no "new" to compute. Either:

- Drop `--policy new-only` (defaults to `all` without a baseline), or
- Add `--base-snapshot <path>` pointing to the baseline snapshot.

In the GitHub Action, the baseline is fetched automatically from the PR's
base branch; supply `base-ref: origin/${{ github.base_ref }}`.

### "Invalid --format value: foo. Available renderers: markdown, terminal, json."

`--format` accepts a renderer name registered in
`src/renderers/index.ts`. If you added a custom renderer, it needs to be
in `RENDERERS`. See [EXTENDING.md](EXTENDING.md).

### "autotel-eventcatalog did not produce a summary output."

The action's drift step expected `--summary-output` to write a file but
couldn't find it after the CLI exited. The CLI itself probably crashed
_before_ writing the summary. Check stderr in the job log; the error
is up there.

### "Not an autotel architecture snapshot (missing spec marker)"

The file you passed to `--snapshot` doesn't look like a snapshot. It
needs to:

- Be valid JSON
- Have a `spec` field starting with `autotel-architecture/`

If the file is empty or zero-bytes, the snapshot subscriber probably
didn't run. Verify your test suite (or whatever produces the snapshot)
finished and wrote to disk before the CLI ran.

### Drift CLI reports events I expect to be in the catalog

The catalog reader walks `<catalog>/**/index.mdx` looking for an `id:`
field in the frontmatter. If your event mdx files use a different
filename or don't have proper frontmatter, they're invisible.

Check:

1. The event mdx file is named `index.mdx` (not `event.mdx`, not
   `OrderPlaced.mdx`).
2. The path matches `.../events/<X>/index.mdx`.
3. The frontmatter has an `id:` (matched case-insensitively, with dots
   and underscores normalised).

### Drift CLI doesn't see field-path drift even though I know it exists

Field-path drift is only computed for events with a `schemaPath:` in
their frontmatter. If your event mdx doesn't declare a schema, the
field-path check is skipped (you'll only get existence checks).

To enable field-path drift:

```yaml
---
id: OrderPlaced
schemaPath: schema.json # ← relative to the event mdx
---
```

The schema file needs to be a JSON Schema with `properties` keys and
(optionally) nested `items` for arrays.

### Stamp output looks weird / duplicated

Stamps are scoped to the markers:

```
<!-- autotel:stamp-start -->
...
<!-- autotel:stamp-end -->
```

If you see duplicate stamp blocks, either:

- Someone manually copied the marker pair without realising they're
  load-bearing, or
- A previous run was interrupted before completing.

Fix: delete the malformed marker pair manually, then re-run `stamp`. The
stamp command will detect the first `<!-- autotel:stamp-start -->` and
the first `<!-- autotel:stamp-end -->` and replace between them; manual
cleanup is only needed if those don't bracket the block correctly.

### `pnpm catalog:stamp` failed but my catalog wasn't updated

`stamp` is mostly read-only (it reads the snapshot, reads the catalog,
plans what to write, then writes). If it fails mid-flight, you may
have a few files updated and the rest not.

The stamp summary JSON (`--summary-output`) tells you exactly which files
were inserts vs. replaces vs. skipped. Compare against your git status to
see what landed.

### The action posted no comment on my PR

Three possibilities:

1. **The repository doesn't allow comments from Actions.** Check
   `Settings > Actions > General > Workflow permissions`. Needs
   "Read and write permissions" or at least the `pull-requests: write`
   permission in the workflow file.
2. **The sticky-comment action failed.** With
   `continue-on-comment-failure: true` (the default), this is a
   warning, not a failure. Look for the warning in the job log.
3. **You're not running on a `pull_request` event.** The action only
   comments on PRs. On push events, it'll still run and write the
   summary file, but the comment step is skipped.

### "autotel-eventcatalog drift CLI failed with exit $STATUS"

Any non-0, non-1 exit code from the CLI surfaces as a hard error in the
action. Look for the CLI output above this line in the job log; the
CLI's stderr will explain.

## Debugging tips

### See exactly what the catalog reader found

Add this to your local script:

```typescript
import { readCatalogState } from 'autotel-eventcatalog';

const state = await readCatalogState('./catalog');
console.log('events:', [...state.events.keys()]);
console.log('services:', [...state.services.keys()]);
console.log('channels:', [...state.channels.keys()]);
```

If your event isn't listed, the reader didn't pick it up. Check the
filename, the frontmatter, and (on Windows) make sure the path
contains valid `services/.../events/` segments.

### See what the snapshot looked like

```bash
# Pretty-print, restricted to the event you care about:
node -e "const s=JSON.parse(require('fs').readFileSync('snapshot.json','utf8'));console.log(JSON.stringify(s.events['order.placed'],null,2))"
```

### Reproduce a CI failure locally

```bash
# Same flags the bundled action passes internally:
pnpm autotel-eventcatalog drift \
  --snapshot ./services/test/snapshot.json \
  --catalog ./catalog \
  --policy all \
  --output ./drift.md \
  --summary-output ./drift-summary.json \
  --fail-on-drift
echo "exit: $?"
cat drift-summary.json
```

If this reproduces locally with the same exit code and the same
summary, you've isolated the issue from CI-specific state.

### Reset to a known clean state

If you suspect the working tree has gone weird (e.g. partial stamp
runs), the surest reset is:

```bash
git restore apps/example-eventcatalog/catalog
git clean -fd apps/example-eventcatalog/catalog
pnpm services:snapshot
pnpm catalog:stamp
```

After that, `git status` should show the catalog unchanged. If it
doesn't, your snapshot has changed since the last commit; that's an
intended diff, not a tooling problem.

## Still stuck?

Open an issue with:

- The exact command you ran
- The stderr output (full)
- The exit code
- The `spec:` field from your snapshot, drift report, or stamp summary
- Your Node version and OS

Most issues turn out to be one of: missing frontmatter, missing
schemaPath, paths not normalised on Windows, or the action being asked
to comment without `pull-requests: write` permission.
