# autotel-nuxt

## 10.0.0

### Patch Changes

- Updated dependencies [7a2f38c]
  - autotel@7.2.0
  - autotel-adapters@2.0.12

## 9.0.0

### Patch Changes

- Updated dependencies [559ec46]
  - autotel@7.1.0
  - autotel-adapters@2.0.11

## 8.0.1

### Patch Changes

- Updated dependencies [4c859aa]
  - autotel@7.0.1
  - autotel-adapters@2.0.10

## 8.0.0

### Patch Changes

- Updated dependencies [d303348]
  - autotel@7.0.0
  - autotel-adapters@2.0.9

## 7.0.0

### Patch Changes

- Updated dependencies [e8f2d0f]
  - autotel@6.5.0
  - autotel-adapters@2.0.8

## 6.0.1

### Patch Changes

- Updated dependencies [b37813b]
  - autotel@6.4.1
  - autotel-adapters@2.0.7

## 6.0.0

### Patch Changes

- Updated dependencies [09888cd]
  - autotel@6.4.0
  - autotel-adapters@2.0.6

## 5.0.0

### Patch Changes

- Updated dependencies [fb6bee2]
  - autotel@6.3.0
  - autotel-adapters@2.0.5

## 4.0.1

### Patch Changes

- Updated dependencies [7bad202]
  - autotel@6.2.1
  - autotel-adapters@2.0.4

## 4.0.0

### Patch Changes

- 0f518c6: Refresh dependencies to their latest minor and patch releases, most notably the
  OpenTelemetry SDK (`0.220.x` → `0.221.x`, `2.9.x` → `2.10.x`).

  Majors are deliberately held back for a separate change, including TypeScript 7,
  pnpm 11, chalk 6, jsdom 30 and the ESLint toolchain.

- 0f518c6: Stop publishing source maps. Every package is roughly half the size it was.

  Published output across all packages drops from 18.7 MiB to 7.9 MiB. Installing
  `autotel` downloads 500 KiB gzipped instead of 1,130 KiB. Nothing about the
  shipped JavaScript or type declarations changed.

  Source maps were 55–65% of every package, because each source byte was emitted
  four times: once as ESM, once as CJS, and again inside each format's map, which
  embedded `sourcesContent`. They never reached a consumer's application bundle —
  bundlers read maps and discard them — so the cost was pure install weight in
  exchange for TypeScript stack traces under `node --enable-source-maps`.

  Best-in-class TypeScript libraries do not make that trade. Of fourteen surveyed,
  twelve publish no maps at all (zod, hono, pino, fastify, vitest, vite, rollup,
  undici, commander, tsdown, react, astro), and not one publishes `.d.ts.map`.
  The OpenTelemetry packages do ship maps at around 50% of their size, which is
  the convention this repo had been following.

  The `.d.ts.map` declaration maps were broken regardless: `sourcesContent: false`
  with sources pointing at `../src/*.ts`, which `files` never published, so they
  resolved to nothing on a consumer's machine.

  Maps are still generated for local development. `tsconfig.json` keeps
  `sourceMap` and `declarationMap` on; only `tsconfig.build.json` disables them,
  so debugging the workspace is unchanged.

  This also fixes the bundle-size gate, which had been amplifying every ordinary
  change by 4×. The three packages that were failing it (`autotel-backends` +43.9%,
  `autotel-mcp` +14.4%, `autotel-schema` +12.0%) were not bloated — that growth was
  legitimate new backend code, quadrupled by the build. The baseline is
  regenerated.

- Updated dependencies [0f518c6]
- Updated dependencies [0f518c6]
- Updated dependencies [0f518c6]
  - autotel@6.2.0
  - autotel-adapters@2.0.3

## 3.0.0

### Patch Changes

- Updated dependencies [85a0e88]
  - autotel@6.1.0
  - autotel-adapters@2.0.2

## 2.0.0

### Patch Changes

- 756345d: Skills no longer ship inside the npm package tarballs. They now live at the repo root under `skills/`, grouped into `core/`, `frameworks/`, `integrations/`, and `contributing/`, as a single source of truth discovered by the skills CLI (`npx skills add jagreehal/autotel --skill <name>`). `skills` is removed from each package's `files` field, so installing a package no longer adds its skill to `node_modules`. Install skills explicitly with the CLI instead.
- Updated dependencies [756345d]
- Updated dependencies [756345d]
  - autotel@6.0.0
  - autotel-adapters@2.0.1

## 1.0.0

### Patch Changes

- Updated dependencies [9030f83]
  - autotel@5.0.0
  - autotel-adapters@2.0.0

## 0.1.1

### Patch Changes

- Updated dependencies [100cfad]
  - autotel-adapters@1.0.0
