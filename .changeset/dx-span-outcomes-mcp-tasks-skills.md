---
'autotel': minor
'autotel-web': major
'autotel-edge': minor
'autotel-effect': minor
'autotel-tanstack': major
'autotel-terminal': patch
'autotel-mcp-instrumentation': minor
'autotel-mcp': minor
---

Span outcomes for Effect and TanStack Start, MCP Tasks and Skills, wider redaction, and sturdier export.

**autotel**

- Query parameter values export as `REDACTED` in every environment, with names kept. `attributeRedactor: false` or `AUTOTEL_REDACT_PII=off` exports them as sent.
- The `default` and `strict` presets redact any key ending in password, secret, token, api key, credential(s) or authorization (`accessToken`, `client_secret`) and keep counters such as `totalTokens`.
- New built-ins `apiKeys`, `privateKey` and `urlPassword` mask vendor tokens to their prefix (`ghp_***`, `sk-ant-***`, `AKIA***`), PEM private keys and URL passwords under any key. They run in `default`, `strict` and any config that leaves `builtins` on.
- `creditCard` leaves UUIDs intact.
- Spans from `trace`, `span`, `trace.run` and `getTracer()` start at sub-millisecond precision, so spans that begin within one millisecond appear in order on a waterfall. Start times stay within a millisecond of `Date.now()`.
- `debug: 'pretty'` output prints control characters as escapes.

**autotel-web** (breaking)

- `createSessionRatioSampler` now lives in `autotel-web/full`, which keeps the lean entry free of `@opentelemetry/*`. Import it with `import { createSessionRatioSampler } from 'autotel-web/full'`.
- The exporter retries a timeout, `429`, `502`, `503` and `504`, waits as long as `Retry-After` asks up to 10 minutes, and drops a batch asked to wait longer. With `debug` on it logs records a collector rejects in `partialSuccess`.

**autotel-edge**

- `OTLPExporter` retries a network error, `408`, `429`, `502`, `503` and `504` up to three attempts, honouring `Retry-After` up to 5 seconds. A `2xx` whose `partialSuccess` rejects spans fails the export with the count.

**autotel-effect**

- `layer({ spans })` classifies span exits. `anticipatedErrorIdentifiers` and `isAnticipatedError` end expected failures OK with no exception event, as `ErrorReporter.ignore` failures do. A server span that answered 5xx is an error, and an `HttpClient` 4xx is an error without an exception event, both with `error.type`.
- A `Data.TaggedError` carrying `why`, `fix`, `link`, `code` or `status` puts them on the span as `error.*`.
- `spans.dropSpanSubtrees` leaves a span and everything under it unrecorded. `effectSpanFilter` for `init({ spanFilter })` drops single spans and keeps their children attached to the nearest kept span. Spans below `MinimumTraceLevel` stay unrecorded.
- `webHandler(handler, { flush })` takes the flush to run after the response.

**autotel-tanstack** (breaking)

- Request spans record `http.response.status_code`. A 5xx sets the span to error and a 4xx leaves it unset.
- `captureArgs` defaults to `false`. Pass `captureArgs: true` where you want input recorded.
- `captureResults` records the function's return value, and `url.query` drops the leading `?`.
- Server function spans take their name from `serverFnMeta` on TanStack Start 1.169 and later.
- `debugHeadersMiddleware()` fits `createMiddleware().server()`, and the metrics and error-reporting handlers run under Solid Start.
- `reportError` and `withErrorReporting` accept a typed `context`. The `sampling` option is deprecated: set sampling with `init({ sampling })`.

**autotel-terminal**

- Span names, attributes and log bodies print control characters as escapes, including events sent through `getTerminalLogStream().emit()`.

**autotel-mcp-instrumentation**

- Tasks: a tool call that runs as a task carries `mcp.task.augmented`, `mcp.task.id` and `mcp.task.status` and stays UNSET, with `mcp.task.augmented` on its duration metric. `tasks/get`, `tasks/update` and `tasks/cancel` (plus 2025-11-25's `tasks/result` and `tasks/list`) carry the task id and status. A `tasks/get` that reports a failed task or a tool error is an error span.
- Skills over MCP: `skills/list` and `skills/get` are traced, named after the skill served, with `mcp.skill.name` on the metric.
- A call retried with the user's answers records `mcp.elicitation.action`. A paused call sets status UNSET.

**autotel-mcp**

- `mcp_sessions` shows how agents use an MCP server you instrument. It rebuilds sessions from tool-call spans with each call's intent, gives each session an outcome (`completed`, `recovered`, `failed`, `paused` or `missing_tool`), groups sessions that took the same path through the tools with their completion rate, and lists where failed sessions stopped and which tools agents asked for.
- Publishes the `autotel-mcp`, `analyze-traces` and `debug-missing-spans` skills over MCP (`io.modelcontextprotocol/skills`), served through `skills/list`, `skills/get` and `skill://` resources.
