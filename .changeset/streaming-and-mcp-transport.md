---
'autotel-hono': minor
'autotel-web': patch
'autotel-mcp-instrumentation': minor
---

Streamed responses record their full length, and MCP clients that keep their SDK client private can join the caller's trace.

**`autotel-hono`** ends the request span, `http.server.request.duration` and the active-request count when the body has been sent, matching `@opentelemetry/instrumentation-http`. A 60-second `streamSSE` agent run now records as 60 seconds. An error part-way through the stream lands on the span; a client disconnect ends it without one. Responses with no body and HEAD requests end at once. In tests that call `app.request()`, read the body (`await res.text()`) before asserting on the span.

**`autotel-web`** ends a `text/event-stream` or `application/x-ndjson` fetch span when the body finishes, errors (as `error.type`) or gets cancelled. Other responses end at the headers. The returned `Response` and its clones keep the network response's `url`, `redirected` and `type`.

**`autotel-mcp-instrumentation`** adds `instrumentMcpTransport(transport)`. It puts the active `traceparent` into `params._meta` on every request, for clients such as `@ai-sdk/mcp` and `@tanstack/ai-mcp`. `_meta` keys you set take precedence.
