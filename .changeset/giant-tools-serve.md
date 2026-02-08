---
'@jagreehal/example-mcp-client': minor
'@jagreehal/example-mcp-server': minor
'@jagreehal/awaitly-example': minor
'autotel-mcp': minor
---

Add OpenTelemetry MCP semantic conventions and operation duration metrics.

- **autotel-mcp**: New subpath exports `autotel-mcp/semantic-conventions` (MCP_SEMCONV, MCP_METHODS, MCP_METRICS, MCP_DURATION_BUCKETS) and `autotel-mcp/metrics` (recordClientOperationDuration, recordServerOperationDuration). Server and client instrumentation now align with the [OTel MCP semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/) for span attributes and record histograms for client/server operation duration.
- **Example apps**: Updated to use the new conventions and metrics where applicable.
