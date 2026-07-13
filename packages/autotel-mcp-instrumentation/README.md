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
- **Security observability** - Annotation hints, payload-size & character-budget signals, a pluggable prompt-injection classifier, and spotlighting helpers — the protocol-boundary half of the agentic-web defense-in-depth model ([see below](#security-observability))

## Installation

```bash
npm install autotel-mcp-instrumentation @modelcontextprotocol/sdk autotel
```

## Quick Start

### Server-Side Instrumentation

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';
import { instrumentMcpServer } from 'autotel-mcp-instrumentation/server';
import { init } from 'autotel';

// Initialize OpenTelemetry
init({
  service: 'mcp-weather-server',
  endpoint: 'http://localhost:4318',
});

const server = new Server({
  name: 'weather',
  version: '1.0.0',
});

// Instrument the server (automatic tracing for all tools/resources/prompts)
const instrumented = instrumentMcpServer(server, {
  captureArgs: true, // Log tool arguments
  captureResults: false, // Don't log results (PII concerns)
});

// Register tools normally - they're automatically traced!
instrumented.registerTool({
  name: 'get_weather',
  description: 'Get current weather for a location',
  inputSchema: {
    type: 'object',
    properties: {
      location: { type: 'string' },
    },
    required: ['location'],
  },
  handler: async (args) => {
    // This handler is automatically traced with parent context from _meta
    const weather = await fetchWeather(args.location);
    return {
      content: [
        {
          type: 'text',
          text: `Temperature in ${args.location}: ${weather.temp}°F`,
        },
      ],
    };
  },
});

await server.connect(new StdioServerTransport());
```

### Client-Side Instrumentation

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio';
import { instrumentMcpClient } from 'autotel-mcp-instrumentation/client';
import { init } from 'autotel';

// Initialize OpenTelemetry
init({
  service: 'mcp-weather-client',
  endpoint: 'http://localhost:4318',
});

const client = new Client({
  name: 'weather-client',
  version: '1.0.0',
});

// Instrument the client (automatic trace context injection)
const instrumented = instrumentMcpClient(client, {
  captureArgs: true,
  captureResults: false,
});

await client.connect(new StdioClientTransport(/* ... */));

// Tool calls automatically create spans and inject _meta with trace context
const result = await instrumented.callTool('get_weather', {
  location: 'New York',
  // _meta field is automatically injected with traceparent/tracestate/baggage
});
```

## API Reference

### Server Instrumentation

#### `instrumentMcpServer(server, config?)`

Wraps an MCP server to automatically trace all registered tools, resources, and prompts.

**Parameters:**

- `server` - MCP Server instance
- `config` - Optional instrumentation configuration

**Returns:** Instrumented server (Proxy)

**Configuration Options:**

```typescript
interface McpInstrumentationConfig {
  captureArgs?: boolean; // Capture tool/resource arguments (default: true)
  captureResults?: boolean; // Capture results - may contain PII (default: false)
  captureErrors?: boolean; // Capture errors and exceptions (default: true)
  customAttributes?: (context) => Attributes; // Custom span attributes
}
```

**Span Attributes Set:**

- `mcp.type` - Operation type ('tool', 'resource', 'prompt')
- `mcp.tool.name` / `mcp.resource.name` / `mcp.prompt.name` - Name
- `mcp.tool.args` - Arguments (if `captureArgs: true`)
- `mcp.tool.result` - Result (if `captureResults: true`)

### Client Instrumentation

#### `instrumentMcpClient(client, config?)`

Wraps an MCP client to automatically create spans and inject trace context for all requests.

**Parameters:**

- `client` - MCP Client instance
- `config` - Optional instrumentation configuration

**Returns:** Instrumented client (Proxy)

**Span Attributes Set:**

- `mcp.client.operation` - Operation type ('callTool', 'getResource', 'getPrompt')
- `mcp.client.name` - Tool/resource/prompt name
- `mcp.client.args` - Arguments (if `captureArgs: true`)
- `mcp.client.result` - Result (if `captureResults: true`)

### Context Utilities

#### `extractOtelContextFromMeta(meta?)`

Extract OpenTelemetry context from MCP `_meta` field.

```typescript
import { extractOtelContextFromMeta } from 'autotel-mcp-instrumentation/context';
import { context } from '@opentelemetry/api';

const handler = async (args, _meta) => {
  const parentContext = extractOtelContextFromMeta(_meta);
  return context.with(parentContext, async () => {
    // Your traced code with parent context
  });
};
```

#### `injectOtelContextToMeta(ctx?)`

Inject OpenTelemetry context into MCP `_meta` field.

```typescript
import { injectOtelContextToMeta } from 'autotel-mcp-instrumentation/context';

const meta = injectOtelContextToMeta();
// Returns: { traceparent, tracestate, baggage }

await client.callTool('my_tool', { arg1: 'value', _meta: meta });
```

#### `activateTraceContext(meta?)`

Extract and immediately activate trace context from `_meta` field.

```typescript
import { activateTraceContext } from 'autotel-mcp-instrumentation/context';
import { context } from '@opentelemetry/api';

const ctx = activateTraceContext(_meta);
return context.with(ctx, () => {
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
_observability_ problem — and this package makes it observable at the MCP edge.

> **Where this fits.** Deterministic kill-switches (cost/token/tool-call
> ceilings, loop detection) live in
> [`autotel-genai/guard`](../autotel-genai); identity/scope/policy lives in
> [`autotel-genai/agent`](../autotel-genai). This package **observes and
> signals** at the protocol boundary so those layers — and your backend's
> alerting — have the data they need. It does not replace your agent runtime's
> guardrails.

### What you get for free

With no extra config, every instrumented tool span now carries:

- **Annotation hints** → `mcp.tool.read_only`, `mcp.tool.destructive`,
  `mcp.tool.idempotent`, `mcp.tool.open_world`, `mcp.tool.untrusted_content`
  (read off the tool's `annotations` block).
- **Payload sizes** → `mcp.tool.arguments.size` / `mcp.tool.result.size` (sizes
  only — no content). A tool whose output suddenly balloons is a classic
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
> truth — it produces false positives and misses novel attacks. Treat its signal
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
`validateToolBudget`, annotation/size/budget helpers) is **runtime-agnostic** —
it depends only on `@opentelemetry/api`, with a `Buffer`→`btoa` base64 fallback —
so it runs unchanged in Cloudflare Workers and other edge runtimes. Use it
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

By default, `captureResults` is disabled to prevent PII leakage:

```typescript
const instrumented = instrumentMcpServer(server, {
  captureArgs: true, // May contain PII
  captureResults: false, // DISABLED by default - may contain sensitive data
});
```

For production:

- Review what data is in tool arguments
- Disable `captureArgs` if arguments contain PII
- Never enable `captureResults` in production unless you control the data

### Custom PII Redaction

Use `customAttributes` to redact PII:

```typescript
const instrumented = instrumentMcpServer(server, {
  captureArgs: false, // Disable default arg capture
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
