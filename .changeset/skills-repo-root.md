---
'autotel-adapters': patch
'autotel-aws': patch
'autotel-backends': patch
'autotel-cli': patch
'autotel-cloudflare': patch
'autotel-devtools': patch
'autotel-drizzle': patch
'autotel-edge': patch
'autotel-genai': patch
'autotel-hono': patch
'autotel-mcp-instrumentation': patch
'autotel-mcp': patch
'autotel-mongoose': patch
'autotel-nuxt': patch
'autotel-playwright': patch
'autotel-plugins': patch
'autotel-sentry': patch
'autotel-subscribers': patch
'autotel-tanstack': patch
'autotel-terminal': patch
'autotel-vitest': patch
'autotel-web': patch
'autotel': patch
---

Skills no longer ship inside the npm package tarballs. They now live at the repo root under `skills/`, grouped into `core/`, `frameworks/`, `integrations/`, and `contributing/`, as a single source of truth discovered by the skills CLI (`npx skills add jagreehal/autotel --skill <name>`). `skills` is removed from each package's `files` field, so installing a package no longer adds its skill to `node_modules`. Install skills explicitly with the CLI instead.
