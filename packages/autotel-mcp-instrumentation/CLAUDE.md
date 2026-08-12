# autotel-mcp-instrumentation (Model Context Protocol)

OpenTelemetry instrumentation for Model Context Protocol (MCP) with distributed tracing.

## Your Role

You are working on the MCP instrumentation package. You understand MCP protocol, W3C Trace Context propagation, and how to instrument MCP servers and clients without modifying the SDK.

## Tech Stack

- **Runtime**: Both Node.js (autotel) and Edge (autotel-edge)
- **MCP revisions**: both eras. `2026-07-28` (stateless: no `initialize` handshake, no `Mcp-Session-Id`) and the 2025-era family.
- **MCP SDK**: `@modelcontextprotocol/server` + `@modelcontextprotocol/client` ^2 (2026-07-28) and `@modelcontextprotocol/sdk` ^1.30 (2025-era), all three **optional peers**.
- **Zero runtime SDK import**: every wrapper is duck-typed through a Proxy, so no SDK package is pulled into the bundle, and era support costs no dependency. Reserved `_meta` key literals are mirrored in `semantic-conventions.ts` rather than imported. Era is detected per request, never compiled in.
- **Bundle Size**: ~7KB total (context 2KB + server 3KB + client 2KB)
- **Build**: tsdown
- **Testing**: vitest (unit + integration)

## Key Concepts

- **Automatic Instrumentation**: One function call to instrument all tools, resources, and prompts
- **Distributed Tracing**: W3C Trace Context propagation through `_meta` (bare `traceparent`/`tracestate`/`baggage` keys, NOT the `io.modelcontextprotocol/*` envelope namespace, so they survive the SDK's envelope lift)
- **`_meta` is never in the first argument**: both SDKs validate `arguments` and hand request metadata over on the context argument. `server.ts:readRequestFacts` is the single place that normalises this, locating the context **by shape, not position** (resources are `(uri, ctx)` / `(uri, variables, ctx)`, a no-input handler is just `(ctx)`). Scanning from the END is the load-bearing part: a tool's own arguments may carry a `_meta`/`requestId` key, and a forward scan would parent the span onto caller-supplied trace context — there is a test for exactly that. In all current shapes the context is last, so the loop is equivalent to `args.at(-1)` for them; it keeps scanning only so an unexpected trailing value cannot blind it. v2: `ctx.mcpReq._meta` + `ctx.mcpReq.envelope`. v1: `extra._meta` + `extra.sessionId`. Reading `_meta` off the arguments finds nothing and silently orphans every server span — covered by a test per era.
- **Era-dependent attributes come off the request, not config**: `mcp.protocol.version` from the 2026-07-28 envelope (or the client's negotiated revision); `mcp.session.id` from a 2025-era request (or, on the client, `client.transport.sessionId`). `config.sessionId` exists only as a fallback for legacy stdio, whose transport has no session at all; modern requests ignore it — the request always wins, so one instrumented server answers many callers correctly.
- **`args[0]` is not always the payload**: a handler registered without an input schema is called as `(ctx)` on both SDKs. `readCallPayload` returns `undefined` when `readRequestFacts` found the context at index 0. Skipping that check serialises the whole context — including `http.authInfo.token` — into `gen_ai.tool.call.arguments`. Covered by a test that greps the recorded attributes for the token.
- **Multi-round-trip**: a handler returning `inputRequired(...)` sets `mcp.input_required` on the span and the duration metric, and leaves span status UNSET, so a pause is counted as neither completed work nor a success. Detected via the SDK's `resultType === 'input_required'` discriminator — NOT by sniffing `inputRequests`/`requestState`, which results may legitimately carry. The key is not under `mcp.tool.*` because prompts and resources can pause too.
- **Client wrappers forward trailing arguments verbatim** (`...rest`): v1 `callTool` is `(params, resultSchema?, options?)`, v2 is `(params, options?)`. Only `params` is rewritten (to inject `_meta`), so the wrapper never has to know which era it is in. Do not re-introduce named trailing parameters.
- **Transport-Agnostic**: Works with stdio, HTTP, SSE, or any MCP transport (context in JSON payload, not headers)
- **Proxy-Based Pattern**: Similar to autotel-cloudflare bindings instrumentation (no MCP SDK modifications)
- **Runtime Support**: Both Node.js (autotel) and Edge (autotel-edge)
- **Failure grouping** (`src/failure.ts`): `error.type` says a call failed; `mcp.failure.category` + `mcp.failure.fingerprint` say whether it is the _same_ failure. Applied on every failure path, on both sides of the trace: a handler or a call that throws, and an `isError` result produced or received. On the client that means all four traced entry points, not just `callTool` — `resources/read` and `prompts/get` fail by rejecting, never by returning `isError`, so grouping only the result path would leave the most common infra failure ungrouped. `thrownFailure()` is the one place a thrown error is turned into text + category, because the span attributes are gated on `captureErrors` while the duration metric is not. `isError` arrives inside a well-formed result, so nothing throws; marking the client span OK on that basis left the caller's half of the trace claiming success while the server's said ERROR. `applyFailureGrouping` is shared by both wrappers precisely so the two ends cannot drift into different groups for one bug. The same `isError` verdict is passed to the **guard** step's `error` flag (`client.ts`), which previously hardcoded `false` — an error-loop rule could not accumulate on the failure mode MCP tools actually use. It is computed once, right after the call returns, because the guard is fed before the span status is set and the two must not disagree. The fingerprint is a hash of the failure text with run-specific values stripped (UUIDs, hex ids, **every** digit run, quoted values), so two occurrences of one bug agree on it across processes — which is what makes it usable as a correlation key on a stateless deployment, where there is no session to accumulate against. Classification runs on the **raw** text, never the normalised form: normalisation replaces digit runs and would erase the `401`/`503` the channel patterns depend on. Only the category goes on the duration metric; the fingerprint is one series per distinct bug and stays on the span. No text to group on → no attributes at all, because a fingerprint of the empty string collapses every unrelated silent failure into one group that reads as a high-frequency bug that does not exist.
- **Manifest assessment is memoised at module scope** (`server.ts`): assessment happens at registration time, and `2026-07-28` builds a server per request — so `instrumentMcpServer` runs per request, and without the memo a `securityClassifier` (potentially an LLM call) is billed on every request to re-read a description that has not changed. Module scope is the only scope that outlives the per-request server. Keyed by classifier **first**, then the normalised surface: two configs may disagree about the same text, and a shared verdict would attribute one classifier's security finding to the other.
- **Security Observability** (`src/security.ts`): protocol-boundary signals for the agentic-web threat model: annotation hints (`mcp.tool.*`), payload sizes, output char budgets, a pluggable `securityClassifier` (`mcp.security.injection.*` + events), `spotlight()` and `validateToolBudget()` helpers. **This package observes and signals; it does NOT enforce.** Deterministic kill-switches live in `autotel-genai/guard`; identity/scope/policy in `autotel-genai/agent`. Do not duplicate those here.

## Entry Points

- `autotel-mcp-instrumentation` - Everything (server + client + context utilities)
- `autotel-mcp-instrumentation/server` - Server instrumentation only (~5KB)
- `autotel-mcp-instrumentation/client` - Client instrumentation only (~4KB)
- `autotel-mcp-instrumentation/context` - Context utilities only (~2KB)

## Commands

```bash
# In packages/autotel-mcp-instrumentation directory
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
- `src/security.ts` - Security observability (annotations, payload sizing, char budgets, injection classifier, spotlighting)
- `src/semantic-conventions.ts` - Attribute/method/metric names + mirrored `_meta` key literals

## Code Patterns

### Proxy-Based Instrumentation

Uses Proxy pattern to wrap MCP SDK methods:

```typescript
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { instrumentMcpServer } from 'autotel-mcp-instrumentation/server';

// 2026-07-28 builds a server per request, so instrument inside the factory.
// (On the v1 SDK you hold one Server and instrument it once — same call.)
function createServer() {
  const server = new McpServer(
    { name: 'my-server', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  // Now all registerTool(), registerResource(), registerPrompt() calls are traced
  return instrumentMcpServer(server, { networkTransport: 'tcp' });
}

export default createMcpHandler(createServer);
```

### Context Propagation

W3C Trace Context via `_meta` field (not headers):

```typescript
// Client injects context into _meta
import { injectOtelContextToMeta } from 'autotel-mcp-instrumentation/context';

await client.callTool({
  name: 'my-tool',
  arguments: {},
  _meta: injectOtelContextToMeta(), // Adds traceparent, tracestate, baggage
});

// Server extracts context from the context argument, not the arguments.
// v2: ctx.mcpReq._meta   v1: extra._meta
import { extractOtelContextFromMeta } from 'autotel-mcp-instrumentation/context';

const handler = async (args, ctx) => {
  const parentContext = extractOtelContextFromMeta(ctx.mcpReq._meta);
  // Use parentContext to create child spans
};
```

## Boundaries

- ✅ **Always do**: Use Proxy pattern, maintain transport-agnostic design, support both runtimes
- ⚠️ **Ask first**: Modifying MCP SDK usage, changing context propagation format
- 🚫 **Never do**: Modify MCP SDK, import it at runtime, break transport-agnostic design, use headers for context, drop either protocol era

## Testing

- Unit tests: mock server/client objects (the wrappers are duck-typed, so no SDK needed). Era-specific behaviour is tested by handing the wrapped handler a v2 `ServerContext` shape or a v1 `RequestHandlerExtra` shape.
- Integration tests: real SDKs
- Test context propagation across client-server boundaries
- Test all transports (stdio, Streamable HTTP)

## Why Better than Manual Instrumentation

- No need to manually wrap each tool handler
- Automatic parent-child span relationships across client-server boundaries
- Transport-agnostic (works with any MCP transport, not just HTTP)
- Consistent span naming and attributes
