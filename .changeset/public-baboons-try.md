---
'autotel-aws': patch
'autotel-cli': patch
'autotel-mcp': patch
---

Add CloudWatch OTLP exporters for `autotel-aws` and wire a richer investigate surface in `autotel-cli` backed by shared `autotel-mcp` modules.

- `autotel-aws`
  - Add `autotel-aws/cloudwatch` export with SigV4-signed OTLP HTTP exporters for traces, logs, and metrics.
  - Add endpoint/signing helpers and documentation for direct CloudWatch OTLP usage.
- `autotel-cli`
  - Add `investigate` command groups (`health`, `discover`, `query`, `trace`, `topology`, `diagnose`, `correlate`, `llm`, `semconv`, `score`, `collector`) with JSON envelopes.
  - Improve Commander error handling so parse/validation failures are returned in the CLI JSON error contract.
- `autotel-mcp`
  - Extract backend selection into a reusable backend factory and export shared query/module helpers used by CLI investigate commands.
