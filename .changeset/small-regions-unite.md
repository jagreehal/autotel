---
'autotel': minor
'autotel-edge': patch
'autotel-cloudflare': patch
'autotel-web': patch
'autotel-cli': patch
'autotel-adapters': patch
'autotel-aws': patch
'autotel-backends': patch
'autotel-drizzle': patch
'autotel-hono': patch
'autotel-mcp': patch
'autotel-mongoose': patch
'autotel-playwright': patch
'autotel-plugins': patch
'autotel-sentry': patch
'autotel-subscribers': patch
'autotel-tanstack': patch
'autotel-terminal': patch
'autotel-vitest': patch
---

feat: migrate autotel-devtools into monorepo and upgrade to TypeScript 6.0

- migrate `autotel-devtools` (standalone OTLP receiver + Preact web UI) into the monorepo with tsup server build and Vite IIFE widget build
- add `devtools` support to `autotel.init()` for local `autotel-devtools` usage, including optional embedded startup and shutdown cleanup
- improve `autotel-web` browser span export behavior by avoiding exporter recursion, feature-detecting `sendBeacon`, and reading HTTP methods from `Request` objects
- narrow the `autotel-edge` factory marker fix to source code so downstream bundlers do not misoptimize required initializers
- upgrade all packages to TypeScript 6.0: add `tsconfig.build.json` with `ignoreDeprecations: "6.0"` for tsup DTS generation, add explicit `"types": ["node"]` where missing, set `rootDir` where needed
- fix Astro docs content collection config for Starlight loader API change
- fix Playwright version mismatch between autotel-playwright and example-playwright-e2e
- add `@tanstack/intent` to autotel runtime dependencies (required by published bin)
