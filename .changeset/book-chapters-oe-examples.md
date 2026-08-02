---
'@autotel/book-chapters': patch
'autotel-docs': patch
---

Put every _Observability Engineering_ chapter example under CI, and make the two
LLM chapters call a real model.

`pnpm test` ran `run-all.mjs`, which iterated a hardcoded list of the twenty
numbered chapters. The ten `oe-*` examples ran only under `test:oe`, which
nothing invoked — `ci.yml` runs `pnpm test`. Every chapter example touching
`autotel/analysis`, `autotel/slo` and `autotel/sampling` was outside CI, so a
regression in any of them would have gone green. One runner now globs the
directory, so a new example is covered the moment it lands.

Chapters 21 and 22 hand-wrote their evidence: a literal `inputTokens: 120` and a
hardcoded 620 ms time-to-first-token. A chapter about measuring model behaviour
that invents its own numbers measures nothing. Both now run against Ollama on
localhost through `registerTelemetry(autotelTelemetry())`, reading token usage
and `gen_ai.response.time_to_first_chunk` off the emitted spans. With no model
reachable they print what they need and exit 0 rather than falling back to
invented figures, so CI stays green and no run prints a number that came from
the repo instead of a span.

Adds `oe-05-structured-events.ts` for chapter 5, which had no example, and
rewrites `oe-15-sampling.ts` to walk the chapter's full nine-rung sampling
ladder instead of two rungs. Adds a README carrying the chapter mapping, which
previously lived only in an untracked file.

Also upgrades the docs app to Astro 7 and Starlight 0.41, and drops the explicit
`markdown.gfm` config that Astro 7 no longer needs.

Removes the `overrides` block from `pnpm-workspace.yaml`. It capped `vite` below
8 and `@vitejs/plugin-react` at 5.x to protect an Astro 6 docs build, but pnpm
was ignoring it: root `package.json` already declares `pnpm.overrides`, and pnpm
reads one source, so the workspace-yaml block never applied. `vite@8.1.5` and
`@vitejs/plugin-react@6.0.4` install today in spite of it. Deleting the block
regenerates a byte-identical lockfile, and the failure it described — per-route
CSS emitted but never linked into `<head>` — does not reproduce on Astro 7,
which depends on `vite ^8.0.13` regardless.
