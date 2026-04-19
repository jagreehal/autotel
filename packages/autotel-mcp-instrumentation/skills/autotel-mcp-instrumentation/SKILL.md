---
name: autotel-mcp-instrumentation
description: >
  OpenTelemetry instrumentation for MCP (Model Context Protocol). instrumentMCPServer, instrumentMCPClient; W3C trace context via _meta; tools, resources, prompts.
type: integration
library: autotel-mcp-instrumentation
sources:
  - jagreehal/autotel:packages/autotel-mcp-instrumentation/CLAUDE.md
---

# autotel-mcp-instrumentation

Instrument MCP servers and clients with OpenTelemetry. One call wraps tools, resources, and prompts; W3C Trace Context is propagated via the `_meta` field (traceparent, tracestate). Works with Node (autotel) or Edge (autotel-edge).

## Setup

**Server (Node or Edge):**

```typescript
import { instrumentMCPServer } from 'autotel-mcp-instrumentation/server';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

const server = new Server(...);
instrumentMCPServer(server);
```

**Client:** Use `instrumentMCPClient` from `autotel-mcp-instrumentation/client` to wrap the client so tool/resource/prompt calls create spans and propagate context.

## Entry points

- `autotel-mcp-instrumentation` — all exports
- `autotel-mcp-instrumentation/server` — server instrumentation only
- `autotel-mcp-instrumentation/client` — client instrumentation only
- `autotel-mcp-instrumentation/context` — extract/inject context from `_meta`

## Core patterns

Context is carried in the JSON payload `_meta` field (traceparent, tracestate, baggage), not in HTTP headers, so it works with any MCP transport (stdio, HTTP, SSE). Init autotel or autotel-edge before instrumenting the server or client.

## Common mistakes

### HIGH Instrument MCP after the server has already registered tools

Call `instrumentMCPServer(server)` before registering tools/resources/prompts so the proxy wraps the real implementations.

Source: packages/autotel-mcp-instrumentation/CLAUDE.md

### MEDIUM Expect trace context in HTTP headers for MCP

MCP uses `_meta` in the JSON body for context. Use the package's context helpers to extract/inject; do not rely on headers for MCP-over-HTTP.

Source: packages/autotel-mcp-instrumentation/CLAUDE.md

## Version

Targets autotel-mcp-instrumentation. Requires MCP SDK and autotel or autotel-edge. See packages/autotel-mcp-instrumentation/CLAUDE.md for full patterns.
