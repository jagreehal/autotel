# Upgrading

The package follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
for the **npm package version** and for the **JSON contract version**
(the `vX.Y.Z` segment in each schema's `$id`).

These two versions usually move together but are conceptually
independent. The npm version changes when _any_ user-facing thing
changes (CLI flags, library exports, action inputs). The contract
version changes only when one of the **three published JSON shapes**
changes.

## Quick reference

| Change                                          | npm version | Contract version                 |
| ----------------------------------------------- | ----------- | -------------------------------- |
| Bug fix, internal refactor                      | patch       | unchanged                        |
| New optional CLI flag, new library export       | minor       | unchanged                        |
| New optional field in a JSON output             | minor       | minor                            |
| Renamed / removed JSON field, changed JSON type | major       | major                            |
| Removed CLI flag, removed library export        | major       | unchanged (if JSON shape stable) |
| Changed CLI exit code semantics                 | major       | unchanged                        |

## Reading the version

Three places to look:

1. **`package.json`**: the npm version. `pnpm list autotel-eventcatalog`
   from your project root.
2. **The `spec:` field on every JSON output**: the contract version.
3. **The schema URLs** in `schemas/`: the contract version, with
   `https://autotel.dev/schemas/...` so downstream tooling can validate
   without depending on the npm package.

## Patch upgrade (e.g. `0.1.0 → 0.1.1`)

Bug fixes, internal refactors, dependency updates.

**What you do:** `pnpm update autotel-eventcatalog`. Nothing else.

**What might happen:** Behaviour changes that you weren't relying on
(e.g. an error message wording, the order of items in stderr logs).
Real public-API behaviour is preserved.

## Minor upgrade (e.g. `0.1.0 → 0.2.0`)

New optional CLI flags, new optional fields in JSON outputs, new
renderers in the registry, new exported types or functions.

**What you do:** `pnpm update autotel-eventcatalog`.

**What might happen:**

- A new field shows up in the JSON output. Existing parsers that ignore
  unknown fields keep working. Parsers that explicitly reject unknown
  fields (some strict schema validators) need to bump the schema they
  validate against.
- A new renderer becomes available via `--format`. Existing `--format
markdown` / `--format json` calls keep working.
- A new library export exists. Existing imports keep working.

**Validating after a minor JSON upgrade**

If you're using a strict validator (`additionalProperties: false` in
your own schema, for example), you'll want to point it at the new
schema file:

```diff
- import schema from 'autotel-eventcatalog/schemas/drift-summary-v0.1.0.json';
+ import schema from 'autotel-eventcatalog/schemas/drift-summary-v0.2.0.json';
```

If you're using `oneOf` on the `spec:` field, add the new value:

```diff
  if (![
    'autotel-eventcatalog-drift-summary/v0.1.0',
+   'autotel-eventcatalog-drift-summary/v0.2.0',
  ].includes(summary.spec)) {
    throw new Error(`Unknown drift summary version: ${summary.spec}`);
  }
```

## Major upgrade (e.g. `0.x → 1.0.0` or `1.x → 2.0.0`)

Breaking changes: renamed JSON fields, removed CLI flags, changed
behaviour.

**What you do:** read the CHANGELOG, update your code or workflow, then
`pnpm update autotel-eventcatalog`.

Major upgrades within `0.x` (e.g. `0.1.0 → 0.2.0` if it ever ships as a
breaking change) are signalled by the **JSON contract spec version**,
not just by the npm version. The package version may bump in lockstep,
but the contract version is what your downstream consumers need to know
about.

**A worked example.** Imagine v1.0.0 renames `counts.total` to
`counts.findings` in the drift summary. Steps:

1. **Detect the mismatch.** Your consumer's `spec:` check catches it:

   ```typescript
   if (summary.spec !== 'autotel-eventcatalog-drift-summary/v0.1.0') {
     throw new Error(
       `Drift summary spec ${summary.spec} is not v0.1.0; refusing to parse.`,
     );
   }
   ```

   The throw is the signal to read the upgrade notes.

2. **Read the CHANGELOG** for the new version.

3. **Update your consumer code:**

   ```diff
   - if (summary.counts.total > 0) { ... }
   + if (summary.counts.findings > 0) { ... }
   ```

4. **Update the spec check** to allow the new version.

5. **Update the schema file you validate against**, if any.

6. **Bump the npm package** in your `package.json`.

## Detecting an unexpected version

The `spec:` field is your defence against silent shape changes. Every
JSON envelope this package produces carries it. Downstream tooling
should always check it before parsing.

Pattern: explicit allowlist of accepted spec values, with a clear
error message when something unexpected lands.

```typescript
const ACCEPTED_SPECS = new Set([
  'autotel-eventcatalog-drift-summary/v0.1.0',
  // Add new minors here as you update; reject anything else.
]);

function parseSummary(json: string): DriftSummary {
  const parsed = JSON.parse(json);
  if (!ACCEPTED_SPECS.has(parsed.spec)) {
    throw new Error(
      `Drift summary spec "${parsed.spec}" is not in the accepted set. ` +
        `Read the autotel-eventcatalog CHANGELOG and update this consumer.`,
    );
  }
  return parsed as DriftSummary;
}
```

This is intentionally noisy. A silent fallback to "best effort parse"
is exactly how downstream consumers lose track of contracts.

## Renderer compatibility

The CLI's `--format` flag accepts any name registered in the renderer
registry. Adding a new renderer is a **minor** bump (it doesn't break
existing callers). Removing a renderer would be a **major** bump
(callers using `--format <removed>` would fail).

The built-in renderers (`markdown`, `terminal`, `json`) are intended to
stay forever. If a future major version retires one of them, the
CHANGELOG will name the migration target.

## Action upgrade

The GitHub Action uses semver via the `package-version` input. Default
is `^0`, major-version-pinned to v0.

When v1.0.0 ships, your workflow keeps running on the latest v0 release
until you explicitly opt in:

```yaml
- uses: jagreehal/autotel-eventcatalog@v0 # always latest v0
- uses: jagreehal/autotel-eventcatalog@v1 # opt into v1
- uses: jagreehal/autotel-eventcatalog@v0.1.0 # pin exactly
```

Inside the action itself, the `package-version` input controls which
npm release runs:

```yaml
- uses: jagreehal/autotel-eventcatalog@v0
  with:
    package-version: '0.1.0' # exact pin
    # OR
    package-version: '^0.1' # minor-range
```

## When in doubt

- The CHANGELOG is the source of truth for what changed.
- The schemas in `schemas/` are the source of truth for the JSON shape.
- The `spec:` field is the source of truth for which schema a given
  output matches.

If something looks like an undocumented breaking change, file an
issue; that's a bug in the release process, not in your code.
