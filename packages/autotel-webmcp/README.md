# autotel-webmcp

OpenTelemetry instrumentation for [WebMCP](https://github.com/webmachinelearning/webmcp) — traces the tools your web page exposes to AI agents.

The browser-side counterpart to [`autotel-mcp-instrumentation`](../autotel-mcp-instrumentation). It instruments the browser's shared `ModelContext`, with no changes required in individual tools.

```bash
npm install autotel-webmcp autotel-web
```

```ts
import { initFull } from 'autotel-web/full';
import { instrumentWebMCP } from 'autotel-webmcp';

initFull({ service: 'shop', endpoint: 'https://collector.example.com' });
instrumentWebMCP();
```

That's it. Every tool registration and every agent invocation becomes a span.

## Why this exists

WebMCP lets a page expose tools that an AI agent can call. The browser does
things to those calls that your code cannot see:

- It **serialises** whatever your handler returns and hands the agent a string.
- It **substitutes** `"Operation succeeded"` for an empty result.
- It **silently discards** annotations it does not recognise.

So the tool you wrote and the tool the agent experiences are not the same
thing. These spans record the second one.

## Spans

### `webmcp.tool.register`

| Attribute                               | Meaning                                               |
| --------------------------------------- | ----------------------------------------------------- |
| `gen_ai.tool.name` / `webmcp.tool.name` | Tool name (canonical and WebMCP-specific aliases)     |
| `webmcp.tool.description.length`        | Short descriptions are why agents pick the wrong tool |
| `webmcp.tool.has_input_schema`          | Whether the agent was told what arguments to send     |
| `webmcp.annotations.sent`               | What you passed                                       |
| `webmcp.annotations.dropped`            | **What the browser threw away**                       |

`annotations.dropped` is the one you cannot get any other way. Chrome keeps
only `readOnlyHint` and `untrustedContentHint`; pass `destructiveHint` — as
anyone arriving from server-side MCP will — and it disappears with no error,
no warning, and no trace in `getTools()`. This attribute is the trace.

### `webmcp.tool.execute`

| Attribute                                     | Meaning                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `gen_ai.tool.name` / `webmcp.tool.name`       | Tool name                                                                |
| `gen_ai.operation.name`                       | `execute_tool`                                                           |
| `mcp.tool.arguments.size`                     | UTF-8 input size, recorded without capturing content                     |
| `mcp.tool.result.size`                        | UTF-8 result size, recorded without capturing content                    |
| `gen_ai.tool.call.arguments` / `webmcp.input` | Arguments the agent sent, when payload capture is enabled                |
| `gen_ai.tool.call.result` / `webmcp.result`   | **The exact string the agent received**, when payload capture is enabled |
| `webmcp.result.type`                          | The handler's return type before serialisation                           |
| `webmcp.result.bytes`                         | What the result costs in the agent's context                             |
| `webmcp.result.envelope`                      | The result is an MCP `{ content: [...] }` wrapper                        |
| `webmcp.result.substituted`                   | The browser replaced an empty result                                     |

### `webmcp.tool.withdraw`

| Attribute                               | Meaning                              |
| --------------------------------------- | ------------------------------------ |
| `gen_ai.tool.name` / `webmcp.tool.name` | The tool the agent can no longer see |

Withdrawal is an abort: `registerTool(tool, { signal })` is how the platform
hands a tool back, and a library holds one controller per tool. Under `when:`
gating that happens continuously rather than at teardown, so an inventory built
from registrations alone only grows, and lists tools that are gone.

### `webmcp.install`

Emitted by `instrumentWebMCP()` before the patch goes live, carrying
`webmcp.installation.id` — which is stamped on every register, execute and
withdraw span from that installation. A reload tears the page down without
aborting any signal, so without it two page loads are indistinguishable and a
tool removed in the second still reads as offered.

An install span with no registrations after it is the signature of calling
`instrumentWebMCP()` _after_ registering your tools.

`result.envelope` catches a common and expensive mistake. Chrome does **not**
unwrap MCP's `{ content: [{ type: 'text', text }] }` envelope, so the agent
receives the wrapper as JSON and has to parse it to reach your text. Measured
on a real tool: 45 bytes wrapped versus 13 plain, for identical information,
on every call.

## Options

```ts
instrumentWebMCP({
  capturePayloads: true, // opt in only when your data policy allows it
  maxPayloadLength: 512, // truncate captured payloads (default 2048)
  // Useful for libraries that return readable error text because Chrome drops
  // thrown messages. The response is unchanged; the span gets error.type.
  isErrorResult: (value) =>
    typeof value === 'string' && value.startsWith('Error: '),
});
```

## Two entry points

`autotel-webmcp` wires autotel-web's `span()` in for you, and reaches the
OpenTelemetry browser SDK through it. That needs a bundler, like any app
dependency.

`autotel-webmcp/core` is the same instrumentation with no telemetry dependency
at all. You pass `span` yourself. It imports nothing beyond itself, so it loads
straight into a browser with no build step, and it keeps the browser SDK out of
your bundle when your spans already have somewhere to go.

```javascript
import { instrumentWebMCP } from 'autotel-webmcp/core';

instrumentWebMCP({ span: mySpanFactory });
```

Payload capture is off by default because tool arguments and results commonly
contain personal or confidential data. Size, type, envelope, and substitution
signals remain available without payload content.

`instrumentWebMCP()` returns `{ uninstall() }`, and does nothing when WebMCP is
unavailable (including during SSR), so it is safe to call unconditionally.

Repeated calls share one installation and are reference-counted: each returned
handle should be uninstalled by its owner. Instrumentation covers imperative
tools registered through the shared ModelContext, including retained references
and Chrome's `navigator.modelContext` alias. Declarative form tools do not pass
through `registerTool()` and are outside this package's current scope, as are
tools already registered before `instrumentWebMCP()` runs — call it before your
tool registration.

## Notes

Verified against Chrome 151. Behaviour is recorded from measurement rather than
read from the specification — the draft and the implementation disagree in
several places.

Records facts, not judgements: no rules, no thresholds, no opinions about your
tools. Analysis belongs in whatever consumes the spans.
