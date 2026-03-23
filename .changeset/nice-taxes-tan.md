---
'autotel-subscribers': patch
'autotel-adapters': patch
'autotel-backends': patch
'autotel-tanstack': patch
'autotel-plugins': patch
'autotel-hono': patch
'autotel-aws': patch
'autotel-cli': patch
'autotel-mcp': patch
'autotel': patch
'autotel-terminal': patch
---

Improve package compatibility and tooling consistency across the monorepo.

- Add CommonJS build output/exports where missing (including `autotel` entrypoints and backend/MCP package builds) to improve `require()` interoperability.
- Roll forward shared dependency versions across affected packages/apps to keep examples and libraries aligned on the same toolchain.
