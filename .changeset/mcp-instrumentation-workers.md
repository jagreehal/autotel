---
'autotel-mcp-instrumentation': minor
'autotel-edge': patch
---

`instrumentMcpServer` and `instrumentMcpClient` run on Cloudflare Workers. A `#runtime` subpath import resolves to `autotel-edge` under the `workerd`, `worker` and `browser` conditions and to `autotel` otherwise, in ESM and CommonJS. `autotel-edge` exports `SpanKind`, honours `spanKind` in `withTracing`, and adds a `default` export condition so `require('autotel-edge')` resolves.
