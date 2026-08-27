# autotel-webmcp example

A page that registers four WebMCP tools, calls them the way an agent would, and
shows the span each call produces.

The demo tools are built around the four things that go wrong quietly when you
ship WebMCP tools:

| Tool             | What it shows                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `search`         | Chrome keeps two annotations and discards the rest. `webmcp.annotations.dropped` names them.  |
| `clear_cart`     | An empty return becomes _Operation succeeded_, so the agent reads a message you never wrote.  |
| `describe_order` | Chrome does not unwrap an MCP `{ content: [...] }` envelope. The agent gets the wrapper.      |
| `checkout`       | A failure normalised into prose still records `error.type`, because `isErrorResult` spots it. |

## Run it

```bash
pnpm --filter autotel-webmcp build
pnpm --filter @jagreehal/example-webmcp start
```

Open <http://localhost:8010/apps/example-webmcp/>. The page imports
`autotel-webmcp/core` from `packages/autotel-webmcp/dist`, which pulls in nothing
else, so there is no bundler and no build step of its own.

## Requirements

WebMCP ships in Chrome 151 behind
`chrome://flags/#web-machine-learning-model-context`. Without it the page still
loads: `instrumentWebMCP()` returns a no-op handle instead of throwing, which is
what it also does during server rendering, and the banner says so.

## Where the spans go

`instrumentWebMCP()` takes a span factory, so this demo passes one that renders
to the page and needs no collector:

```javascript
instrumentWebMCP({
  span: renderingSpan,
  capturePayloads: false,
  isErrorResult: (value) =>
    typeof value === 'string' && value.startsWith('Error: '),
});
```

Import the default entry instead and autotel-web's `span()` is filled in, sending
to devtools or any OTLP backend. That entry reaches the OpenTelemetry browser
SDK, so it needs a bundler:

```javascript
import { initFull } from 'autotel-web/full';
import { instrumentWebMCP } from 'autotel-webmcp';

initFull({ service: 'shop-web', endpoint: 'http://localhost:4318' });
instrumentWebMCP();
```

## Payload capture

The checkbox turns on `capturePayloads`. Leave it off and you still get result
type, byte size, envelope and substitution; turn it on and the `checkout` tool's
postal address lands on the span. That is the reason it defaults to off.

Toggling re-registers the tools, because capture is decided when a tool's
`execute` is wrapped. The demo unregisters the old ones through the
`AbortSignal` that `registerTool()` accepts.
