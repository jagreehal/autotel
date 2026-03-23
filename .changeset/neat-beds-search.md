---
'autotel-subscribers': patch
'autotel-playwright': patch
'autotel-adapters': patch
'autotel-backends': patch
'autotel-tanstack': patch
'autotel-terminal': patch
'autotel-plugins': patch
'autotel-sentry': patch
'autotel-vitest': patch
'autotel-hono': patch
'autotel-aws': patch
'autotel-cli': patch
'autotel-mcp': patch
'autotel': patch
---

Add opt-in OTLP log export and improve terminal UX.

**autotel**
- Add `logs: true` option to `init()` that auto-configures `BatchLogRecordProcessor` + `OTLPLogExporter` from the endpoint — no manual imports needed. Defaults to `false` (opt-in) to preserve existing behavior and upstream `OTEL_LOGS_EXPORTER` handling.
- Add `resolveLogsFlag()` with `AUTOTEL_LOGS` env var override, matching the `metrics` pattern.
- Move `@opentelemetry/exporter-logs-otlp-http` and `@opentelemetry/sdk-logs` from optional peer deps to regular dependencies.
- Export `RedactingLogRecordProcessor` from `posthog-logs.ts` for reuse by the auto-configured log pipeline.

**autotel-terminal**
- AI panel: show configuration guidance when no provider is detected; only enter input mode when a provider is available.
- AI panel: Escape now closes the panel entirely (not just exits input mode).
- Add `f` key for typeable traceId filter with Tab autocomplete against known trace IDs.
- Add Tab-to-traceId autocomplete in `/` search mode (4+ character prefix match).
- Add Escape to exit search mode (in addition to existing `/` toggle and Enter).
