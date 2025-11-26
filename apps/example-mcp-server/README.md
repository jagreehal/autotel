# MCP Weather Server Example

Example MCP server with automatic OpenTelemetry instrumentation using `autotel-mcp`.

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

```
{
  traceId: '0af7651916cd43dd8448eb211c80319c',
  parentId: 'b7ad6b7169203331',
  name: 'mcp.tool.get_weather',
  id: 'a1b2c3d4e5f6g7h8',
  kind: 0,
  timestamp: 1234567890,
  attributes: {
    'mcp.type': 'tool',
    'mcp.tool.name': 'get_weather',
    'mcp.tool.args': '{"location":"New York"}'
  }
}
```

## How It Works

1. `instrumentMcpServer()` wraps the server
2. When you call `server.registerTool()`, the handler is automatically wrapped
3. On each request:
   - Parent context is extracted from `_meta` field
   - A new span is created as a child of the parent
   - Tool execution is traced
   - Span attributes include tool name, args, results (if configured)

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

Note: Change console exporter to OTLP exporter for production use:

```typescript
import { init } from 'autotel'

init({
  service: 'mcp-weather-server',
  endpoint: 'http://localhost:4318', // or your OTLP endpoint
})
```
