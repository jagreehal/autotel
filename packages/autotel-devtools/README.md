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
│  OTLP/gRPC receiver (port 4317)             │
└─────────────────────────────────────────────┘
```

## Quick Start

### Installing with pnpm

This package pulls in `esbuild` and `protobufjs`, both of which run install
scripts. pnpm 10+ blocks those by default and then refuses to run anything else
until you decide about them, so `pnpm install && pnpm start` fails on a fresh
clone with a deps-status error rather than an obvious one. Approve them once in
`pnpm-workspace.yaml`:

```yaml
allowBuilds:
  esbuild: true
  protobufjs: true
```

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
chosen from the request `Content-Type`. SDKs that default to protobuf over OTLP
HTTP, including the Python, Java, and Go OpenTelemetry SDKs, work with no extra
configuration:

```bash
# Python / Java / Go SDKs default to http/protobuf; point them at the receiver
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 python app.py
```

Open http://localhost:4318 to see traces, logs, and metrics.

SDKs configured for OTLP/gRPC can use the standard endpoint directly:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 python app.py
```

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
import { init, withTracing } from 'autotel';
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
const myFunction = withTracing({ name: 'example.run' })((ctx) => async () => {
  // ... this span appears in devtools
});
```

## Architecture

### Server (Node.js)

- **DevtoolsServer** - WebSocket server + in-memory data store
- **HTTP Routes** - OTLP receivers for traces/logs/metrics (JSON + protobuf)
- **gRPC Receiver** - canonical OTLP trace, log, and metric services on port 4317

#### Detecting the receiver

Every response carries an `x-autotel-devtools: <version>` header, and `GET /healthz`
returns `{ ok, service: "autotel-devtools", version, clients }`. Use either to confirm
you are talking to autotel-devtools rather than another OTLP collector that happens to
share the port. For example before pointing an exporter at `:4318`:

```ts
import { probePortHolder } from 'autotel-devtools/server';

// 'autotel-devtools' | 'foreign' | 'none'
const holder = await probePortHolder('127.0.0.1', 4318);
```

If you start the receiver and the requested port is held by a _foreign_ process (some
IDEs run their own OTLP collector on `:4318`), the CLI falls forward to the next free
port and warns that exporters still aimed at the busy port are reaching that other
process. Point them at the bound port, or free the original.

- **Exporters** - OpenTelemetry span/log exporters

### Widget (Svelte 5)

- **Shadow DOM** - Isolated styles, no conflicts with app CSS
- **Svelte 5 runes** - Reactive state via a signal shim that preserves a `.value` API
- **Views** - Traces, Logs, Metrics, Errors, Resources, Service Map

## Features

### Implemented

- ✅ Real-time OTLP ingestion (traces, logs, metrics)
- ✅ WebSocket streaming with history replay
- ✅ **Query language** over traces and logs, run as SQL against a sqlite store (see below)
- ✅ **Persistence**: `--db` keeps telemetry across restarts; retention applies count and byte caps
- ✅ Traces view with waterfall (tree connectors, event markers, critical path) + flame graph
- ✅ Logs view with a query bar and severity filtering
- ✅ **Metrics view**: server-reduced time series, merged histogram distributions, interpolated quantiles, sparklines, and capped exemplars that open the trace behind a spike
- ✅ Error aggregation and grouping
- ✅ Service map visualization
- ✅ Resources view (derived from telemetry)
- ✅ GenAI run summaries + narrated walkthrough
- ✅ **Agents view**: observe coding agents (Claude Code, opencode), with cost split by model, effort, skill, sub-agent and prompt
- ✅ Global time window shared by every tab
- ✅ Live tail that freezes while you read, with a "N new" pill to catch up
- ✅ Configurable telemetry limits (env vars)
- ✅ Widget position persistence (localStorage)
- ✅ Export traces as JSON
- ✅ Custom element support (`<autotel-devtools>`)

### GenAI: read an agent run at a glance

When your app emits OpenTelemetry GenAI spans (Vercel AI SDK, Pydantic AI, OpenAI
Agents, Anthropic, Google GenAI, LangChain, …), the **GenAI** tab gives two extras
on top of the per-span detail:

- A **run summary strip** sits above the detail for any multi-span run: total
  cost (table-priced; a trailing `+` marks a lower bound when some calls are
  unpriced), input→output tokens, reasoning tokens, model calls, tool
  executions, sub-agents, duration and errors.
- An **Explain run** button steps through the run in chronological order with
  plain-language narration of each step. Auto-play or step manually with the
  arrow keys / Space (Esc exits); clicking a span jumps the tour to that step.
  Use it to show a teammate or a client what the agent did, which tools it
  called, and where the cost went.

### Agents: observe Claude Code (and other coding agents)

Coding agents like **Claude Code** emit OpenTelemetry **metrics and log events**.
The **Agents** tab reconstructs them into a session-centric view, and splits the
spend by model, effort, skill, sub-agent and prompt. Powered by the
[`autotel-agents`](../autotel-agents) package, which also handles opencode and is
one adapter away from Codex.

One command starts the receiver _and_ launches Claude Code wired to it:

```bash
npx autotel-devtools claude
```

This sets the telemetry env for a live local view: OTLP **`http/protobuf`**, 1s
export intervals, and `session.id` kept on metrics. It also turns on Claude
Code's span hierarchy — `claude_code.interaction` → `llm_request` / `tool`, with
the sub-agent tree on `parent_agent_id` — which lands in the **Traces** tab. The
receiver also accepts standard OTLP/gRPC on `:4317`. Then open the UI and switch
to **Agents**.

- `--print-env`: print the env block instead of launching (for managed-settings
  / MDM / VS Code), e.g. `npx autotel-devtools claude --print-env`.
- `--log-prompts`: capture prompt _text_ (default is private: length only).

What you get per session: a **timeline** (prompts → tool calls → API requests →
decisions), a **rollup** (cost, tokens, requests, lines changed), and breakdowns
by **tool category**, **MCP server** (`mcp__server__tool`), **sub-agent** (`Task`)
and **skill** (`Skill`). Plus an aggregate strip across all sessions. Cost uses
the agent's reported `cost_usd`, falling back to a token estimate (badged). MCP
protocol internals live in `autotel-mcp-instrumentation`.

## Querying

The Traces and Logs tabs take a query, which the server compiles to SQL and runs
against everything it has kept, rather than only what is on screen.

```
service = api AND duration > 100
name CONTAINS checkout
http.response.status_code = 500
service IN [api, web, worker]
name REGEXP "^GET /users/[0-9]+$"
severity_number >= 17          # logs: error and above
parent_span_id = NULL          # root spans only
"user id" = "u-42"             # quote a key a bare word can't spell
checkout                       # bare words are free text
```

**Fields.** Traces: `service`, `name`, `kind`, `duration`, `status`, `trace_id`,
`span_id`, `parent_span_id`. Logs: `service`, `severity`, `severity_number`,
`trace_id`, `span_id`, `body`. **Anything else is looked up as an attribute**, so
every attribute your services emit is queryable without being declared.

`severity` and `severity_number` both exist on purpose: the text is what you
read, but "error and above" is a numeric comparison and string ordering cannot
express it.

**Operators.** `=` `!=` `>` `<` `>=` `<=` for comparison; `CONTAINS`,
`NOT CONTAINS`, `^` (starts with), `$` (ends with), `REGEXP` / `=~`,
`NOT REGEXP` / `!~` for text; `IN` / `NOT IN` with `[…]`; `= NULL` and
`!= NULL` for presence. Combine with `AND`, `OR` and parentheses. Two
conditions side by side mean `AND`.

Values are always sent as bound parameters and field names always come from a
schema, so nothing you type reaches the SQL string.

### The HTTP API

The same query the UI runs is available over HTTP, so a test can assert on what
a run actually emitted instead of on a log line. Requests to the `/api/*`
endpoints must come from loopback, or the server answers `403 Forbidden`.

| Endpoint                       | Body / result                                                    |
| ------------------------------ | ---------------------------------------------------------------- |
| `POST /api/query/traces`       | `{ query, window?, limit?, cursor? }` → `{ traces, nextCursor }` |
| `POST /api/query/logs`         | same shape, over logs                                            |
| `POST /api/query/errors`       | same shape, error spans only                                     |
| `POST /api/query/metrics`      | same shape, over metric series                                   |
| `GET /api/query/traces/fields` | `{ fields }` - the bare field names a query can use              |
| `GET /api/stats`               | `{ traceCount, spanCount, logCount, bytesUsed, maxBytes, … }`    |
| `GET /v1/traces`               | every trace held, no query                                       |
| `DELETE /v1/traces`            | `{ cleared: true }` - empty the store between tests              |
| `GET /healthz`                 | `{ ok, service, version, clients }`                              |

`query` takes the language above, so anything the Traces tab can filter on, a
script can too. Each returned trace carries `traceId`, `service`, `rootSpan`,
`spans`, `duration` and `status`.

### Asserting on traces in CI

Clear the store, run the thing, then ask what it emitted. A query count is a far
steadier assertion than a duration:

```bash
curl -sX DELETE http://127.0.0.1:4318/v1/traces
node app.js

curl -s -X POST http://127.0.0.1:4318/api/query/traces \
  -H 'content-type: application/json' \
  -d '{"query":"name = \"GET /feed\"","limit":1}' \
  | jq -e '.traces[0].spans | length == 2'
```

That fails the moment someone reintroduces an N+1 on `/feed`, and it does not
care how fast the machine running CI happens to be.

### Live tail and the time window

The list follows new data by default. It **freezes** the moment you type a
query, scroll back, select a row, or bound the time window, and a "N new" pill
counts the matches instead of reordering rows under you. Click the pill to catch
up. There is no mode to manage: freezing follows from what you did.

The time window is one control shared by every tab. Presets track _now_ rather
than freezing when clicked, and **"All time" means "I haven't said"**: a view
may fit itself to its own data then, but a window you choose is never widened or
cropped, because an empty 15-minute window is the answer.

### Reading it from a CLI or an agent

The same store backs `autotel-mcp`'s `devtools` backend, so `autotel diagnose`,
`autotel query` and the MCP tools read what the viewer shows:

```bash
autotel diagnose errors --backend devtools --devtools-base-url http://localhost:4318
```

## Configuration

### Environment Variables

```bash
AUTOTEL_MAX_TRACE_COUNT=10000    # Live-tail buffer size (default: 100)
AUTOTEL_MAX_LOG_COUNT=10000      # Live-tail buffer size (default: 100)
AUTOTEL_DEVTOOLS_DB=./tel.db     # sqlite file for the store (default: in-memory)
AUTOTEL_DEVTOOLS_MAX_TRACES=100000  # Traces retained in the store before pruning
AUTOTEL_DEVTOOLS_PORT=4318       # Server port (default: 4318)
AUTOTEL_DEVTOOLS_GRPC_PORT=4317  # OTLP/gRPC port (default: 4317)
AUTOTEL_DEVTOOLS_DB_MAX_SIZE=2gb # Logical sqlite retention cap
AUTOTEL_DEVTOOLS_HOST=127.0.0.1  # Bind host (default: 127.0.0.1)
AUTOTEL_DEVTOOLS_TITLE="My App"  # Dashboard title (optional)
AUTOTEL_DEVTOOLS_SOURCE_ROOT=.   # Root GET /source may read (default: cwd on a loopback bind, else off; `false` disables)
```

### CLI Options

```bash
npx autotel-devtools 4319                      # port as a bare positional
npx autotel-devtools --port 4319 --host 0.0.0.0
npx autotel-devtools --db ./telemetry.db        # keep telemetry across restarts
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
- `--title, -t` - Dashboard title, used for the startup banner and the browser tab (default: `autotel-devtools`). Useful when several dashboards are open at once.
- `--db, -d` - sqlite file backing the store, so telemetry survives a restart (default: in-memory, which keeps everything until the process exits)
- `--max-traces` - Traces retained in the store before the oldest are pruned (default: 100000). Pruning runs every 30s.
- `--grpc-port` - OTLP/gRPC port (default: 4317). If busy, the receiver reports the fallback port.
- `--db-max-size` - Logical sqlite retention cap (`512mb`, `2gb`, etc.). Defaults to 512 MiB in memory and 2 GiB on disk.

When bound to a loopback host, the receiver listens on **both** `127.0.0.1`
and `::1`, so a client connecting via `localhost` reaches it regardless of how
the OS resolves `localhost` (macOS prefers IPv6 `::1`). The startup banner
prints every address it bound, and warns when it cannot bind a family rather
than failing silently. Both listeners serve the HTTP routes _and_ the `/ws`
live tail, so the widget streams whichever form of `localhost` it resolved.

## Behind a dev-server proxy

If your app's dev server proxies `/v1/traces` to the receiver, two bugs make
spans vanish with **no error**:

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
> but the receiver stays empty. Always verify on the **receiver** side (below).
> The browser trying to send proves nothing.

## Verifying ingestion in tests

The receiver exposes an HTTP read-back so a test can assert the collector
**received** spans, rather than that the client tried to send them. A
browser-level route intercept can fake the second one by fulfilling the request
before it reaches any server:

```bash
GET    /v1/traces   # → { traces: [...], count: N }  what the receiver has
DELETE /v1/traces   # clear captured telemetry (reset between tests)
```

```ts
// Playwright / integration test: bypass any page.route() intercept and ask
// the collector directly.
await fetch(`${RECEIVER}/v1/traces`, { method: 'DELETE' }); // reset
await runTheUserFlow(); // app emits spans
await expect
  .poll(async () => (await (await fetch(`${RECEIVER}/v1/traces`)).json()).count)
  .toBeGreaterThan(0);
```

These read-back calls run from Node with no `Origin` header, so the origin guard
below leaves them alone.

## Trace payload shape

The server **answers in full and streams compact**. Every HTTP response carries
a complete trace, so `GET /v1/traces`, `POST /api/query/traces` and anything
else you can `curl` need no decoding.

The `/ws` stream is the one exception. It leaves off any span `endTime` that
`startTime + duration` already reproduces, which is 32% of the compressed
payload on a large trace. Writing your own WebSocket client? Rehydrate in one
call:

```ts
import { decodeTraces } from 'autotel-devtools/wire';

ws.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  const traces = decodeTraces(data.traces ?? []);
});
```

Responses over 1 KiB are gzipped when the client accepts it, and the WebSocket
negotiates `permessage-deflate`. Browser `fetch`, browser `WebSocket` and
undici all handle that transparently, so this is normally invisible.

## Read-surface origin guard

OTLP **ingestion** (`POST /v1/{traces,logs,metrics}`), `GET /widget.js` and
`GET /healthz` are open to any origin. Browser apps on arbitrary dev origins
must be able to send telemetry and load the embeddable widget. The **read**
surface is not: `GET /v1/traces`, `DELETE /v1/traces` and the `/ws` WebSocket are
origin-checked so a web page you happen to be visiting can't `fetch()` or stream
your locally captured prompts, responses and tokens.

- A non-loopback `Origin` (a cross-origin browser read) is rejected with `403`.
- When bound to a loopback host (the default), a non-loopback `Host` (DNS
  rebinding) is also rejected. `--host 0.0.0.0` opts into network exposure and
  applies only the `Origin` check.

The embedded widget keeps working. It connects from a loopback origin
(`http://localhost:<your-app-port>`). Server-side reads with no `Origin` pass.

## License

Apache-2.0
