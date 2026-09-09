---
name: autotel-devtools
description: >
  Standalone OTLP receiver with a Svelte web UI for local-dev observability. Use when a developer wants to see OpenTelemetry traces, logs, metrics, and service maps streaming from a running app without setting up Jaeger/Tempo/Prometheus — either as a CLI dashboard or an embedded `<autotel-devtools>` widget.
---

# autotel-devtools

Local-dev OTLP receiver with a browser UI. Think TanStack Devtools for OpenTelemetry. Runs as CLI or embeds as a Shadow-DOM-isolated widget in any web app.

## Quick Start: pick an approach

### Standalone dashboard

```bash
npx autotel-devtools
# → OTLP receiver on :4318, UI at http://localhost:4318
```

Point any OTel-instrumented app at it. The endpoints accept **both OTLP/JSON and
OTLP/protobuf**, chosen from the request `Content-Type`, so protobuf-default SDKs
(Python/Java/Go) work with no extra config:

```bash
# JS (defaults to JSON, or set http/protobuf — both work)
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 node app.js

# Python/Java/Go (default to http/protobuf)
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 python app.py
```

### Embedded widget

```html
<script src="http://localhost:4318/widget.js"></script>
<autotel-devtools></autotel-devtools>
```

Shadow-DOM-isolated. Never leaks styles into the host page.

### Programmatic (Node + autotel)

```typescript
import { init, withTracing } from 'autotel';
import { createDevtools } from 'autotel-devtools';

const { exporter, close } = createDevtools({ port: 4318, verbose: true });

init({
  service: 'my-app',
  endpoint: 'http://localhost:4318',
  spanProcessors: [exporter], // stream spans to the devtools UI
});

export const loadUser = withTracing({ name: 'user.load' })(
  (ctx) => async (id: string) => {
    // ... span shows up live in devtools
  },
);
```

## Package Entry Points

| Import                      | What                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `autotel-devtools`          | `createDevtools()`, `DevtoolsServer`, exporters, types                                                                                                         |
| `autotel-devtools/server`   | `DevtoolsServer`, OTLP parsing (`parseOtlpTraces`, `parseOtlpLogs`), HTTP routes (`attachDevtoolsRoutes`, `createDevtoolsHttpServer`), telemetry-limit helpers |
| `autotel-devtools/exporter` | `DevtoolsSpanExporter` (standalone)                                                                                                                            |

## Server Endpoints

| Route                                          | What                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `POST /v1/traces` · `/v1/logs` · `/v1/metrics` | OTLP receivers: JSON or protobuf (`application/x-protobuf`)        |
| `GET /`                                        | Dashboard UI (see Views below)                                     |
| `POST /api/query/{traces,logs,errors,metrics}` | Server-side query over the durable store                           |
| `POST /api/query/webmcp`                       | WebMCP tool surface, folded server-side over every page of results |
| `GET /widget.js`                               | Embeddable widget bundle (IIFE)                                    |
| `GET /healthz`                                 | Health check                                                       |
| `WS /ws`                                       | WebSocket stream (history replay on connect)                       |

## Views in the UI

- **Traces**: waterfall + flame graph, search with 300 ms debounce
- **Agents**: coding-agent sessions (Claude Code, opencode, Codex) folded by `autotel-agents`, with cost split by model, effort, skill, sub-agent and prompt. `npx autotel-devtools claude` starts the receiver and launches Claude Code wired to it, spans included — its `claude_code.interaction` → `llm_request` / `tool` hierarchy lands in **Traces**
- **GenAI**: LLM calls with tokens, cost and streaming timing
- **Flow**: request flow across services
- **Resources**: derived from ingested telemetry
- **Service map**: visualises call graph
- **Metrics**: per-metric time series
- **Logs**: severity/resource filtering
- **Errors**: aggregated and grouped by fingerprint
- **Security**: security events and detected signal chains
- **Compare**: cohort comparison between two selections, including an experiment's arms
- **Coverage**: entry points that have emitted nothing
- **WebMCP**: browser tool surface from `autotel-webmcp` spans, which tools the agent can currently see, what the browser dropped, what results cost in bytes. Full-page viewer only, it does not fit the embedded widget's gzip budget

## WebMCP tools (the viewer as an agent-callable API)

The full-page viewer registers its own read-only WebMCP tools, so an agent driving the browser reads the same telemetry the panel shows — no CLI, no API key, no screenshots.

| Tool                       | Input                | Answers                                                           |
| -------------------------- | -------------------- | ----------------------------------------------------------------- |
| `autotel_query_traces`     | `query`, `limit`     | Search traces — one row each: name, service, status, duration     |
| `autotel_get_trace`        | `traceId` (required) | Every span of one trace                                           |
| `autotel_list_errors`      | `query`              | What is failing, grouped by fingerprint                           |
| `autotel_query_logs`       | `query`, `limit`     | Search log records, with the trace id when there is one           |
| `autotel_webmcp_inventory` | —                    | The page's own WebMCP tool surface, including dropped annotations |

`query` is the same query language as the UI's query bar. Results are projected to the columns the list views show and capped per call; `autotel_get_trace` is how an agent asks for spans.

## The query language

```text
service = api duration > 100    # conditions side by side mean AND
status = ERROR OR duration > 1s
name contains checkout
user.id = "u-42"                # anything not a first-class field is an attribute
severity_number >= 17           # logs: error and above
SAVE20                          # a bare word is free text
```

**Fields.** Traces: `service`, `name`, `kind`, `duration`, `status`, `trace_id`,
`span_id`, `parent_span_id`. Logs: `service`, `severity`, `severity_number`,
`trace_id`, `span_id`, `body`. Anything else is looked up as an attribute, so
every attribute a service emits is queryable without being declared.

**Free text** matches those fields and every attribute value — so an order id
or coupon code set with `ctx.setAttribute` finds its span when typed on its
own, as the viewer displays it, array elements included. Attribute **keys** are
not matched: every span carries resource keys like `host.name` and
`process.command`, so matching keys would make ordinary words match everything.
Search by key with `key = value`.

Registered against `document.modelContext` directly — no library, no runtime dependency. Registration is a no-op in a browser without WebMCP, so no feature detection is needed.

**Full-page only, both at runtime and in the bundle.** The embedded widget is a guest in someone else's page, where `document.modelContext` belongs to that page — devtools tools there would change what its agent sees and land in its own WebMCP tab. `vite.widget.config.ts` also swaps `src/widget/webmcp.ts` for `webmcp.lean.ts` in the embedded build, so its bundle carries none of the tool definitions.

## Environment Variables

| Variable                   | Default     | Purpose                       |
| -------------------------- | ----------- | ----------------------------- |
| `AUTOTEL_DEVTOOLS_PORT`    | `4318`      | Server port                   |
| `AUTOTEL_DEVTOOLS_HOST`    | `127.0.0.1` | Bind host                     |
| `AUTOTEL_DEVTOOLS_TITLE`   | —           | Dashboard title               |
| `AUTOTEL_MAX_TRACE_COUNT`  | `100`       | Max traces retained in memory |
| `AUTOTEL_MAX_LOG_COUNT`    | `100`       | Max logs retained             |
| `AUTOTEL_MAX_METRIC_COUNT` | `100`       | Max metric points retained    |

## CLI

```bash
npx autotel-devtools 4319                                       # port as bare positional
npx autotel-devtools --port 4319 --host 0.0.0.0 --title "My App"
```

| Arg / Flag | Short | Purpose                                                      |
| ---------- | ----- | ------------------------------------------------------------ |
| `[port]`   | —     | Listen port shorthand for `--port` (explicit `--port` wins)  |
| `--port`   | `-p`  | Listen port (default 4318); walks to next free port if taken |
| `--host`   | `-H`  | Bind host (default 127.0.0.1)                                |
| `--title`  | `-t`  | Dashboard title                                              |

## Works With

- **autotel**: pass `exporter` into `spanProcessors` for live streaming
- **Standard OpenTelemetry SDK**: any OTLP exporter targeting `http://localhost:4318` works; autotel is not required
- **Browser apps**: the widget is a custom element with Shadow DOM, so drop it in without CSS conflicts

## Common Mistakes

- Do NOT use the widget in Node: it's a browser-only IIFE bundle. Use `createDevtools()` server-side instead.
- Do NOT set a production OTLP endpoint at `localhost:4318`: devtools is in-memory only (no persistence, caps at 100 items per signal by default). Bump `AUTOTEL_MAX_*_COUNT` for longer local sessions.
- Do NOT embed the widget into pages served via strict CSP without allowing `http://localhost:4318`: the WebSocket connection and script load both need the devtools origin allowed.
- Do NOT expect the WebMCP tools in the embedded widget: they are full-page only, by design and by build. Open the viewer at `http://localhost:4318`.
- Do NOT confuse the two builds: the **server** uses tsup (Node ESM + CJS), the **widget** uses Vite's IIFE build. Don't import `autotel-devtools/server` into widget code; it pulls in Node APIs.
