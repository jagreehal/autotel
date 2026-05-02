# autotel-drizzle

## 0.0.12

### Patch Changes

- 5d05a3e: Add Cloudflare Workers support to main `autotel` package. Introduces `autotel/workers` and `autotel/cloudflare` entry points that re-export the functional API and Cloudflare-specific instrumentation from `autotel-cloudflare`, providing better DX for Cloudflare users while keeping the core package modular. Updates package exports, build config, and documentation.
- Updated dependencies [5d05a3e]
  - autotel@3.0.1

## 0.0.11

### Patch Changes

- c1b5f60: - `autotel-drizzle`: add `db.statement.hash` span attribute so SQL queries can be grouped even when statement text capture is disabled.
  - `autotel-mcp`: improve Jaeger parent span mapping via `references[].refType === "CHILD_OF"`, clamp root-cause percent-of-trace to a sane range, and include backend signal capabilities in `backend_health`.

## 0.0.10

### Patch Changes

- Updated dependencies [b1f3704]
  - autotel@3.0.0

## 0.0.9

### Patch Changes

- dc4908d: Updated deps
- Updated dependencies [dc4908d]
  - autotel@2.26.3

## 0.0.8

### Patch Changes

- 1fa99a0: Fix duplicate `drizzle.*` spans. `instrumentDrizzleClient` no longer instruments `db.$client` — drizzle's session internally dispatches to that same client from within its already-traced prepared query `execute`, which caused every query to emit nested duplicate spans with identical `db.statement`. Session-level instrumentation is now the single source of truth. Consumers who need to trace a standalone client without a drizzle wrapper can still call `instrumentDrizzle(client)` directly.

## 0.0.7

### Patch Changes

- Updated dependencies [abe7674]
  - autotel@2.26.2

## 0.0.6

### Patch Changes

- Updated dependencies [dc471ef]
  - autotel@2.26.1

## 0.0.5

### Patch Changes

- 8003fad: feat: migrate autotel-devtools into monorepo and upgrade to TypeScript 6.0
  - migrate `autotel-devtools` (standalone OTLP receiver + Preact web UI) into the monorepo with tsup server build and Vite IIFE widget build
  - add `devtools` support to `autotel.init()` for local `autotel-devtools` usage, including optional embedded startup and shutdown cleanup
  - improve `autotel-web` browser span export behavior by avoiding exporter recursion, feature-detecting `sendBeacon`, and reading HTTP methods from `Request` objects
  - narrow the `autotel-edge` factory marker fix to source code so downstream bundlers do not misoptimize required initializers
  - upgrade all packages to TypeScript 6.0: add `tsconfig.build.json` with `ignoreDeprecations: "6.0"` for tsup DTS generation, add explicit `"types": ["node"]` where missing, set `rootDir` where needed
  - fix Astro docs content collection config for Starlight loader API change
  - fix Playwright version mismatch between autotel-playwright and example-playwright-e2e
  - add `@tanstack/intent` to autotel runtime dependencies (required by published bin)

- Updated dependencies [8003fad]
  - autotel@2.26.0

## 0.0.4

### Patch Changes

- Updated dependencies [f4ac1c3]
  - autotel@2.25.5

## 0.0.3

### Patch Changes

- Updated dependencies [32e088f]
  - autotel@2.25.4

## 0.0.2

### Patch Changes

- Updated dependencies [3a5b723]
  - autotel@2.25.3

## 0.1.0

Initial version
