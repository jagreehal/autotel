# autotel-mcp-instrumentation

OpenTelemetry instrumentation for [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) with automatic distributed tracing.

Automatically instrument MCP servers and clients with OpenTelemetry tracing. Uses W3C Trace Context propagation via the `_meta` field to enable distributed tracing across MCP boundaries.

## Features

- **Automatic instrumentation** - One function call to instrument all tools, resources, and prompts
- **Distributed tracing** - W3C Trace Context propagation via `_meta` field
- **Transport-agnostic** - Works with stdio, HTTP, SSE, or any MCP transport
- **Node.js runtime** - Full support for Node.js applications with `autotel`
- **Tree-shakeable** - Import only what you need (~7KB total, 2-5KB per module)
- **Zero MCP modifications** - Uses Proxy pattern, no changes to MCP SDK required
- **Security observability** - Annotation hints, payload-size & character-budget signals, a pluggable prompt-injection classifier, and spotlighting helpers: the protocol-boundary half of the agentic-web defense-in-depth model ([see below](#security-observability))

## Installation

```bash
npm install autotel-mcp-instrumentation @modelcontextprotocol/server @modelcontextprotocol/client autotel
```

**Both MCP eras are supported from one call.** The v2 SDK
(`@modelcontextprotocol/server` / `@modelcontextprotocol/client`, protocol
`2026-07-28`) and the v1 `@modelcontextprotocol/sdk` (2025-era, still what most
shipped MCP clients use) are all optional peers — install whichever you build
against. Nothing is imported at runtime: the wrappers are duck-typed Proxies,
so era differences are read off each request rather than compiled in.

## Quick Start

### Server-Side Instrumentation

On `2026-07-28` there is no handshake and no session, so a server instance holds
nothing between requests: the SDK builds one per request from a factory.
Instrument inside that factory. (On the v1 SDK you hold a single `Server` and
instrument it once — same call, same attributes.)

```typescript
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { instrumentMcpServer } from 'autotel-mcp-instrumentation/server';
import { init } from 'autotel';
import { z } from 'zod';

// Telemetry first: OpenTelemetry must be initialised before anything traced
// is constructed.
init({
  service: 'mcp-weather-server',
  endpoint: 'http://localhost:4318',
});

function createServer() {
  const server = new McpServer(
    { name: 'weather', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  // Automatic tracing for all tools/resources/prompts registered below.
  const traced = instrumentMcpServer(server, {
    networkTransport: 'tcp',
    captureToolArgs: true, // opt-in: arguments on the span
    captureToolResults: false, // off by default: results may carry PII
  });

  traced.registerTool(
    'get_weather',
    {
      title: 'Get weather',
      description: 'Get current weather for a location',
      inputSchema: z.object({ location: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async ({ location }) => {
      // Traced, and parented to the caller's span via ctx.mcpReq._meta.
      const weather = await fetchWeather(location);
      return {
        content: [
          {
            type: 'text',
            text: `Temperature in ${location}: ${weather.temp}F`,
          },
        ],
      };
    },
  );

  return traced;
}

export default createMcpHandler(createServer);
```

### Client-Side Instrumentation

```typescript
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { instrumentMcpClient } from 'autotel-mcp-instrumentation/client';
import { init } from 'autotel';

init({
  service: 'mcp-weather-client',
  endpoint: 'http://localhost:4318',
});

const client = new Client({ name: 'weather-client', version: '1.0.0' });

// Instrument the client (automatic trace context injection)
const traced = instrumentMcpClient(client, {
  networkTransport: 'tcp',
  captureToolArgs: true,
});

await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));

// Tool calls create a span and inject _meta with traceparent/tracestate/baggage
const result = await traced.callTool({
  name: 'get_weather',
  arguments: { location: 'New York' },
});
```

## Protocol eras

MCP `2026-07-28` dropped the `initialize`/`initialized` handshake (SEP-2575) and
the `Mcp-Session-Id` header (SEP-2567). Every request is self-describing, so any
request can land on any instance behind a plain round-robin balancer. Instrument
the same way for either era — the differences below are handled for you.

**Propagation got easier, not harder.** `traceparent` always rode in `_meta`,
never in the session or the transport. `2026-07-28` makes `_meta` the mandatory
per-request envelope, so there is now always somewhere for it to ride, and no
session for a trace to be orphaned from.

**Where `_meta` lives.** Neither era puts it in the handler's first argument:
both SDKs validate `arguments` and hand the request metadata over on the context
argument. v2 nests it at `ctx.mcpReq._meta`; v1 has it at `extra._meta`. This
package finds the context by shape, so it also works for resource handlers,
which are `(uri, ctx)` or `(uri, variables, ctx)`.

| Signal                 | 2026-07-28                                                                   | 2025-era                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `mcp.protocol.version` | per-request, from the `io.modelcontextprotocol/protocolVersion` envelope key | not set (fixed at `initialize`)                                                               |
| `mcp.session.id`       | not set — there are no sessions                                              | from `extra.sessionId` (server) or the transport (client), falling back to `config.sessionId` |
| `server/discover`      | traced as a discovery operation                                              | n/a — `initialize` instead                                                                    |
| `mcp.input_required`   | set when a handler returns `inputRequired(...)`                              | n/a — elicitation is push-style                                                               |

Both come off the request rather than from config, so one instrumented server
answers many callers correctly, and neither can go stale across a reconnect.

**Multi-round-trip pauses are visible.** A `2026-07-28` handler that returns
`inputRequired(...)` instead of a result gets `mcp.input_required=true` on the
span and on the duration metric, and its span status is left UNSET rather than
OK. So "asked the user a question" neither lands in the same latency bucket as
"did the work" nor counts as a success, and the client's retry does not read as
a duplicate call. The key is deliberately not under `mcp.tool.*`: `prompts/get`
and `resources/read` can pause too.

The `mcp.*.session.duration` metrics are gone: they have nothing left to measure
on the current revision.

## API Reference

### Server Instrumentation

#### `instrumentMcpServer(server, config?)`

Wraps an MCP server to automatically trace all registered tools, resources, and
prompts. Call it on each instance your factory builds.

**Parameters:**

- `server` - `McpServer` instance
- `config` - Optional instrumentation configuration

**Returns:** Instrumented server (Proxy)

**Configuration Options:**

```typescript
interface McpInstrumentationConfig {
  captureToolArgs?: boolean; // Arguments as gen_ai.tool.call.arguments (default: false)
  captureToolResults?: boolean; // Results - may contain PII (default: false)
  captureErrors?: boolean; // Errors and exceptions (default: true)
  enableMetrics?: boolean; // Operation-duration histograms (default: true)
  captureDiscoveryOperations?: boolean; // tools/list, server/discover, ... (default: true)
  // Read per request in preference to this, so it stays correct on a server
  // handling many callers. Set it only for legacy stdio, whose transport has
  // no session at all. Modern requests ignore it because they are sessionless.
  sessionId?: string;
  networkTransport?: 'pipe' | 'tcp' | string; // network.transport
  customAttributes?: (context) => Attributes; // Custom span attributes
  // ...plus the security options documented below
}
```

**Span Attributes Set** (per the
[OTel MCP semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/)):

- `mcp.method.name` - `tools/call`, `resources/read`, `prompts/get`
- `gen_ai.tool.name` / `gen_ai.prompt.name` / `mcp.resource.uri` - the entity
- `gen_ai.operation.name` - `execute_tool` on tool spans
- `mcp.protocol.version` - the revision this request declared (2026-07-28)
- `mcp.session.id` - the connection's session (2025-era only)
- `error.type` - `tool_error` when the result carries `isError`
- `mcp.input_required` - the call paused for input instead of completing (span
  status is left UNSET, since a pause is neither success nor failure)
- `gen_ai.tool.call.arguments` / `gen_ai.tool.call.result` - opt-in only

### Client Instrumentation

#### `instrumentMcpClient(client, config?)`

Wraps an MCP client to create spans and inject trace context into every request.

**Parameters:**

- `client` - `Client` instance
- `config` - Optional instrumentation configuration

**Returns:** Instrumented client (Proxy)

**Traced methods:** `callTool`, `readResource`, `getPrompt`, and (when
`captureDiscoveryOperations` is on) `listTools`, `listResources`, `listPrompts`,
`ping`, `discover`.

Client spans carry the same attributes as server spans, with `SpanKind.CLIENT`.

### Context Utilities

#### `extractOtelContextFromMeta(meta?)`

Extract OpenTelemetry context from MCP `_meta`.

```typescript
import { extractOtelContextFromMeta } from 'autotel-mcp-instrumentation/context';
import { context } from '@opentelemetry/api';

const handler = async (args, ctx) => {
  const parentContext = extractOtelContextFromMeta(ctx.mcpReq._meta);
  return context.with(parentContext, async () => {
    // Your traced code with parent context
  });
};
```

#### `injectOtelContextToMeta(ctx?)`

Inject OpenTelemetry context into MCP `_meta`.

```typescript
import { injectOtelContextToMeta } from 'autotel-mcp-instrumentation/context';

const meta = injectOtelContextToMeta();
// Returns: { traceparent, tracestate, baggage }

await client.callTool({
  name: 'my_tool',
  arguments: { arg1: 'value' },
  _meta: meta,
});
```

#### `activateTraceContext(meta?)`

Extract and immediately activate trace context from `_meta`.

```typescript
import { activateTraceContext } from 'autotel-mcp-instrumentation/context';
import { context } from '@opentelemetry/api';

const traceCtx = activateTraceContext(serverCtx.mcpReq._meta);
return context.with(traceCtx, () => {
  // Traced code with parent context active
});
```

## How It Works

### W3C Trace Context Propagation

MCP requests can include a `_meta` field for metadata. `autotel-mcp-instrumentation` uses this field to propagate W3C Trace Context headers across client-server boundaries:

```
┌─────────────┐                    ┌─────────────┐
│ MCP Client  │                    │ MCP Server  │
│             │                    │             │
│  Span A     │──── callTool ────▶│  Span B     │
│             │    { args,         │             │
│             │      _meta: {      │ (parent: A) │
│             │        traceparent │             │
│             │        tracestate  │             │
│             │        baggage }}  │             │
└─────────────┘                    └─────────────┘

Distributed Trace:
  Span A (client) → Span B (server, child of A)
```

**Client Side:**

1. Creates span for tool call
2. Injects W3C trace context into `_meta` field
3. Sends request with `_meta`

**Server Side:**

1. Receives request with `_meta` field
2. Extracts parent trace context
3. Creates child span with parent context
4. Executes tool handler

### Transport Agnostic

Because context is in the JSON payload itself (not HTTP headers), this works with **any** MCP transport:

- stdio (standard input/output)
- HTTP/SSE (server-sent events)
- WebSocket
- Custom transports

## Runtime Support

```typescript
import { instrumentMcpServer } from 'autotel-mcp-instrumentation/server';
import { init } from 'autotel';

init({ service: 'my-mcp-server', endpoint: 'http://localhost:4318' });
const instrumented = instrumentMcpServer(server);
```

## Bundle Size

- **Core context utilities**: ~2KB
- **Server instrumentation**: ~3KB
- **Client instrumentation**: ~2KB
- **Total (all modules)**: ~7KB

Tree-shakeable - import only what you need:

```typescript
// Import just server instrumentation (~5KB)
import { instrumentMcpServer } from 'autotel-mcp-instrumentation/server';

// Import just client instrumentation (~4KB)
import { instrumentMcpClient } from 'autotel-mcp-instrumentation/client';

// Import just context utilities (~2KB)
import {
  extractOtelContextFromMeta,
  injectOtelContextToMeta,
} from 'autotel-mcp-instrumentation/context';
```

## Custom Attributes

Add custom span attributes based on your application logic:

```typescript
const instrumented = instrumentMcpServer(server, {
  customAttributes: ({ type, name, args, result }) => {
    const attrs: Attributes = {};

    // Add tenant ID from arguments
    if (args?.tenantId) {
      attrs['tenant.id'] = args.tenantId;
    }

    // Add result metadata
    if (result?.metadata) {
      attrs['result.metadata'] = JSON.stringify(result.metadata);
    }

    // Add operation-specific attributes
    if (type === 'tool' && name === 'search') {
      attrs['search.query'] = args?.query;
      attrs['search.results.count'] = result?.items?.length ?? 0;
    }

    return attrs;
  },
});
```

## Security Observability

MCP is where untrusted data crosses into your agent. The
[agentic-web threat model](https://developer.chrome.com/docs/agents/security)
has two vectors: **malicious manifests** (hidden instructions in a tool's
name/description/annotations) and **contaminated outputs** (injection smuggled
inside otherwise-legitimate tool results). Detecting these in production is an
_observability_ problem. And this package makes it observable at the MCP edge.

> **Where this fits.** Deterministic kill-switches (cost/token/tool-call
> ceilings, loop detection) live in
> [`autotel-genai/guard`](../autotel-genai); identity/scope/policy lives in
> [`autotel-genai/agent`](../autotel-genai). This package **observes and
> signals** at the protocol boundary so those layers: and your backend's
> alerting: have the data they need. It does not replace your agent runtime's
> guardrails.

### What you get for free

With no extra config, every instrumented tool span now carries:

- **Annotation hints** → `mcp.tool.read_only`, `mcp.tool.destructive`,
  `mcp.tool.idempotent`, `mcp.tool.open_world`, `mcp.tool.untrusted_content`
  (read off the tool's `annotations` block).
- **Payload sizes** → `mcp.tool.arguments.size` / `mcp.tool.result.size` (sizes
  only. No content). A tool whose output suddenly balloons is a classic
  injection / token-exhaustion tell.

```typescript
instrumentMcpServer(server); // annotation hints + payload sizes are on by default

server.registerTool(
  'search_web',
  {
    description: 'Search the web',
    annotations: { openWorldHint: true, untrustedContentHint: true },
  },
  async (args) => {
    /* ... */
  },
);
```

### Detect prompt injection with a classifier

Plug in [Model Armor](https://cloud.google.com/security/products/model-armor),
[Promptfoo](https://www.promptfoo.dev/), an LLM critic, or the built-in
heuristic detector. It scans manifest text at registration time
(name/description/parameter descriptions), then request/response payloads at
runtime for tools, resources, and prompts, recording `mcp.security.*`
attributes and emitting security events on non-clean verdicts. Classifier
failures never break the traced call.

```typescript
import {
  instrumentMcpServer,
  heuristicInjectionClassifier,
  MCP_CHAR_BUDGETS,
} from 'autotel-mcp-instrumentation';

instrumentMcpServer(server, {
  // First-pass heuristic, or supply your own (sync or async):
  securityClassifier: heuristicInjectionClassifier(),
  // Custom example:
  // securityClassifier: async ({ source, text }) => {
  //   const r = await modelArmor.scan(text);
  //   return { verdict: r.malicious ? 'malicious' : 'clean', score: r.score };
  // },

  // Emit mcp.security.budget_exceeded when output overflows (WebMCP: 1500 chars):
  outputCharBudget: MCP_CHAR_BUDGETS.TOOL_OUTPUT,
});
```

> The built-in `heuristicInjectionClassifier()` is a cheap tripwire, not ground
> truth: it produces false positives and misses novel attacks. Treat its signal
> as input to a critic / Model Armor, not as a verdict.

### Spotlight untrusted content before an LLM reads it

[Spotlighting](https://arxiv.org/abs/2403.14720) demarcates untrusted data so a
model treats it as data, not instructions.

```typescript
import { spotlight } from 'autotel-mcp-instrumentation/security';

const safe = spotlight(userComment); // <untrusted>\n…\n</untrusted>
const robust = spotlight(userComment, { method: 'base64' }); // resists structural evasion
```

### Validate tool descriptions against WebMCP budgets

```typescript
import { validateToolBudget } from 'autotel-mcp-instrumentation/security';

const violations = validateToolBudget({
  name: 'search_web',
  description: 'Search the web for…',
  parameters: { query: { description: 'The search query' } },
});
// violations: [] when within the recommended 30/150/500-char limits
```

### Workers / edge

The `autotel-mcp-instrumentation/security` toolkit (classifier, `spotlight`,
`validateToolBudget`, annotation/size/budget helpers) is **runtime-agnostic**.
It depends only on `@opentelemetry/api`, with a `Buffer`→`btoa` base64 fallback.
So it runs unchanged in Cloudflare Workers and other edge runtimes. Use it
directly in an edge MCP server, or alongside `autotel-cloudflare`. The same
`mcp.security.*` signals are emitted, so `autotel security mcp` queries work
across Node and Workers deployments.

### Security signals reference

| Signal                             | Where     | Meaning                                 |
| ---------------------------------- | --------- | --------------------------------------- |
| `mcp.tool.*` (hints)               | span attr | tool trust profile / manifest vector    |
| `mcp.tool.{arguments,result}.size` | span attr | payload size (token-exhaustion tell)    |
| `mcp.security.injection.*`         | span attr | classifier verdict / score / categories |
| `mcp.security.injection_suspected` | event     | non-clean classifier verdict            |
| `mcp.security.budget_exceeded`     | event     | output over `outputCharBudget`          |
| `mcp.security.events`              | counter   | aggregate security-signal count         |

## Security Considerations

### PII in Arguments/Results

Both are opt-in, so nothing leaks unless you ask for it:

```typescript
const instrumented = instrumentMcpServer(server, {
  captureToolArgs: true, // May contain PII
  captureToolResults: false, // Default - may contain sensitive data
});
```

For production:

- Review what data is in tool arguments
- Leave `captureToolArgs` off if arguments contain PII
- Never enable `captureToolResults` in production unless you control the data

### Custom PII Redaction

Use `customAttributes` to redact PII:

```typescript
const instrumented = instrumentMcpServer(server, {
  captureToolArgs: false, // Keep raw arguments off the span
  customAttributes: ({ args }) => {
    // Manually redact PII before logging
    return {
      'tool.location': args?.location, // Safe to log
      // Omit args.email, args.userId, etc.
    };
  },
});
```

## Examples

See the `apps/` directory for complete working examples:

- `apps/example-mcp-server` - Instrumented MCP server with stdio transport
- `apps/example-mcp-client` - Instrumented MCP client calling the server

## Integration with Observability Backends

Works with any OTLP-compatible backend:

```typescript
import { init } from 'autotel';

// Honeycomb
init({
  service: 'mcp-server',
  endpoint: 'https://api.honeycomb.io',
  headers: { 'x-honeycomb-team': process.env.HONEYCOMB_API_KEY },
});

// Datadog
init({
  service: 'mcp-server',
  endpoint: 'https://http-intake.logs.datadoghq.com',
  headers: { 'DD-API-KEY': process.env.DD_API_KEY },
});
```

## License

Apache-2.0

## Contributing

Issues and PRs welcome at [github.com/jagreehal/autotel](https://github.com/jagreehal/autotel)
