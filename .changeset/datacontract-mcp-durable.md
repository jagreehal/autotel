---
'autotel-datacontract': minor
'autotel-mcp-instrumentation': major
'autotel-skybridge': patch
'autotel-aws': major
'autotel': patch
---

**autotel-datacontract** (new): ODCS v3 data contracts with evidence.

- `/runtime`: `createContractGuard` validates records and records the contract's track record as OpenTelemetry metrics and Logs API events.
- `/db`: `auditDatabase` and `draftContractFromDatabase` work with any driver. Audits run verified statements; `tolerantSelect` writes named-column queries.
- CLI and API: `lint`, `diff`, `check` (version bump against the change), `satisfies` (consumer expectations), `verify --record` (track record file), `json-schema`.

**autotel-mcp-instrumentation**

- Traces the low-level `Server` API and records `mcp.client.name` / `mcp.client.version`, including on stateless Streamable HTTP (`statelessClientIdentity`).
- Session order: application (`resolveSessionId`, baggage `session.id`, `{ argument }`), then the agent's `session_id`, then the transport session, which tool spans now record as `gen_ai.conversation.id` by default. `sessionHandles: { inject: true }` keeps the agent fallback.
- `captureModel`, `{ argument }` on `captureIntent` / `captureModel`, and `resolveOriginalTool` for caller-dependent schemas.
- `redactPayload` and `redact` for captured content on server and client. Failure text is recorded with `captureErrorMessages: true`, now off by default.
- `recordableError` export, used by `autotel-skybridge`.

**autotel-aws**: `autotel-aws/durable` targets `@aws/durable-execution-sdk-js` 3 and `@aws/durable-execution-sdk-js-otel` 2.1. `durableFlush()` returns a plugin factory to register beside `createOtelPluginFactory()`.

**autotel**: `flush()` flushes metrics with spans and logs, under the same timeout.
