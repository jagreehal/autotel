# autotel-devtools

Standalone OTLP receiver with web UI for local development. Think TanStack Devtools for OpenTelemetry.

## Overview

`autotel-devtools` provides two modes:

1. **Standalone OTLP Receiver** - Run as CLI to receive OpenTelemetry data
2. **Embeddable Widget** - Add a devtools panel to your web app

```
┌─────────────────────────────────────────────┐
│  Standalone Mode                            │
│                                             │
│  npx autotel-devtools                       │
│  ┌───────────────────────────────────────┐ │
│  │  HTTP Server (port 4318)               │ │
│  │  ├── POST /v1/traces  ← OTLP JSON/PB │ │
│  │  ├── POST /v1/logs     ← OTLP JSON/PB │ │
│  │  ├── POST /v1/metrics  ← OTLP JSON/PB │ │
│  │  ├── GET  /            → Full page UI  │ │
│  │  ├── GET  /widget.js   → Widget bundle │ │
│  │  ├── GET  /healthz     → Health check  │ │
│  │  └── WS   /ws          ←→ WebSocket    │ │
│  └───────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

## Quick Start

### Standalone Mode

```bash
# Run the OTLP receiver
npx autotel-devtools

# Configure your app to send to it
OTEL_EXPORTER_OTLP_PROTOCOL=http/json \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
node app.js
```

The endpoints accept **both OTLP/JSON and OTLP/protobuf** (`application/x-protobuf`),
selected automatically from the request `Content-Type`. That means SDKs that default
to protobuf over OTLP HTTP — including the Python, Java, and Go OpenTelemetry SDKs —
work without any extra configuration:

```bash
# Python / Java / Go SDKs default to http/protobuf — just point them at the receiver
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 python app.py
```

Open http://localhost:4318 to see traces, logs, and metrics.

### Embedded Widget

Add the widget to your web app:

```html
<script src="http://localhost:4318/widget.js"></script>
<autotel-devtools></autotel-devtools>
```

Or programmatically:

```html
<script>
  // Mount the widget manually
  const container = document.createElement('div');
  document.body.appendChild(container);

  // Auto-detect WebSocket URL
  const script = document.currentScript;
  const widgetUrl = new URL(script.src);
  const wsUrl = `ws://${widgetUrl.host}/ws`;

  // Widget opens as a floating panel
</script>
```

### Programmatic API

Use in Node.js with autotel:

```typescript
import { init, trace } from 'autotel';
import { createDevtools } from 'autotel-devtools';

const { server, httpServer, exporter, port, close } = createDevtools({
  port: 4318,
  verbose: true,
});

// Wire up to autotel
init({
  service: 'my-app',
  endpoint: 'http://localhost:4318',
  spanProcessors: [exporter], // Stream to devtools
});

// Your traced code
const myFunction = trace((ctx) => async () => {
  // ... this span appears in devtools
});
```

## Architecture

### Server (Node.js)

- **DevtoolsServer** - WebSocket server + in-memory data store
- **HTTP Routes** - OTLP receivers for traces/logs/metrics (JSON + protobuf)

#### Detecting the receiver

Every response carries an `x-autotel-devtools: <version>` header, and `GET /healthz`
returns `{ ok, service: "autotel-devtools", version, clients }`. Use either to confirm
you are talking to autotel-devtools rather than another OTLP collector that happens to
share the port — for example before pointing an exporter at `:4318`:

```ts
import { probePortHolder } from 'autotel-devtools/server'

// 'autotel-devtools' | 'foreign' | 'none'
const holder = await probePortHolder('127.0.0.1', 4318)
```

If you start the receiver and the requested port is held by a *foreign* process (some
IDEs run their own OTLP collector on `:4318`), the CLI falls forward to the next free
port and warns that exporters still aimed at the busy port are reaching that other
process — point them at the bound port, or free the original.
- **Exporters** - OpenTelemetry span/log exporters

### Widget (Svelte 5)

- **Shadow DOM** - Isolated styles, no conflicts with app CSS
- **Svelte 5 runes** - Reactive state via a signal shim that preserves a `.value` API
- **Views** - Traces, Logs, Metrics, Errors, Resources, Service Map

## Features

### Implemented

- ✅ Real-time OTLP ingestion (traces, logs, metrics)
- ✅ WebSocket streaming with history replay
- ✅ Traces view with waterfall + flame graph
- ✅ Logs view with severity/resource filtering
- ✅ Error aggregation and grouping
- ✅ Service map visualization
- ✅ Resources view (derived from telemetry)
- ✅ GenAI run summaries + narrated walkthrough
- ✅ **Agents view** — observe coding agents (Claude Code, opencode) from their OTel metrics + log events
- ✅ Search with debounce (300ms)
- ✅ Configurable telemetry limits (env vars)
- ✅ Widget position persistence (localStorage)
- ✅ Export traces as JSON
- ✅ Custom element support (`<autotel-devtools>`)

### GenAI: read an agent run at a glance

When your app emits OpenTelemetry GenAI spans (Vercel AI SDK, Pydantic AI, OpenAI
Agents, Anthropic, Google GenAI, LangChain, …), the **GenAI** tab gives two extras
on top of the per-span detail:

- A **run summary strip** sits above the detail for any multi-span run — total
  cost (table-priced; a trailing `+` marks a lower bound when some calls are
  unpriced), input→output tokens, reasoning tokens, model calls, tool
  executions, sub-agents, duration and errors.
- An **Explain run** button steps through the run in chronological order with
  plain-language narration of each step. Auto-play or step manually with the
  arrow keys / Space (Esc exits); clicking a span jumps the tour to that step.
  Useful for showing a teammate or a client exactly what the agent did, which
  tools it called, and where the cost went.

### Agents: observe Claude Code (and other coding agents)

Coding agents like **Claude Code** emit OpenTelemetry **metrics and log events**
(no traces). The **Agents** tab reconstructs them into a session-centric view —
powered by the [`autotel-agents`](../autotel-agents) package, which also handles
opencode and is one adapter away from Codex.

One command starts the receiver _and_ launches Claude Code wired to it:

```bash
npx autotel-devtools claude
```

This sets the telemetry env for a live local view — OTLP **`http/protobuf`** to
this receiver (not the gRPC setup in most guides, which this receiver doesn't
speak), 1s export intervals, and `session.id` kept on metrics. Then open the UI
and switch to **Agents**.

- `--print-env` — print the env block instead of launching (for managed-settings
  / MDM / VS Code), e.g. `npx autotel-devtools claude --print-env`.
- `--log-prompts` — capture prompt _text_ (default is private: length only).

What you get per session: a **timeline** (prompts → tool calls → API requests →
decisions), a **rollup** (cost, tokens, requests, lines changed), and breakdowns
by **tool category**, **MCP server** (`mcp__server__tool`), **sub-agent** (`Task`)
and **skill** (`Skill`) — plus an aggregate strip across all sessions. Cost uses
the agent's reported `cost_usd`, falling back to a token estimate (badged). MCP
protocol internals are out of scope here — that's `autotel-mcp-instrumentation`.

## Configuration

### Environment Variables

```bash
AUTOTEL_MAX_TRACE_COUNT=10000    # Max traces to keep (default: 100)
AUTOTEL_MAX_LOG_COUNT=10000      # Max logs to keep (default: 100)
AUTOTEL_MAX_METRIC_COUNT=50000   # Max metrics to keep (default: 100)
AUTOTEL_DEVTOOLS_PORT=4318       # Server port (default: 4318)
AUTOTEL_DEVTOOLS_HOST=127.0.0.1  # Bind host (default: 127.0.0.1)
AUTOTEL_DEVTOOLS_TITLE="My App"  # Dashboard title (optional)
```

### CLI Options

```bash
npx autotel-devtools 4319                      # port as a bare positional
npx autotel-devtools --port 4319 --host 0.0.0.0
npx autotel-devtools claude                     # receiver + launch Claude Code wired to it
npx autotel-devtools claude --print-env         # print the telemetry env, don't launch
```

Arguments:

- `[port]` - Port to listen on, shorthand for `--port` (an explicit `--port` always wins)

Subcommands:

- `claude [claude args]` - Start the receiver and launch Claude Code wired to it (open the **Agents** tab). `--print-env` prints the env block instead; `--log-prompts` opts into prompt-text capture (default: private). `--port`/`--host` apply to the receiver; anything else is passed through to `claude`.

Options:

- `--port, -p` - Port to listen on (default: 4318). If the port is taken, the receiver walks forward to the next free port and prints a warning.
- `--host, -H` - Host to bind to (default: 127.0.0.1)
- `--title, -t` - Dashboard title

When bound to a loopback host, the receiver listens on **both** `127.0.0.1`
and `::1`, so a client connecting via `localhost` reaches it regardless of how
the OS resolves `localhost` (macOS prefers IPv6 `::1`). The startup banner
prints every address it bound; if a family can't be bound you get a warning,
not a silent black hole.

## Behind a dev-server proxy

If your app's dev server proxies `/v1/traces` to the receiver, two classic
bugs make spans vanish with **no error** — both worth knowing:

```ts
// Express / http-proxy-middleware
import { createProxyMiddleware } from 'http-proxy-middleware';

app.use(
  '/v1/traces',
  createProxyMiddleware({
    // (a) Express strips the mount prefix before calling middleware, so the
    //     proxy would otherwise forward "/" instead of "/v1/traces".
    pathRewrite: () => '/v1/traces',
    // (b) Use 127.0.0.1, NOT localhost. On macOS `localhost` resolves to ::1;
    //     pin the family so you reach the receiver deterministically.
    target: 'http://127.0.0.1:4318',
    changeOrigin: true,
  }),
);
```

> Symptom of either bug: the browser shows the request leaving (200/no error),
> but the receiver stays empty. Always verify on the **receiver** side (below),
> not just that the browser tried to send.

## Verifying ingestion in tests

The receiver exposes an HTTP read-back so a test can assert the collector
**actually received** spans — instead of asserting "the client tried to send",
which a browser-level route intercept can fake (it fulfils the request before
it reaches any server):

```bash
GET    /v1/traces   # → { traces: [...], count: N }  what the receiver has
DELETE /v1/traces   # clear captured telemetry (reset between tests)
```

```ts
// Playwright / integration test — bypass any page.route() intercept and ask
// the collector directly.
await fetch(`${RECEIVER}/v1/traces`, { method: 'DELETE' }); // reset
await runTheUserFlow();                                      // app emits spans
await expect
  .poll(async () => (await (await fetch(`${RECEIVER}/v1/traces`)).json()).count)
  .toBeGreaterThan(0);
```

These read-back calls run from Node (no `Origin` header), so they are unaffected
by the origin guard below.

## Read-surface origin guard

OTLP **ingestion** (`POST /v1/{traces,logs,metrics}`), `GET /widget.js` and
`GET /healthz` are open to any origin — browser apps on arbitrary dev origins
must be able to send telemetry and load the embeddable widget. The **read**
surface is not: `GET /v1/traces`, `DELETE /v1/traces` and the `/ws` WebSocket are
origin-checked so a web page you happen to be visiting can't `fetch()` or stream
your locally captured prompts, responses and tokens.

- A non-loopback `Origin` (a cross-origin browser read) is rejected with `403`.
- When bound to a loopback host (the default), a non-loopback `Host` (DNS
  rebinding) is also rejected. `--host 0.0.0.0` opts into network exposure and
  applies only the `Origin` check.

The embedded widget keeps working — it connects from a loopback origin
(`http://localhost:<your-app-port>`). Server-side reads with no `Origin` pass.

## License

Apache-2.0
