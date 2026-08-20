---
name: autotel-mcp-instrumentation
description: >
  Use this skill when instrumenting an MCP (Model Context Protocol) server or client with OpenTelemetry — instrumentMcpServer/instrumentMcpClient, W3C trace context via _meta across tools/resources/prompts, and MCP security signals (payload-size and char-budget limits, prompt-injection classifier, spotlighting).
---

# autotel-mcp-instrumentation

Instrument MCP servers and clients with OpenTelemetry. One call wraps tools, resources, and prompts; W3C Trace Context is propagated via the `_meta` field (traceparent, tracestate). Works with Node (autotel) or Edge (autotel-edge).

Supports **both protocol eras** from the same call: MCP `2026-07-28` (v2 SDK,
`@modelcontextprotocol/server` + `@modelcontextprotocol/client`) and the 2025-era
v1 `@modelcontextprotocol/sdk`. All three are optional peers; nothing is imported
at runtime, and the era is detected per request.

## Setup

**Server, MCP 2026-07-28.** The protocol is stateless: no `initialize`
handshake, no session, so the SDK builds a server **per request** from a
factory. Instrument inside the factory:

```typescript
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { instrumentMcpServer } from 'autotel-mcp-instrumentation/server';

function createServer() {
  const server = new McpServer(
    { name: 'my-server', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  // Instrument BEFORE registering, so the proxy wraps the real handlers.
  return instrumentMcpServer(server, { networkTransport: 'tcp' });
}

export default createMcpHandler(createServer);
```

**Server, 2025-era.** Hold one `Server` and instrument it once — same call:

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

const server = instrumentMcpServer(new Server(...));
```

**Client:** Use `instrumentMcpClient` from `autotel-mcp-instrumentation/client`
to wrap the client so tool/resource/prompt calls create spans and propagate
context. `callTool` takes an object: `callTool({ name, arguments })`.

## Entry points

- `autotel-mcp-instrumentation`: all exports
- `autotel-mcp-instrumentation/server`: server instrumentation only
- `autotel-mcp-instrumentation/client`: client instrumentation only
- `autotel-mcp-instrumentation/context`: extract/inject context from `_meta`
- `autotel-mcp-instrumentation/security`: classifier, spotlighting, budget helpers

## Core patterns

Context is carried in the JSON payload `_meta` field (traceparent, tracestate,
baggage), not in HTTP headers, so it works with any MCP transport (stdio,
Streamable HTTP, custom). Init autotel or autotel-edge before instrumenting the
server or client.

The `_meta` keys are the bare `traceparent` / `tracestate` / `baggage` names,
NOT the reserved `io.modelcontextprotocol/*` envelope namespace — that is what
lets them survive the v2 SDK's envelope lift.

## Protocol eras

`2026-07-28` dropped the `initialize` handshake (SEP-2575) and the
`Mcp-Session-Id` header (SEP-2567), so every request is self-describing and any
request can land on any instance. Propagation got _easier_: `_meta` is now the
mandatory per-request envelope, so there is always somewhere for a traceparent
to ride and no session for a trace to be orphaned from.

| Signal                 | 2026-07-28                                      | 2025-era                          |
| ---------------------- | ----------------------------------------------- | --------------------------------- |
| `mcp.protocol.version` | per request, from the `_meta` envelope          | not set (fixed at `initialize`)   |
| `mcp.session.id`       | not set — no sessions                           | from the request or the transport |
| `server/discover`      | traced as a discovery op                        | n/a — `initialize` instead        |
| `mcp.input_required`   | set when a handler returns `inputRequired(...)` | n/a — elicitation is push-style   |

A handler that returns `inputRequired(...)` paused rather than completed: the
span gets `mcp.input_required=true` and its status is left UNSET, so a pause is
counted as neither work nor a success, and the client's retry is not a duplicate.

## Security observability

The MCP boundary is where untrusted data enters an agent. This package makes the
agentic-web threat model (Chrome/Google WebMCP guidance) observable at that edge.
It **observes and signals**. It does NOT enforce. Deterministic kill-switches
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

Call `instrumentMcpServer(server)` before registering tools/resources/prompts so the proxy wraps the real implementations.

Source: packages/autotel-mcp-instrumentation/CLAUDE.md

### HIGH Look for `_meta` in a handler's first argument

Neither SDK puts it there. Both validate `arguments` and hand the request
metadata over on the **context** argument: v2 `ctx.mcpReq._meta`, v1
`extra._meta`. Reading `_meta` off the arguments finds nothing and silently
orphans every server span — the trace still looks fine locally, it just never
joins the client's. `instrumentMcpServer` handles this; only hand-rolled
instrumentation gets it wrong.

Source: packages/autotel-mcp-instrumentation/src/server.ts

### HIGH Assume the handler's first argument is the tool arguments

A tool registered **without** an input schema is invoked as `(ctx)` on both
SDKs, so `args[0]` is the context. Serialising it into a span attribute leaks
`http.authInfo.token`. Establish where the context is first, then treat
`args[0]` as a payload only if it is not that.

Source: packages/autotel-mcp-instrumentation/src/server.ts

### MEDIUM Expect trace context in HTTP headers for MCP

MCP uses `_meta` in the JSON body for context. Use the package's context helpers to extract/inject; do not rely on headers for MCP-over-HTTP.

Source: packages/autotel-mcp-instrumentation/CLAUDE.md

### MEDIUM Detect `input_required` by sniffing for `inputRequests`/`requestState`

Results are passthrough-typed, so a handler may legitimately return a field by
either name. The discriminator is `resultType === 'input_required'`.

Source: packages/autotel-mcp-instrumentation/src/server.ts

### MEDIUM Treat the built-in heuristic classifier as ground truth

`heuristicInjectionClassifier()` is a cheap tripwire. False positives and missed novel attacks are expected. Use it as a signal feeding a real classifier (Model Armor) or an LLM critic; never gate destructive actions on it alone.

Source: packages/autotel-mcp-instrumentation/security.ts

### MEDIUM Reimplement enforcement here instead of in genai

This package detects/signals at the MCP boundary. For enforcement use `autotel-genai/guard` (cost/token/tool-call ceilings, loop detection) and `autotel-genai/agent` (identity/scope/policy). Do not add kill-switches or scope checks to the MCP layer.

Source: packages/autotel-mcp-instrumentation/CLAUDE.md

## Version

Targets autotel-mcp-instrumentation. Requires autotel or autotel-edge, plus an
MCP SDK: `@modelcontextprotocol/server` / `@modelcontextprotocol/client` ^2
(protocol `2026-07-28`) and/or `@modelcontextprotocol/sdk` ^1.30 (2025-era).
All are optional peers. See packages/autotel-mcp-instrumentation/CLAUDE.md for
full patterns.
