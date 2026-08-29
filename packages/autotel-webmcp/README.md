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
| `webmcp.tool.title`                     | Display label, when one was sent                      |
| `webmcp.tool.label_mismatch`            | Title is present and does not equal the name          |
| `webmcp.tool.descriptor`                | Fingerprint of the descriptor that was sent           |
| `webmcp.tool.redefined`                 | Same name, different descriptor, in this install      |
| `webmcp.annotations.sent`               | What you passed                                       |
| `webmcp.annotations.dropped`            | **What the browser threw away**                       |

`label_mismatch` and `redefined` are facts about what was registered, not a
judgement about whether that was allowed. `autotel-devtools` folds them into
the WebMCP tab.

`annotations.dropped` is the one you cannot get any other way. Chrome keeps
only `readOnlyHint` and `untrustedContentHint`; pass `destructiveHint` — as
anyone arriving from server-side MCP will — and it disappears with no error,
no warning, and no trace in `getTools()`. This attribute is the trace.

### `execute_tool {tool}`

Named for the GenAI convention, so a trace list reads as the tools that ran —
`execute_tool checkout` — rather than one repeated string. Filter on
`gen_ai.tool.name` or `webmcp.tool.name`, which carry the name as an attribute.


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
| `webmcp.execute.seq`                          | Order of this call in the installation (1, 2, 3…)                        |
| `webmcp.execute.depth`                        | How many executions were already in flight when this one began           |
| `webmcp.execute.parent`                       | The innermost of them, when there was one                                |
| `webmcp.tool.descriptor`                      | Fingerprint from the last register of this name                          |
| `webmcp.result.refused` / `webmcp.result.refusal` | Known library refusal (`confirm` or `unavailable`), not a handler error |
| `error.type`                                  | The handler threw or rejected: the error's name                          |
| `webmcp.error.message`                        | **Why it failed**, when payload capture is enabled                        |

The last two are the counterpart of `annotations.dropped`. Chrome replaces a
thrown error with a generic `UnknownError` before the agent sees it, so the
message the handler threw exists nowhere else — not in the agent's transcript,
not in the tool result. The span is the only copy. The rejection itself is
passed through untouched.

Nothing here changes what the agent receives. A handler's string is handed back
as it was returned, empty string included: Chrome substitutes `"Operation
succeeded"` for an empty result, and it stays the only thing that does. The
span records that substitution in `webmcp.result.substituted` rather than
performing it.

`execute.depth` is what a chained call looks like from here. A handler that
calls another tool spends one consent on two calls, and the second begins while
the first is still running. Two calls an agent fired in parallel overlap the
same way, so this records the fact — what else was running — and leaves the
reading of it to whatever consumes the spans.

### `webmcp.consent`

Emitted when the host calls `recordConsent()`. WebMCP runs on the session the
user is already logged into, so the moment a human approves an action is the
only checkpoint there is — and this package cannot see it: it patches
`registerTool`, and the dialogue is your UI.

| Attribute                               | Meaning                                                    |
| --------------------------------------- | ---------------------------------------------------------- |
| `webmcp.consent.shown`                  | The label the human read                                    |
| `webmcp.consent.resolved`               | The tool that will actually run                             |
| `webmcp.consent.mismatch`               | Those two are not the same string                           |
| `webmcp.consent.granted`                | Whether the human said yes                                  |
| `webmcp.tool.descriptor`                | Fingerprint registered for the resolved tool at that moment |
| `webmcp.consent.arguments`              | The arguments approved, when payload capture is enabled     |

```ts
const webmcp = instrumentWebMCP({ span });

// from your consent dialogue, before the call runs
webmcp.recordConsent({
  shown: 'add 2 coffees to the cart',
  resolved: 'update_shipping_address',
  arguments: { address: '…' },
  granted: true,
});
```

Section 6.3.2 of the WebMCP draft says it plainly: nothing guarantees that a
tool's declared intent matches its behaviour. Binding your dialogue to the call
that runs is your job. Recording that the two disagreed, that the descriptor
moved between the yes and the call, or that an execution had no consent span
before it at all, is this package's.

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
  // A refusal is a tool declining to act, which is not a failure. The default
  // recognises two common phrasings; supply your own when your tools refuse in
  // their own words, or when that wording changes. This package depends on no
  // tool library.
  isRefusal: (value) =>
    typeof value === 'string' && value.startsWith('Declined:')
      ? 'policy'
      : undefined,
  // Fold the handler's source into webmcp.tool.descriptor. Off by default: a
  // handler a bundler rewrites produces a new fingerprint on every load, which
  // is noise. On, it catches the swap a descriptor cannot see — same name,
  // same description, different function.
  fingerprintHandler: true,
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

`instrumentWebMCP()` returns `{ recordConsent(), uninstall() }`, and does
nothing when WebMCP is unavailable (including during SSR), so it is safe to
call unconditionally.

Repeated calls share one installation and are reference-counted: each returned
handle should be uninstalled by its owner. Instrumentation covers imperative
tools registered through the shared ModelContext, including retained references
and Chrome's `navigator.modelContext` alias. Declarative form tools do not pass
through `registerTool()` and are outside this package's current scope, as are
tools already registered before `instrumentWebMCP()` runs — call it before your
tool registration.

## Notes

Verified against Chrome 152, which is also where `navigator.modelContext` and
`navigator.modelContextTesting` were withdrawn — the surface is
`document.modelContext`. Behaviour is recorded from measurement rather than
read from the specification: the draft and the implementation disagree in
several places, and `apps/example-webmcp` carries a conformance lane that
drives a real Chrome so the measurements can be re-taken rather than trusted.

Records facts, not judgements: no rules, no thresholds, no opinions about your
tools. Analysis belongs in whatever consumes the spans.
