---
'autotel-eventcatalog': minor
---

The "get to 10" pass. Closes the review-board's outstanding watch items
and a couple they didn't surface.

**Public JSON contract.** Three versioned JSON Schemas ship with the
package: `schemas/drift-report-v0.1.0.json`,
`schemas/drift-summary-v0.1.0.json`, and
`schemas/stamp-summary-v0.1.0.json`. Each output envelope carries a
`spec:` field downstream consumers can read to refuse unknown major
versions. New `contract.test.ts` validates emitted output against the
schemas AND byte-compares against committed golden fixtures, so a PR
that silently changes a published field name now fails CI with a clear
message.

**Renderers as adapters.** The Markdown / Terminal / JSON renderers
moved into `src/renderers/` with a small `Renderer` interface and a
`getRenderer(name)` registry. The CLI's `--format` flag now dispatches
through the registry instead of hardcoding two cases — adding SARIF,
Slack-flavoured markdown, GitHub Check Runs API, etc. is a single new
file. The core diff and policy modules don't move and never reference
the registry. Backwards-compatible: `import { renderMarkdown } from
'autotel-eventcatalog'` still works.

**Action hardening.**
- `marocchino/sticky-pull-request-comment` pinned to a specific commit
  SHA (supply-chain control).
- A failure of the comment step is downgraded to a `::warning::` so the
  drift signal is never lost to a flaky GitHub API call. Behind
  `continue-on-comment-failure` input (defaults to `true`; set to
  `false` to keep the old behaviour).
- `package-version` default changed from `latest` to `^0` so a new
  major release doesn't silently land on user CI.

**README.** Opens with the dual-tool framing (drift verifier + stamp
generator). New "What this package does NOT do" boundary statement. New
"Public JSON contract" and "Renderers (advanced)" sections.

Backwards-compatible for every existing CLI and library consumer.

Total tests: 78 unit + 11 e2e (was 58 + 11 before this changeset).
