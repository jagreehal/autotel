# @autotel/book-chapters

## 1.0.16

### Patch Changes

- Updated dependencies [7a2f38c]
  - autotel-devtools@23.0.0
  - autotel@7.2.0
  - autotel-genai@0.7.1
  - autotel-subscribers@52.0.0

## 1.0.15

### Patch Changes

- Updated dependencies [559ec46]
  - autotel@7.1.0
  - autotel-genai@0.7.0
  - autotel-devtools@22.0.0
  - autotel-subscribers@51.0.0

## 1.0.14

### Patch Changes

- Updated dependencies [4c859aa]
  - autotel-genai@0.6.2
  - autotel@7.0.1
  - autotel-devtools@21.0.1
  - autotel-subscribers@50.0.1

## 1.0.13

### Patch Changes

- Updated dependencies [d303348]
  - autotel@7.0.0
  - autotel-subscribers@50.0.0
  - autotel-devtools@21.0.0
  - autotel-genai@0.6.1

## 1.0.12

### Patch Changes

- Updated dependencies [ee8accb]
  - autotel-devtools@20.1.0

## 1.0.11

### Patch Changes

- Updated dependencies [31fd178]
- Updated dependencies [31fd178]
  - autotel-devtools@20.0.1
  - autotel-genai@0.6.0

## 1.0.10

### Patch Changes

- Updated dependencies [e8f2d0f]
  - autotel-genai@0.5.0
  - autotel@6.5.0
  - autotel-devtools@20.0.0
  - autotel-subscribers@49.0.0

## 1.0.9

### Patch Changes

- Updated dependencies [b37813b]
  - autotel-devtools@19.1.0
  - autotel@6.4.1
  - autotel-genai@0.4.2
  - autotel-subscribers@48.0.1

## 1.0.8

### Patch Changes

- Updated dependencies [09888cd]
  - autotel@6.4.0
  - autotel-devtools@19.0.0
  - autotel-genai@0.4.1
  - autotel-subscribers@48.0.0

## 1.0.7

### Patch Changes

- Updated dependencies [fb6bee2]
  - autotel@6.3.0
  - autotel-genai@0.4.0
  - autotel-devtools@18.0.0
  - autotel-subscribers@47.0.0

## 1.0.6

### Patch Changes

- Updated dependencies [7bad202]
  - autotel@6.2.1
  - autotel-devtools@17.1.1
  - autotel-genai@0.3.12
  - autotel-subscribers@46.0.1

## 1.0.5

### Patch Changes

- Updated dependencies [f0d521f]
  - autotel-devtools@17.1.0

## 1.0.4

### Patch Changes

- 0f518c6: Put every _Observability Engineering_ chapter example under CI, and make the two
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

- Updated dependencies [0f518c6]
- Updated dependencies [0f518c6]
- Updated dependencies [0f518c6]
- Updated dependencies [0f518c6]
  - autotel@6.2.0
  - autotel-devtools@17.0.0
  - autotel-genai@0.3.11
  - autotel-subscribers@46.0.0

## 1.0.3

### Patch Changes

- Updated dependencies [85a0e88]
  - autotel@6.1.0
  - autotel-devtools@16.0.0
  - autotel-genai@0.3.10
  - autotel-subscribers@45.0.0

## 1.0.2

### Patch Changes

- Updated dependencies [756345d]
- Updated dependencies [756345d]
  - autotel@6.0.0
  - autotel-devtools@15.0.0
  - autotel-genai@0.3.9
  - autotel-subscribers@44.0.0

## 1.0.1

### Patch Changes

- Updated dependencies [9030f83]
  - autotel@5.0.0
  - autotel-genai@0.3.8
  - autotel-devtools@14.0.0
  - autotel-subscribers@43.0.0
