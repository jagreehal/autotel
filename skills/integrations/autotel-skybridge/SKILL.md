---
name: autotel-skybridge
description: >
  Use this skill when adding OpenTelemetry to a Skybridge MCP App (skybridge/server): the skybridgeTracing() middleware for tool, resource and prompt spans, trace context from _meta, thrown tool errors on the span, and deploying the app to Vercel with spans flushed per request.
---

# autotel-skybridge

`skybridgeTracing()` is a Skybridge `mcpMiddleware` that traces `tools/call`,
`resources/read` (view resources included) and `prompts/get`. Spans, attributes
and metrics match `instrumentMcpServer` from `autotel-mcp-instrumentation`.

## Setup

Init autotel in its own module and import it first:

```typescript
// src/instrumentation.ts
import { init } from 'autotel';

init({ service: 'my-app' }); // reads OTEL_EXPORTER_OTLP_ENDPOINT / _HEADERS
```

```typescript
// src/index.ts
import './instrumentation.js';
import { app } from './server.js';

export default await app.run();
```

Register the middleware on the server inside the `Skybridge` handler:

```typescript
import { skybridgeTracing } from 'autotel-skybridge';
import { Skybridge } from 'skybridge/server';

export const app = new Skybridge({
  name: 'my-app',
  version: '1.0.0',
  handler: (server) =>
    server
      .registerTool({ name: 'search', inputSchema: { q: z.string() } }, handler)
      .mcpMiddleware(skybridgeTracing()),
});
```

`skybridgeTracing(config)` takes `McpInstrumentationConfig`. `captureToolArgs`
and `captureToolResults` stay off by default because payloads can carry PII.

## What you get

- One `SERVER` span per call: `tools/call search`, `resources/read`,
  `prompts/get <name>`, with `mcp.method.name`, `gen_ai.tool.name`,
  `mcp.resource.uri`, payload sizes and `mcp.server.operation.duration`.
- The caller's `traceparent` in `_meta` parents the span. An
  `instrumentMcpClient` caller and the server share one trace, and spans you
  start inside a tool nest under the tool span.
- Skybridge returns a thrown tool error as an `isError` result. The span gets
  `ERROR`, `error.type=tool_error`, `mcp.failure.*`, and the original exception
  with `error.message`, `error.stack`, and the `why` / `fix` / `code` fields of a
  `createStructuredError`.

The middleware runs before the SDK validates the request, so captured
arguments are the ones the client sent. A call to an unknown tool gets the
bare method name and no metric label, and
resource URIs stay off the metric because a URI can expand a template. Tool annotations and manifest
classification come from `instrumentMcpServer`, which sees each registration.

## Vercel

`skybridge build` writes Vercel's prebuilt output. Turn on per-request flushing
so spans leave before the function freezes, and keep the bundled JSON exporter:

```typescript
init({
  service: 'my-app',
  protocol: 'http',
  forceFlushOnShutdown: process.env.VERCEL === '1',
});
```

Set `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` as Vercel
environment variables, then `vercel deploy --prebuilt`.

Skybridge sends its own usage telemetry unless `SKYBRIDGE_TELEMETRY_DISABLED=1`.
Set it in the environment or at the top of `src/instrumentation.ts`.

## Example

`apps/example-skybridge`: a Skybridge app with a React view, a tool that throws,
and `pnpm call`, a traced client script.
