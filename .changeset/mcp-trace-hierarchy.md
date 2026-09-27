---
'autotel-aws': minor
'autotel-mcp-instrumentation': patch
---

`autotel-aws`: `extractTraceContext` accepts a function for protocols that carry W3C trace context outside headers, such as MCP's `params._meta`. Return a carrier (`traceparent`, plus `tracestate` and `baggage` when present) or `undefined` to use the built-in extraction. `wrapHandler`, `traceLambda` and the Middy middleware support it, `TraceCarrier` is exported from `autotel-aws/lambda`, and baggage flows through to the invocation and downstream calls.

`autotel-mcp-instrumentation`: tool, resource and prompt spans inside an already-traced request in the caller's trace (a Lambda invocation, an HTTP server span) parent on that host span, so the trace reads caller → host → tool. Baggage from `_meta` carries through.
