---
'autotel-mcp-instrumentation': patch
'autotel-subscribers': patch
'autotel-cloudflare': patch
'autotel-adapters': patch
'autotel-backends': patch
'autotel-devtools': patch
'autotel-mongoose': patch
'autotel-tanstack': patch
'autotel-terminal': patch
'autotel-drizzle': patch
'autotel-plugins': patch
'autotel-sentry': patch
'autotel-vitest': patch
'autotel-edge': patch
'autotel-hono': patch
'autotel-aws': patch
'autotel-cli': patch
'autotel-mcp': patch
'autotel-web': patch
'autotel': patch
---

Add Cloudflare Workers support to main `autotel` package. Introduces `autotel/workers` and `autotel/cloudflare` entry points that re-export the functional API and Cloudflare-specific instrumentation from `autotel-cloudflare`, providing better DX for Cloudflare users while keeping the core package modular. Updates package exports, build config, and documentation.
