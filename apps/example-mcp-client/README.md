# MCP Weather Client Example

Example MCP client with automatic OpenTelemetry instrumentation using `autotel-mcp-instrumentation`. Demonstrates distributed tracing across MCP client-server boundaries.

## Features

- **Automatic trace context injection**: W3C trace context injected into `_meta` field
- **Distributed tracing**: Client and server spans linked via traceparent
- **Multiple examples**: Simple calls, sequential calls, error handling
- **Console output**: Spans printed to console for demonstration

## Running

Make sure the server example exists, then:

```bash
pnpm --filter @jagreehal/example-mcp-client start
```

## What It Demonstrates

### Example 1: Simple Tool Call

```typescript
import { span } from 'autotel';

const weatherNYC = await span('get-weather-example', async () => {
  // Creates client span, injects _meta with trace context
  const result = await instrumented.callTool('get_weather', {
    location: 'New York',
  });

  return result;
});
```

**Trace structure:**

```
get-weather-example (client)
└── mcp.client.callTool.get_weather (client)
    └── mcp.tool.get_weather (server) <- parent context from _meta!
```

### Example 2: Multiple Tool Calls

```typescript
import { span } from 'autotel';

const forecastLondon = await span('get-forecast-example', async () => {
  const weather = await instrumented.callTool('get_weather', {
    location: 'London',
  });
  const forecast = await instrumented.callTool('get_forecast', {
    location: 'London',
    days: 3,
  });

  return { weather, forecast };
});
```

**Trace structure:**

```
get-forecast-example (client)
├── mcp.client.callTool.get_weather (client)
│   └── mcp.tool.get_weather (server)
└── mcp.client.callTool.get_forecast (client)
    └── mcp.tool.get_forecast (server)
```

### Example 3: Error Handling

Demonstrates error propagation and exception recording across the distributed trace.

## Distributed Tracing Flow

1. **Client creates parent span** (`trace()` wrapper)
2. **Client calls tool** → `instrumentMcpClient()` intercepts
3. **Client creates child span** for the tool call
4. **Client injects W3C context** into `_meta` field
5. **Request sent** with `{ name, arguments, _meta: { traceparent, tracestate, baggage } }`
6. **Server receives request** → `instrumentMcpServer()` intercepts
7. **Server extracts parent context** from `ctx.mcpReq._meta` (the context
   argument, not the tool arguments)
8. **Server creates child span** with parent context
9. **Complete distributed trace** visible in backend

On MCP `2026-07-28` there is no session tying client and server together, and
that is exactly why this works: `traceparent` always rode in `_meta`, and the
revision makes `_meta` the mandatory per-request envelope. There is now always
somewhere for it to ride, and no session for a trace to be orphaned from.

## Trace Context in _meta Field

The `_meta` field contains:

```json
{
  "traceparent": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
  "tracestate": "vendor1=value1,vendor2=value2",
  "baggage": "userId=123,tenant=acme"
}
```

These are the bare `traceparent` / `tracestate` / `baggage` keys, not the
reserved `io.modelcontextprotocol/*` envelope namespace — which is what lets
them survive the SDK's envelope lift and reach `ctx.mcpReq._meta`.

This enables:

- **Distributed tracing** across process boundaries
- **Transport-agnostic** (works with stdio, HTTP, SSE, etc.)
- **Standard W3C format** compatible with all OTLP backends

## Using with Production Backends

Replace console exporter with OTLP:

```typescript
import { init } from 'autotel';

// Honeycomb
init({
  service: 'mcp-weather-client',
  endpoint: 'https://api.honeycomb.io',
  headers: { 'x-honeycomb-team': process.env.HONEYCOMB_API_KEY },
});

// Datadog
init({
  service: 'mcp-weather-client',
  endpoint: 'https://http-intake.logs.datadoghq.com',
  headers: { 'DD-API-KEY': process.env.DD_API_KEY },
});
```

Then both client and server traces will appear in your observability backend, fully linked!
