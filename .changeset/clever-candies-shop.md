---
'autotel-mcp-instrumentation': patch
'autotel-eventcatalog': patch
'autotel-subscribers': patch
'autotel-cloudflare': patch
'autotel-playwright': patch
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
'autotel-vscode': patch
'autotel-audit': patch
'autotel-edge': patch
'autotel-hono': patch
'autotel-pact': patch
'autotel-aws': patch
'autotel-cli': patch
'autotel-mcp': patch
'autotel-web': patch
'autotel': patch
---

Refresh package dependencies across the workspace and keep generated lockfile state in sync.

Add OTLP/protobuf ingestion support to `autotel-devtools` for traces, logs, and metrics. The devtools HTTP receiver now accepts both OTLP/JSON and OTLP/protobuf payloads on the existing `/v1/traces`, `/v1/logs`, and `/v1/metrics` endpoints, decodes protobuf payloads with embedded OTLP schemas, and includes interop coverage using the OpenTelemetry protobuf serializers.
