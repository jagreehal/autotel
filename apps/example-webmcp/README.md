# autotel-webmcp example

A page that registers four WebMCP tools, calls them the way an agent would, and
shows the span each call produces.

The demo tools are built around the four things that go wrong quietly when you
ship WebMCP tools:

| Tool             | What it shows                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `search`         | Chrome keeps two annotations and discards the rest. `webmcp.annotations.dropped` names them.                   |
| `clear_cart`     | An empty return becomes _Operation succeeded_, so the agent reads a message you never wrote.                   |
| `describe_order` | Chrome does not unwrap an MCP `{ content: [...] }` envelope. The agent gets the wrapper.                       |
| `checkout`       | A failure normalised into prose still records `error.type`, because `isErrorResult` spots it.                  |
| `restock`        | Calls `search` from inside its handler: one consent, two executions, and `webmcp.execute.depth` on the second. |

## The consent moment

WebMCP runs on the session the user is already logged into, so the half-second
where a human says yes is the whole interface — and the dialogue showing them
that moment is page code like any other. Three buttons in section 3:

- **approve checkout, run checkout** — the honest case. `webmcp.consent.mismatch`
  is false, and the consent span shares an installation id and a descriptor
  with the execution that followed.
- **approve add_to_cart, run checkout** — the label and the call disagree. The
  call still runs: a span is a record, not a gate.
- **swap the search handler** — re-registers `search` with the same name,
  description and schema, and a different function. Nothing flags it until you
  tick the fingerprint box, because a descriptor cannot see a handler.

## Conformance lane

```bash
pnpm --filter @jagreehal/example-webmcp test:conformance
```

Drives this page in a real Chrome 152+ with the WebMCP flags on and asserts on
the spans it renders. The package's vitest suite runs against a hand-written
stand-in for `document.modelContext`; this lane is what keeps that stand-in
honest. Point `CHROME_BIN` at your Chrome if the search misses it.

## Run it

```bash
pnpm --filter autotel-webmcp build
pnpm --filter @jagreehal/example-webmcp start
```

Open <http://localhost:8010/apps/example-webmcp/>. The page imports
`autotel-webmcp/core` from `packages/autotel-webmcp/dist`, which pulls in nothing
else, so there is no bundler and no build step of its own.

## Requirements

WebMCP ships behind `chrome://flags/#web-machine-learning-model-context`, or
the `--enable-experimental-web-platform-features
--enable-features=WebMCPTesting` flags the conformance lane uses. Chrome 152
withdrew `navigator.modelContext`; the surface is `document.modelContext`. Without it the page still
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
