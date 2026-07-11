---
"autotel": patch
"autotel-adapters": patch
"autotel-aws": patch
"autotel-backends": patch
"autotel-cli": patch
"autotel-cloudflare": patch
"autotel-devtools": patch
"autotel-eventcatalog": patch
"autotel-hono": patch
"autotel-mcp": patch
"autotel-mongoose": patch
"autotel-pact": patch
"autotel-playwright": patch
"autotel-sentry": patch
"autotel-tanstack": patch
"autotel-terminal": patch
"autotel-vitest": patch
---

chore: routine dependency updates

Refresh runtime and peer dependency ranges across published packages (`ncu`, 3-day release-age cooldown).

The core `autotel` package moves to the latest OpenTelemetry libraries (stable `2.9.x`, experimental `0.220.x`, semantic-conventions `1.42.x`). This required adapting to a breaking change in `@opentelemetry/sdk-logs`: `BatchLogRecordProcessor` and `SimpleLogRecordProcessor` now take a `{ exporter }` options object instead of a positional exporter argument.

Notable peer range bumps for consumers: `autotel-aws` (AWS SDK `3.1081`), `autotel-cloudflare` (`@cloudflare/workers-types` v5), `autotel-pact` (`@pact-foundation/pact` v17), `autotel-terminal` (`ai` v7).
