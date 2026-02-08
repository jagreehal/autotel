---
'autotel': patch
'autotel-aws': patch
'autotel-backends': patch
'autotel-cli': patch
'autotel-cloudflare': patch
'autotel-edge': patch
'autotel-mcp': minor
'autotel-plugins': patch
'autotel-subscribers': patch
'autotel-tanstack': patch
'autotel-terminal': patch
'autotel-web': patch
---

Add OpenTelemetry MCP semantic conventions and operation duration metrics.

**autotel-mcp**

- New subpath export `autotel-mcp/semantic-conventions`: `MCP_SEMCONV`, `MCP_METHODS`, `MCP_METRICS`, `MCP_DURATION_BUCKETS` per [OTel MCP semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/).
- New subpath export `autotel-mcp/metrics`: `recordClientOperationDuration`, `recordServerOperationDuration` for client/server operation duration histograms.
- Server and client instrumentation updated to use the semantic conventions for span attributes and to record operation duration metrics.

**Example apps** (`example-mcp-client`, `example-mcp-server`, `awaitly-example`) updated to use the new conventions and metrics.

**Dependency updates** (from npm-check-updates)

- ESLint: `@eslint/js` 10.0.1, `eslint` 10.0.0.
- `dotenv` 17.2.4.
- `@types/node` 25.2.2 across multiple packages.
- `@aws-sdk` clients, `mongoose`, `@modelcontextprotocol/sdk` updated for compatibility and latest features.
- Peer dependencies adjusted in `autotel-cloudflare` and `autotel-mcp` to match latest versions.
