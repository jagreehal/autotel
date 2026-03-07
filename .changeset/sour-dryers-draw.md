---
'autotel-subscribers': patch
'autotel-cloudflare': patch
'autotel-adapters': patch
'autotel-backends': patch
'autotel-tanstack': patch
'autotel-terminal': patch
'autotel-plugins': patch
'autotel-sentry': patch
'autotel-edge': patch
'autotel-hono': patch
'autotel-aws': patch
'autotel-cli': patch
'autotel-mcp': patch
'autotel-web': patch
'autotel': patch
---

- Bug fixes and dependency updates across packages.
- example-vitest: API tests use a random port (when `API_BASE_URL`/`PORT` unset) to avoid EADDRINUSE on port 3000.
