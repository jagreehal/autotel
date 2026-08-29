---
name: autotel-webmcp
description: >
  Use this skill when adding OpenTelemetry tracing to WebMCP tools in the browser — tools a page registers through `document.modelContext` for a browser agent to call. Covers registration and execution spans, opt-in payload capture, canonical `gen_ai.*` attributes, and the three things Chrome changes about a tool result before the agent sees it.
---

# autotel-webmcp

OpenTelemetry instrumentation for [WebMCP](https://github.com/webmachinelearning/webmcp). A page registers tools through `document.modelContext`, a browser agent calls them, and this package makes each registration and each call a span.

The browser sits between your handler and the agent. It serialises the return value, replaces an empty one with a canned message, and drops annotations it does not recognise. Spans record what the agent received, so telemetry matches the agent's view rather than your intent. Behaviour is measured against Chrome 151, which disagrees with the draft in several places.

**This is the browser package.** For MCP servers and clients on the server side, use `autotel-mcp-instrumentation`.

## Setup

```bash
npm install autotel-web autotel-webmcp
```

```typescript
import { initFull } from 'autotel-web/full';
import { instrumentWebMCP } from 'autotel-webmcp';

initFull({ service: 'shop-web', endpoint: 'http://localhost:4318' });

instrumentWebMCP();
```

`autotel-web` is a peer dependency, and the import is static so `span()` stays synchronous. A dynamic import would turn every tool execution into a promise.

## Two entry points

`autotel-webmcp` fills in autotel-web's `span()` and reaches the OpenTelemetry browser SDK through it, so it needs a bundler like any app dependency.

`autotel-webmcp/core` is the same instrumentation with no telemetry dependency. You pass `span` yourself, it imports nothing beyond itself, and it loads straight into a browser with no build step. Use it when spans already have somewhere to go, or to keep the browser SDK out of a bundle.

```javascript
import { instrumentWebMCP } from 'autotel-webmcp/core';

instrumentWebMCP({ span: mySpanFactory });
```

## Core Patterns

### Call it before registering tools

```typescript
instrumentWebMCP();

await document.modelContext.registerTool({
  name: 'search',
  description: 'Search the product catalogue',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  execute: ({ query }) => JSON.stringify(search(query)),
});
```

The package patches `registerTool` on the native ModelContext, so retained references and Chrome's `navigator.modelContext` alias are covered and the platform's `[SameObject]` identity holds. A tool registered before the call keeps its original handler and produces no spans.

### It is safe to call unconditionally

With no `document.modelContext` the call returns a no-op handle. Server rendering and browsers without WebMCP need no guard of your own.

### Turn payload capture on for a session, not forever

```typescript
instrumentWebMCP({
  capturePayloads: true,
  maxPayloadLength: 4096,
});
```

Off by default. A browser agent calls tools without a server seeing the arguments, and those arguments carry addresses, order contents and whatever the user typed. With capture off you still get result type, byte size, envelope shape and substitution, which answers most questions about a misbehaving tool.

### Record failures a tool library normalised

Libraries often catch a handler failure and hand the agent readable prose, which is right for the agent and invisible to telemetry.

```typescript
instrumentWebMCP({
  isErrorResult: (value) =>
    typeof value === 'string' && value.startsWith('Error: '),
});
```

The span gets `error.type` and `webmcp.result.error`, and the agent still receives what the library decided to send. A classifier that throws is recorded and ignored rather than allowed to break the call.

### Inject a span factory to test without a pipeline

```typescript
const spans = [];
instrumentWebMCP({
  span: (name, fn) => {
    const entry = { name, attributes: {} };
    spans.push(entry);
    return fn({
      setAttribute: (k, v) => (entry.attributes[k] = v),
      end: () => {},
    });
  },
});
```

Useful in tests, and in a demo page that renders spans to the DOM.

### Uninstall what you installed

```typescript
const handle = instrumentWebMCP();
handle.uninstall();
```

Repeated calls share one installation and are reference-counted. Each caller uninstalls its own handle, and the patch comes off after the last one.

## Attributes

Shared concepts use canonical names so WebMCP calls land on the dashboards already built for server-side MCP. WebMCP-specific facts sit under `webmcp.*`.

| Attribute                               | Notes                                             |
| --------------------------------------- | ------------------------------------------------- |
| `gen_ai.tool.name` / `webmcp.tool.name` | Tool name                                         |
| `webmcp.installation.id`                | The `instrumentWebMCP()` call the span belongs to |
| `gen_ai.operation.name`                 | `execute_tool`                                    |
| `mcp.tool.arguments.size`               | Argument bytes, recorded with capture off         |
| `mcp.tool.result.size`                  | Result bytes the agent pays for                   |
| `gen_ai.tool.call.arguments`            | Arguments, only with capture on                   |
| `gen_ai.tool.call.result`               | The exact string the agent received, capture on   |
| `webmcp.result.type`                    | The handler's return type before serialisation    |
| `webmcp.result.envelope`                | The value is an MCP `{ content: [...] }` wrapper  |
| `webmcp.result.substituted`             | The browser replaced an empty result              |
| `webmcp.annotations.sent`               | Annotation keys you passed                        |
| `webmcp.annotations.dropped`            | Annotation keys the browser discarded             |
| `error.type` / `webmcp.result.error`    | Set when `isErrorResult` recognises a failure     |

Spans are named `webmcp.install`, `webmcp.tool.register`, `webmcp.tool.execute` and `webmcp.tool.withdraw`.

`webmcp.install` is emitted before the patch goes live, so it exists even when nothing registers afterwards. `webmcp.tool.withdraw` is emitted when the `AbortSignal` passed to `registerTool(tool, { signal })` aborts, which is how the platform takes a tool back. Registrations alone only ever grow: without withdrawals, a tool set gated by page state reads as still offered.

Every span carries `webmcp.installation.id`. A reload tears the page down without aborting any signal, so load 1's tools are registered and never withdrawn; the id is what separates the two loads. Scope "currently offered" to the newest id.

## What to look for in the spans

**`webmcp.annotations.dropped` is not empty.** Chrome keeps `readOnlyHint` and `untrustedContentHint` and normalises both to booleans. `destructiveHint`, `idempotentHint` and the rest of the server-side MCP vocabulary disappear with no error. A tool you believed was marked destructive is one that never was.

**`webmcp.result.substituted` is true.** The handler returned an empty string and the agent read _Operation succeeded_, a success message nobody wrote.

**An installation with no `webmcp.tool.register` spans.** `instrumentWebMCP()` ran after the tools were registered, so the patch never saw them. Indistinguishable from having no tools at all without the `webmcp.install` span.

**`webmcp.result.envelope` is true.** The handler returned an MCP `{ content: [...] }` wrapper. Chrome does not unwrap it, so the agent got the JSON rather than the text inside. This also catches a library that serialised the envelope to a string first.

## Review Checklist

- `instrumentWebMCP()` runs before any `registerTool()` call
- `capturePayloads` left off in production, turned on deliberately for a diagnostic session
- `isErrorResult` supplied when a tool library returns failures instead of throwing
- Tools registered through `document.modelContext`, not declarative forms, which do not pass through `registerTool()`
- Every handle from a repeated `instrumentWebMCP()` call gets uninstalled by its owner

## Scope

Covers imperative tools registered through the shared ModelContext. Declarative form tools do not pass through `registerTool()`, and neither does a tool registered before instrumentation installs, so both stay untraced.

## Example

`apps/example-webmcp` in the autotel repo registers four tools built around the failure modes above, calls them through `modelContext.executeTool()` the way an agent would, and renders each span on the page with no collector involved.
