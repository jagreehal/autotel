---
'autotel': minor
'autotel-edge': major
'autotel-cloudflare': minor
'autotel-devtools': major
'autotel-mcp': minor
'autotel-effect': minor
---

Issues for every autotel runtime: failures group into issues you can triage, resolve and hand to a coding agent.

- **Signals.** `console.error(err)` inside a span records a handled exception (`captureConsoleErrors`). A log line repeated past `logFloodThreshold` in one invocation records `autotel.LogFlood`, and a Durable Object alarm running in a loop records `autotel.RunawayAlarm` (`runawayAlarm`).
- **autotel-devtools.** Groups thrown and handled exceptions, 5xx responses, error logs and detector reports into issues with status (active, resolved, ignored), counts, trend, versions and affected users. Automations send an issue after N occurrences or when it returns after a quiet period, to a signed webhook, a Claude Code routine, Cursor, Devin, Slack or PagerDuty, with retries and run history. Stack traces map back to source through local bundle maps or `AUTOTEL_DEVTOOLS_SOURCEMAPS`. New exports: `autotel-devtools/issues` and `autotel-devtools/sourcemaps`.
- **autotel-mcp.** `list_issues` and `get_issue` use the same fingerprint as devtools and read its stored status. The collector, Tempo and Jaeger backends keep exception events, and `AUTOTEL_ISSUES_DESTINATION` sends issues from any backend, with persisted state.
- **Cloudflare.** Native tracing uses the span methods the runtime provides, nests spans from Durable Objects, Workflows and entrypoints, and writes the handler body to the invocation's root span, so Workers Issues shows `user.id` and request context. `autotel-cloudflare/tail` observes Workers with no SDK through a Tail Worker.
- **autotel-effect.** Supports Effect 4.0.0.

**Migrating (autotel-devtools):** call `aggregator.addTrace(trace)` in place of `addErrorsFromTrace(trace)`, and `aggregator.add(occurrence)` with the `Occurrence` type from `autotel-devtools/issues` in place of `addError()`. `ErrorGroup` gains a `source` field.

**Migrating (autotel-edge):** `ensureGlobalContextManager()` returns `void`; read the active context from `@opentelemetry/api` instead.
