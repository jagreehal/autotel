---
'autotel': patch
'autotel-adapters': patch
'autotel-agents': patch
'autotel-audit': patch
'autotel-aws': patch
'autotel-cloudflare': patch
'autotel-devtools': patch
'autotel-drizzle': patch
'autotel-edge': patch
'autotel-eventcatalog': patch
'autotel-genai': patch
'autotel-hono': patch
'autotel-mcp-instrumentation': patch
'autotel-message-contract': patch
'autotel-mongoose': patch
'autotel-nuxt': patch
'autotel-pact': patch
'autotel-playwright': patch
'autotel-plugins': patch
'autotel-sentry': patch
'autotel-subscribers': patch
'autotel-tanstack': patch
'autotel-telemetry': patch
'autotel-terminal': patch
'autotel-vitest': patch
'autotel-web': patch
---

Refresh dependencies to their latest minor and patch releases, most notably the
OpenTelemetry SDK (`0.220.x` → `0.221.x`, `2.9.x` → `2.10.x`).

Majors are deliberately held back for a separate change, including TypeScript 7,
pnpm 11, chalk 6, jsdom 30 and the ESLint toolchain.
