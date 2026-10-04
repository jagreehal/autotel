---
'autotel-skybridge': minor
'autotel-mcp-instrumentation': minor
'autotel': patch
---

Add `autotel-skybridge`. `skybridgeTracing()` traces tool calls, resource reads and prompts in Skybridge MCP Apps, parents each span to the caller's `_meta` trace context, and puts the original exception and structured error fields on the span.

`autotel-mcp-instrumentation` exports `traceMcpHandler()` for frameworks with a request hook. An `isError` tool span carries the failure text as its status message. The duration metric keeps client-supplied names out: a request the SDK rejects takes the bare method name, and resource URIs stay on the span.

`autotel` treats a span with a remote parent as a root for `flushOnRootSpanEnd` and `forceFlushOnShutdown`, so a serverless server exports the spans of each request. When an operation sets an `ERROR` status and returns, `trace()` records `operation.success: false` and `error: true`, and metrics and tail sampling count it as failed.
