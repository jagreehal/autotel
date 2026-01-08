# autotel-mcp (Model Context Protocol)

OpenTelemetry instrumentation for Model Context Protocol (MCP) with distributed tracing.

## Your Role

You are working on the MCP instrumentation package. You understand MCP protocol, W3C Trace Context propagation, and how to instrument MCP servers and clients without modifying the SDK.

## Tech Stack

- **Runtime**: Both Node.js (autotel) and Edge (autotel-edge)
- **MCP SDK**: v1.0.0+ (uses Zod v3 - autotel doesn't use Zod so no conflict)
- **Bundle Size**: ~7KB total (context 2KB + server 3KB + client 2KB)
- **Build**: tsup
- **Testing**: vitest (unit + integration)

## Key Concepts

- **Automatic Instrumentation**: One function call to instrument all tools, resources, and prompts
- **Distributed Tracing**: W3C Trace Context propagation through `_meta` field (traceparent, tracestate, baggage)
- **Transport-Agnostic**: Works with stdio, HTTP, SSE, or any MCP transport (context in JSON payload, not headers)
- **Proxy-Based Pattern**: Similar to autotel-cloudflare bindings instrumentation (no MCP SDK modifications)
- **Runtime Support**: Both Node.js (autotel) and Edge (autotel-edge)

## Entry Points

- `autotel-mcp` - Everything (server + client + context utilities)
- `autotel-mcp/server` - Server instrumentation only (~5KB)
- `autotel-mcp/client` - Client instrumentation only (~4KB)
- `autotel-mcp/context` - Context utilities only (~2KB)

## Commands

```bash
# In packages/autotel-mcp directory
pnpm test               # Unit tests
pnpm test:integration   # Integration tests (requires MCP SDK)
pnpm build              # Build package
pnpm lint               # Lint package
```

## File Structure

- `src/index.ts` - Main exports
- `src/server.ts` - Server instrumentation (wraps registerTool, registerResource, registerPrompt)
- `src/client.ts` - Client instrumentation (wraps callTool, getResource, getPrompt)
- `src/context.ts` - Context utilities (extractOtelContextFromMeta, injectOtelContextToMeta)
- `src/runtime.ts` - Runtime detection (auto-imports from autotel or autotel-edge)

## Code Patterns

### Proxy-Based Instrumentation

Uses Proxy pattern to wrap MCP SDK methods:

```typescript
// Server instrumentation
import { instrumentMCPServer } from 'autotel-mcp/server';

const server = new Server({
  name: 'my-server',
  version: '1.0.0',
});

// Instrument all tools, resources, prompts
instrumentMCPServer(server, {
  service: 'my-mcp-server',
  endpoint: 'https://api.honeycomb.io',
});

// Now all registerTool(), registerResource(), registerPrompt() calls are traced
```

### Context Propagation

W3C Trace Context via `_meta` field (not headers):

```typescript
// Client injects context into _meta
import { injectOtelContextToMeta } from 'autotel-mcp/context';

const request = {
  method: 'tools/call',
  params: { name: 'my-tool', arguments: {} },
  _meta: injectOtelContextToMeta({}), // Adds traceparent, tracestate, baggage
};

// Server extracts context from _meta
import { extractOtelContextFromMeta } from 'autotel-mcp/context';

const parentContext = extractOtelContextFromMeta(request._meta);
// Use parentContext to create child spans
```

## Boundaries

- ✅ **Always do**: Use Proxy pattern, maintain transport-agnostic design, support both runtimes
- ⚠️ **Ask first**: Modifying MCP SDK usage, changing context propagation format
- 🚫 **Never do**: Modify MCP SDK, break transport-agnostic design, use headers for context

## Testing

- Unit tests: Mock MCP SDK methods
- Integration tests: Use real MCP SDK (v1.0.0+)
- Test context propagation across client-server boundaries
- Test all transports (stdio, HTTP, SSE)

## Why Better than Manual Instrumentation

- No need to manually wrap each tool handler
- Automatic parent-child span relationships across client-server boundaries
- Transport-agnostic (works with any MCP transport, not just HTTP)
- Consistent span naming and attributes
