# autotel-skybridge

OpenTelemetry for [Skybridge](https://github.com/alpic-ai/skybridge) MCP Apps. One middleware traces every tool call, resource read and prompt, and sends the spans to any OTLP backend.

## Install

```bash
npm install autotel autotel-skybridge
```

## Use

```ts
// src/instrumentation.ts: import this first in src/index.ts
import { init } from 'autotel';

init({ service: 'my-app' }); // reads OTEL_EXPORTER_OTLP_ENDPOINT / _HEADERS
```

```ts
// src/server.ts
import { skybridgeTracing } from 'autotel-skybridge';
import { Skybridge } from 'skybridge/server';

export const app = new Skybridge({
  name: 'my-app',
  version: '1.0.0',
  handler: (server) =>
    server
      .registerTool({ name: 'search' /* ... */ }, async (args) => {
        /* ... */
      })
      .mcpMiddleware(skybridgeTracing()),
});
```

## What you get

- A `SERVER` span per `tools/call` (`tools/call search`), `resources/read` and `prompts/get`, with the attributes from the OTel MCP semantic conventions (`mcp.method.name`, `gen_ai.tool.name`, `mcp.resource.uri`, ...). View resources are included, with the `?v=` cache key dropped from the URI. The duration metric labels tools and prompts by name and leaves resource URIs off, since a URI can expand a template.
- The caller's trace context in `_meta` parents the span, so an `instrumentMcpClient` caller and your server share one trace. Spans you start inside a tool nest under it.
- Skybridge answers a thrown tool error with an `isError` result. The span records `ERROR` with the failure text as its status message, `error.type=tool_error`, `mcp.failure.*` grouping, and the original exception. A `createStructuredError` keeps its `why`, `fix` and `code` as `error.*` attributes.
- Payload sizes, the `mcp.server.operation.duration` metric, and the security signals from `autotel-mcp-instrumentation`.

## Options

`skybridgeTracing(config)` takes the same `McpInstrumentationConfig` as `instrumentMcpServer`, for example:

```ts
skybridgeTracing({
  captureToolArgs: true, // off by default: arguments may carry PII
  captureToolResults: false,
});
```

The middleware runs before the SDK validates the request. `captureToolArgs` and the security classifiers see the arguments as sent, and the span name comes from the requested tool name. A call to an unknown tool gets the bare method name, and the duration metric leaves the name out. Tool annotations and manifest classification come from `instrumentMcpServer`, which sees each tool's registration.

## Vercel

`skybridge build` writes Vercel's prebuilt output. Add `protocol: 'http'` (the bundled JSON exporter) and `forceFlushOnShutdown: process.env.VERCEL === '1'` to `init()`, set `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` on the project, and run `vercel deploy --prebuilt`.

## Example

[`apps/example-skybridge`](../../apps/example-skybridge) is a Skybridge app with a React view and a client script that calls it.
