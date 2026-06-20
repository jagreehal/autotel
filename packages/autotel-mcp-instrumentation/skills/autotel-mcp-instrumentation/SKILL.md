---
name: autotel-mcp-instrumentation
description: >
  OpenTelemetry instrumentation for MCP (Model Context Protocol). instrumentMCPServer, instrumentMCPClient; W3C trace context via _meta; tools, resources, prompts. Security observability: annotation hints, payload-size & char-budget signals, pluggable prompt-injection classifier, spotlighting.
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
- `autotel-mcp-instrumentation/security` — classifier, spotlighting, budget helpers

## Core patterns

Context is carried in the JSON payload `_meta` field (traceparent, tracestate, baggage), not in HTTP headers, so it works with any MCP transport (stdio, HTTP, SSE). Init autotel or autotel-edge before instrumenting the server or client.

## Security observability

The MCP boundary is where untrusted data enters an agent. This package makes the
agentic-web threat model (Chrome/Google WebMCP guidance) observable at that edge.
It **observes and signals** — it does NOT enforce. Deterministic kill-switches
(cost/token/tool-call ceilings, loop detection) live in `autotel-genai/guard`;
identity/scope/policy in `autotel-genai/agent`. Recommend those for enforcement,
this for detection.

On by default (no config): annotation hints → `mcp.tool.*` attrs
(`read_only`, `destructive`, `idempotent`, `open_world`, `untrusted_content`);
payload sizes → `mcp.tool.{arguments,result}.size`.

Opt-in:

```typescript
import {
  instrumentMcpServer,
  heuristicInjectionClassifier,
  MCP_CHAR_BUDGETS,
} from 'autotel-mcp-instrumentation';

instrumentMcpServer(server, {
  securityClassifier: heuristicInjectionClassifier(), // or Model Armor / LLM critic
  outputCharBudget: MCP_CHAR_BUDGETS.TOOL_OUTPUT, // emits mcp.security.budget_exceeded
});
```

Classifier scans tool args (server + client) and results (the contaminated-output
vector), recording `mcp.security.injection.*` + emitting
`mcp.security.injection_suspected`. Failures never break the traced call.
Standalone helpers: `spotlight(text, { method })` to demarcate untrusted content,
`validateToolBudget(tool)` to check descriptions against WebMCP char limits.

## Common mistakes

### HIGH Instrument MCP after the server has already registered tools

Call `instrumentMCPServer(server)` before registering tools/resources/prompts so the proxy wraps the real implementations.

Source: packages/autotel-mcp-instrumentation/CLAUDE.md

### MEDIUM Expect trace context in HTTP headers for MCP

MCP uses `_meta` in the JSON body for context. Use the package's context helpers to extract/inject; do not rely on headers for MCP-over-HTTP.

Source: packages/autotel-mcp-instrumentation/CLAUDE.md

### MEDIUM Treat the built-in heuristic classifier as ground truth

`heuristicInjectionClassifier()` is a cheap tripwire — false positives and missed novel attacks are expected. Use it as a signal feeding a real classifier (Model Armor) or an LLM critic; never gate destructive actions on it alone.

Source: packages/autotel-mcp-instrumentation/security.ts

### MEDIUM Reimplement enforcement here instead of in genai

This package detects/signals at the MCP boundary. For enforcement use `autotel-genai/guard` (cost/token/tool-call ceilings, loop detection) and `autotel-genai/agent` (identity/scope/policy). Do not add kill-switches or scope checks to the MCP layer.

Source: packages/autotel-mcp-instrumentation/CLAUDE.md

## Version

Targets autotel-mcp-instrumentation. Requires MCP SDK and autotel or autotel-edge. See packages/autotel-mcp-instrumentation/CLAUDE.md for full patterns.
