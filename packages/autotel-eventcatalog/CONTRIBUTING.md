# Contributing to autotel-eventcatalog

A short, opinionated guide. The package is small enough that you can read all
of it in an afternoon; this doc is here so you don't have to.

## Where things live

```
packages/autotel-eventcatalog/
├── src/
│   ├── snapshot.ts          load + type-check an autotel architecture snapshot
│   ├── catalog.ts           read the catalog from disk (POSIX-normalised paths)
│   ├── diff.ts              compute drift between snapshot and catalog (pure)
│   ├── diff-vs-base.ts      compute drift delta (PR head vs base) (pure)
│   ├── policy.ts            "should this drift fail CI?" (pure)
│   ├── stamp.ts             write runtime evidence into catalog mdx files
│   ├── renderers/           render adapters
│   │   ├── types.ts         the Renderer interface
│   │   ├── markdown.ts      Markdown (GitHub-flavoured), the default
│   │   ├── terminal.ts      plain text (decorations stripped)
│   │   ├── json.ts          versioned envelope; the public JSON contract
│   │   └── index.ts         registry + getRenderer(name)
│   ├── report.ts            backwards-compat re-export shim over renderers/
│   ├── cli.ts               argument parsing + command dispatch + I/O
│   ├── __fixtures__/        golden JSON files for contract tests
│   └── *.test.ts            unit tests
│   └── cli.e2e.test.ts      e2e tests (spawn the built CLI)
│   └── contract.test.ts     versioned-JSON contract tests
├── schemas/
│   ├── drift-report-v0.1.0.json
│   ├── drift-summary-v0.1.0.json
│   └── stamp-summary-v0.1.0.json
├── action.yml               composite GitHub Action (used by external repos)
├── docs/                    this folder
└── README.md
```

## Module dependency rules

The DAG is one-way by design:

```
snapshot.ts ──┐
              ├──► diff.ts ──► diff-vs-base.ts ──► policy.ts
catalog.ts ───┤                                    ▲
              │                                    │
              ├──► stamp.ts                        │
              │                                    │
              └────► renderers/ ◄──────────────────┘

cli.ts ─► everything (the only place all branches meet)
```

**Rules:**

1. `diff.ts` / `diff-vs-base.ts` / `policy.ts` import only from each other,
   `snapshot.ts`, and `catalog.ts`. They never import a renderer.
2. `renderers/*` import from the core but the core never imports a renderer.
3. `cli.ts` is the dispatcher; nothing else imports from `cli.ts`.
4. `stamp.ts` is independent of `diff.ts`. They share inputs but no logic.

If a future change wants to break one of these rules, that's the signal to
stop and ask whether the new feature belongs in this package.

## Load-bearing invariants

These are the rules I'd commit to keeping. Future-me, future-contributors:
when in doubt, push back.

### 1. No new top-level commands without a user

The CLI has two: `drift` (verify) and `stamp` (generate). Three would be
the limit before splitting `cli.ts` into per-command modules. Four is the
signal to question whether the third and fourth belong in this package
at all.

A new command needs:

- A user with a concrete workflow that demands it
- Tests proving the behaviour
- A docs entry explaining when to reach for it

A new command does NOT need:

- "It would be nice to have"
- "Just in case"
- "While I'm in here"

### 2. No runtime servers, daemons, watchers, or LSPs

This package is a CLI plus library plus composite GitHub Action. It runs,
does its job, and exits. Anything that needs to stay running (a live
dashboard, a file watcher, an LSP server, an MCP server, a webhook
listener) lives in [`autotel-subscribers`](../autotel-subscribers/) or in
example apps.

The reason: long-running processes have a different lifecycle from
command-line tools. Process management, signal handling, restart
semantics, observability. Mixing the two doubles the operational surface
for no clarity gain.

### 3. No domain-specific extensions to the core

`diff.ts`, `diff-vs-base.ts`, and `policy.ts` work at one abstraction:
events, services, channels, field paths. Adding a SARIF renderer should
never require a `severity` field on `DriftCounts`. Adding a Slack
renderer should never require a `messageColor` field on `DriftReport`.

If a new renderer wants information that doesn't fit the existing types,
the renderer should derive it locally, not push back into the core. If
multiple renderers want the same derived information, _then_ it earns a
place in `diff.ts`. Pause and confirm it's about drift, not about
presentation.

## How to do common things

### Run the tests

```bash
pnpm test          # unit tests, fast, no build required
pnpm test:e2e      # builds dist/, spawns the CLI, checks exit codes
pnpm test:watch    # unit tests in watch mode
pnpm quality       # type-check + unit + e2e + lint + format
```

### Add a renderer

See [docs/EXTENDING.md](docs/EXTENDING.md) for the full walkthrough. Short
version: create `src/renderers/<name>.ts` that exports a `Renderer`,
register it in `src/renderers/index.ts`, write tests that round-trip the
shape, document it in the README.

### Change the public JSON shape

You can't change it silently. The `schemas/*.json` files and the
byte-equal golden fixtures in `src/__fixtures__/*.golden.json` will fail
CI on any shape change. Either:

- **Add an optional field**: bump the schema's _minor_ version (`v0.1.0` →
  `v0.2.0`). Add the field with sensible defaults so existing consumers
  keep working. Update goldens.
- **Break the shape** (rename a field, change a type, remove a field):
  bump the schema's _major_ version (`v0.1.0` → `v1.0.0`). Document the
  migration. Old consumers should refuse to parse the new envelope by
  checking the `spec` field.

The `spec` field on every envelope is your one-way out.

### Add a CLI flag

Update the parser in `cli.ts`, add it to the usage string, write an e2e
test that exercises it (`cli.e2e.test.ts`). If it changes which output is
produced, also update the golden fixture for that scenario.

### Add a new diff category

(e.g. "tags observed but undocumented"; hypothetical)

1. Add it to `DriftReport` in `diff.ts`
2. Compute it in `diffCatalogAgainstSnapshot`
3. Add it to `countDriftReport` in `diff.ts` so the total stays correct
4. Add it to every renderer in `src/renderers/`
5. Add it to the `DriftDelta` shape in `diff-vs-base.ts`
6. Add it to `countDriftEntries`
7. Bump the JSON schemas (probably minor)
8. Update golden fixtures
9. Tests for each of the above

New categories cost a lot. The reason this list is long is to make you
pause before adding one.

## Commit conventions

Conventional Commits. The monorepo uses changesets; every PR with a
public-API change should include a changeset file (`pnpm changeset`).

For changes inside this package:

- `feat(autotel-eventcatalog): ...` for new functionality
- `fix(autotel-eventcatalog): ...` for bug fixes
- `refactor(autotel-eventcatalog): ...` for internal restructuring
- `docs(autotel-eventcatalog): ...` for documentation only
- `chore(autotel-eventcatalog): ...` for build, deps, tooling

## Review checklist

Before opening a PR:

- [ ] `pnpm quality` passes locally
- [ ] If the public JSON shape changed, schema + golden fixtures + spec
      version are all updated together
- [ ] If a new CLI flag landed, the usage string and e2e tests reflect it
- [ ] If a renderer landed, it's in the registry and has tests
- [ ] If the action.yml changed, any input default change is documented
      in the README's action snippet
- [ ] Changeset present (`pnpm changeset`)
- [ ] The README's "What this package does NOT do" boundary is still true

## Questions worth asking before adding anything

- Could this live in a downstream consumer instead of in this package?
- Is the new code reachable from an existing path, or is it a fork in the
  road? (Forks are fine, but be deliberate.)
- Will the next contributor be confused about whether to put related code
  with the existing thing or with the new thing? (If yes, the new thing
  is in the wrong place.)
- Does this require a long-running process? (See invariant #2.)
- Does this require breaking the renderer-as-adapter pattern? (See
  invariant #3.)

If you can't comfortably answer "no" or "this is fine", open an issue
first.
