---
'autotel-mcp-instrumentation': major
'@jagreehal/example-mcp-server': patch
'@jagreehal/example-mcp-client': patch
---

Support MCP `2026-07-28` (stateless) alongside the 2025-era protocol

The protocol dropped the `initialize`/`initialized` handshake (SEP-2575) and the
`Mcp-Session-Id` header (SEP-2567). One `instrumentMcpServer` /
`instrumentMcpClient` call now covers both eras: the wrappers stay duck-typed
Proxies, so era is detected per request and no SDK is imported at runtime.

**Fixed: server spans were silently orphaned on the v2 SDK.** Neither era puts
`_meta` in a handler's first argument — both SDKs validate `arguments` and hand
the request metadata over on the context argument — but the v2 shape nests it at
`ctx.mcpReq._meta` rather than v1's `extra._meta`. Every `2026-07-28` server span
was starting a new trace instead of continuing the client's. The context is now
located by shape rather than position, which also fixes resource handlers
(`(uri, ctx)` and `(uri, variables, ctx)`).

**Era-dependent attributes are read off the request instead of from config:**

- `mcp.protocol.version` — from each request's
  `io.modelcontextprotocol/protocolVersion` envelope key on `2026-07-28`. There
  is no handshake left to pin it to.
- `mcp.session.id` — from a 2025-era request (server) or `client.transport`
  (client). Absent on `2026-07-28`, which has no sessions.

**Fixed: a handler with no input schema is called as `(ctx)` on both SDKs**, so
treating `args[0]` as the arguments serialised the whole context. With
`captureToolArgs: true` behind OAuth that put `http.authInfo.token` into
`gen_ai.tool.call.arguments` and shipped it to the telemetry backend. The
payload is now only read when the context was not found at that position.
(Pre-existing; surfaced while adding the context lookup.)

**Breaking:**

- `MCP_METRICS.CLIENT_SESSION_DURATION` / `SERVER_SESSION_DURATION` and
  `MCP_METHODS.INITIALIZE` removed — nothing recorded them, and `2026-07-28` has
  nothing for them to measure.
- `McpInstrumentationConfig.sessionId` is now a _fallback_, consulted only when
  the request carries no session of its own. Existing configs keep working; the
  value is simply outranked by the live one where there is one. It remains the
  only source for legacy stdio, whose transport has no session at all, and is
  ignored by sessionless 2026-07-28 requests.
- Peer dependencies are now `@modelcontextprotocol/server` /
  `@modelcontextprotocol/client` ^2.0.0 **and** `@modelcontextprotocol/sdk`
  ^1.30.0, all optional. Install whichever you build against.

**Added:**

- `mcp.input_required` on the span and the duration metric when a `2026-07-28`
  handler returns `inputRequired(...)` instead of a result, so a multi-round-trip
  pause is not counted as completed work and the client's retry does not read as
  a duplicate call. The span status is left UNSET rather than OK — a pause is
  neither success nor failure. Detected with the SDK's own
  `resultType === 'input_required'` discriminator, so a result that legitimately
  carries a `requestState`/`inputRequests` field is not mistaken for a pause. The
  key is not under `mcp.tool.*` because `prompts/get` and `resources/read` can
  pause too, and a tool-namespaced label would split their duration series.
- `MCP_METHODS.SERVER_DISCOVER`; the v2 client's `discover()` is traced as a
  discovery operation, in place of `initialize`.
- Client wrappers forward trailing arguments verbatim, so v1's
  `callTool(params, resultSchema?, options?)` and v2's `callTool(params, options?)`
  both pass through untouched.

**Examples migrated to 2026-07-28.** `example-mcp-server` now builds its server
from a factory behind `serveStdio`, and `example-mcp-client` uses the v2 client
with `versionNegotiation: 'auto'`. Both gained a `type-check` script — CI was
not type-checking either app before.

The server example also stopped writing spans to stdout. On a stdio MCP server
stdout _is_ the protocol wire, so `ConsoleSpanExporter` corrupts it; the example
now ships a small stderr exporter and says why.
