---
name: autotel-mcp
description: >
  OpenTelemetry instrumentation for MCP (Model Context Protocol). instrumentMCPServer, instrumentMCPClient; W3C trace context via _meta; tools, resources, prompts.
type: integration
library: autotel-mcp
sources:
  - jagreehal/autotel:packages/autotel-mcp/CLAUDE.md
---

# autotel-mcp

Instrument MCP servers and clients with OpenTelemetry. One call wraps tools, resources, and prompts; W3C Trace Context is propagated via the `_meta` field (traceparent, tracestate). Works with Node (autotel) or Edge (autotel-edge).

## Setup

**Server (Node or Edge):**

```typescript
import { instrumentMCPServer } from 'autotel-mcp/server';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

const server = new Server(...);
instrumentMCPServer(server);
```

**Client:** Use `instrumentMCPClient` from `autotel-mcp/client` to wrap the client so tool/resource/prompt calls create spans and propagate context.

## Entry points

- `autotel-mcp` — all exports
- `autotel-mcp/server` — server instrumentation only
- `autotel-mcp/client` — client instrumentation only
- `autotel-mcp/context` — extract/inject context from `_meta`

## Core patterns

Context is carried in the JSON payload `_meta` field (traceparent, tracestate, baggage), not in HTTP headers, so it works with any MCP transport (stdio, HTTP, SSE). Init autotel or autotel-edge before instrumenting the server or client.

## Common mistakes

### HIGH Instrument MCP after the server has already registered tools

Call `instrumentMCPServer(server)` before registering tools/resources/prompts so the proxy wraps the real implementations.

Source: packages/autotel-mcp/CLAUDE.md

### MEDIUM Expect trace context in HTTP headers for MCP

MCP uses `_meta` in the JSON body for context. Use the package's context helpers to extract/inject; do not rely on headers for MCP-over-HTTP.

Source: packages/autotel-mcp/CLAUDE.md

## Version

Targets autotel-mcp. Requires MCP SDK and autotel or autotel-edge. See packages/autotel-mcp/CLAUDE.md for full patterns.
