# MCP Weather Server Example

Example MCP server with automatic OpenTelemetry instrumentation using `autotel-mcp-instrumentation`.

## Features

- **Automatic tracing**: All tools are automatically traced without manual instrumentation
- **W3C trace context**: Extracts parent context from `_meta` field in requests
- **Console output**: Spans are printed to console for demonstration
- **Two tools**: `get_weather` and `get_forecast`

## Running

```bash
pnpm --filter @jagreehal/example-mcp-server start
```

## Testing with MCP Inspector

Install MCP Inspector globally:

```bash
npm install -g @modelcontextprotocol/inspector
```

Run the server through the inspector:

```bash
mcp-inspector node apps/example-mcp-server/src/index.ts
```

## Testing with Example Client

See `apps/example-mcp-client` for a client that connects to this server with distributed tracing.

## Trace Output

When you call a tool, you'll see spans like:

Spans go to **stderr**, not stdout: on a stdio MCP server stdout is the
protocol wire, so every diagnostic has to go elsewhere. That is why this example
uses a small stderr exporter rather than `ConsoleSpanExporter`.

```json
{
  "name": "tools/call get_weather",
  "traceId": "0af7651916cd43dd8448eb211c80319c",
  "spanId": "a1b2c3d4e5f6a7b8",
  "parentSpanId": "b7ad6b7169203331",
  "durationMs": 102.9,
  "attributes": {
    "mcp.method.name": "tools/call",
    "gen_ai.tool.name": "get_weather",
    "gen_ai.operation.name": "execute_tool",
    "mcp.protocol.version": "2026-07-28",
    "network.transport": "pipe",
    "mcp.tool.read_only": true,
    "mcp.tool.arguments.size": 21
  }
}
```

`parentSpanId` is the client's span: the server read `traceparent` out of the
request's `_meta` and joined the caller's trace, over a protocol with no session
tying the two together.

## How It Works

This server speaks MCP `2026-07-28`, which has no `initialize` handshake and no
session. A server instance therefore holds nothing between requests, so the SDK
builds one from a factory: `serveStdio` once per connection, `createMcpHandler`
once per HTTP request. 2025-era clients are answered from the same definitions.

1. `createServer()` builds an `McpServer` and `instrumentMcpServer()` wraps it.
   Register through the **returned proxy** — registrations on the original
   server are not traced.
2. When you call `registerTool()`, the handler is automatically wrapped.
3. On each request:
   - Parent context is extracted from `ctx.mcpReq._meta`, not from the
     arguments — both SDKs hand request metadata over on the context argument
   - A new span is created as a child of the parent
   - Tool execution is traced
   - Span attributes include tool name, args, results (if configured), plus the
     caller's `mcp.protocol.version` from the per-request envelope

## Integration with Claude Desktop

Add to your Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "weather": {
      "command": "node",
      "args": ["/path/to/autotel/apps/example-mcp-server/src/index.ts"]
    }
  }
}
```

Note: swap the stderr exporter for an OTLP exporter in production:

```typescript
import { init } from 'autotel';

init({
  service: 'mcp-weather-server',
  endpoint: 'http://localhost:4318', // or your OTLP endpoint
});
```
