# autotel-mcp

An MCP server that gives AI agents the ability to investigate OpenTelemetry traces, metrics, and logs. Ships with a built-in OTLP collector so any instrumented app can send data directly — no Jaeger, Grafana, or vendor setup required.

### Key Features

- **Backend-agnostic.** Built-in OTLP collector on port 4318 accepts data from any OTel-instrumented app.
- **All three signals.** Traces, metrics, and logs — with cross-signal correlation.
- **Agent-optimized.** 33 tools designed for progressive investigation: discover → diagnose → correlate → root cause.
- **Zero infrastructure.** In-memory by default, persistent with `--persist`.

### Requirements

- Node.js 20 or newer
- An MCP client: Claude Code, Claude Desktop, VS Code, Cursor, Windsurf, Goose, or any other MCP client

## Getting started

Install the autotel-mcp server with your client.

**Standard config** works in most tools:

```json
{
  "mcpServers": {
    "autotel": {
      "command": "npx",
      "args": ["autotel-mcp"]
    }
  }
}
```

<details>
<summary>Claude Code</summary>

Use the Claude Code CLI to add the server:

```bash
claude mcp add autotel npx autotel-mcp
```

</details>

<details>
<summary>Claude Desktop</summary>

Follow the MCP install [guide](https://modelcontextprotocol.io/quickstart/user). Add to your config:

```json
{
  "mcpServers": {
    "autotel": {
      "command": "npx",
      "args": ["autotel-mcp"]
    }
  }
}
```

</details>

<details>
<summary>VS Code</summary>

Follow the MCP install [guide](https://code.visualstudio.com/docs/copilot/chat/mcp-servers#_add-an-mcp-server), use the standard config above. Or use the CLI:

```bash
code --add-mcp '{"name":"autotel","command":"npx","args":["autotel-mcp"]}'
```

</details>

<details>
<summary>Cursor</summary>

Go to `Cursor Settings` -> `MCP` -> `Add new MCP Server`. Use `command` type with the command `npx autotel-mcp`.

</details>

<details>
<summary>Windsurf</summary>

Follow Windsurf MCP [documentation](https://docs.windsurf.com/windsurf/cascade/mcp). Use the standard config above.

</details>

<details>
<summary>Cline</summary>

Add to your `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "autotel": {
      "type": "stdio",
      "command": "npx",
      "args": ["autotel-mcp"],
      "disabled": false
    }
  }
}
```

</details>

<details>
<summary>Codex</summary>

```bash
codex mcp add autotel npx "autotel-mcp"
```

Or add to `~/.codex/config.toml`:

```toml
[mcp_servers.autotel]
command = "npx"
args = ["autotel-mcp"]
```

</details>

<details>
<summary>Copilot CLI</summary>

```bash
/mcp add
```

Or add to `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "autotel": {
      "type": "local",
      "command": "npx",
      "tools": ["*"],
      "args": ["autotel-mcp"]
    }
  }
}
```

</details>

<details>
<summary>Gemini CLI</summary>

Follow the MCP install [guide](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md#configure-the-mcp-server-in-settingsjson), use the standard config above.

</details>

<details>
<summary>Goose</summary>

Go to `Advanced settings` -> `Extensions` -> `Add custom extension`. Use type `STDIO`, set command to `npx autotel-mcp`.

</details>

<details>
<summary>Amp</summary>

```bash
amp mcp add autotel -- npx autotel-mcp
```

Or add to VS Code settings:

```json
"amp.mcpServers": {
  "autotel": {
    "command": "npx",
    "args": ["autotel-mcp"]
  }
}
```

</details>

<details>
<summary>Warp</summary>

Go to `Settings` -> `AI` -> `Manage MCP Servers` -> `+ Add`. Use the standard config above.

</details>

### With Jaeger backend

To query an existing Jaeger instance instead of the built-in collector:

```json
{
  "mcpServers": {
    "autotel": {
      "command": "npx",
      "args": ["autotel-mcp"],
      "env": {
        "AUTOTEL_BACKEND": "jaeger",
        "JAEGER_BASE_URL": "http://localhost:16686"
      }
    }
  }
}
```

### With persistent storage

```json
{
  "mcpServers": {
    "autotel": {
      "command": "npx",
      "args": ["autotel-mcp", "--persist", "./autotel.db"]
    }
  }
}
```

## How it works

```
Your App ──OTLP──> autotel-mcp (port 4318) ──libsql──> in-memory store
                        │
AI Agent ──MCP──────────┘
                   (stdio or HTTP)
```

1. Your instrumented app sends traces/metrics/logs via OTLP to `http://localhost:4318`
2. autotel-mcp stores the data in libsql (in-memory by default)
3. Your AI agent connects via MCP and investigates using 33 tools

## Backends

### Collector (default)

Built-in OTLP collector with libsql storage. Accepts all three signals on port 4318. No external dependencies.

```bash
# In-memory (default) — data lost on restart
npx autotel-mcp

# Persistent storage — survives restarts
npx autotel-mcp --persist ./autotel.db
```

Point your app's OTLP exporter at the collector:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 node your-app.js
```

### Jaeger

Query an existing Jaeger instance. Traces only (metrics and logs unsupported by Jaeger API).

```bash
AUTOTEL_BACKEND=jaeger JAEGER_BASE_URL=http://localhost:16686 npx autotel-mcp
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AUTOTEL_BACKEND` | `collector` | Backend: `collector`, `jaeger` |
| `AUTOTEL_TRANSPORT` | `stdio` | MCP transport: `stdio`, `http` |
| `AUTOTEL_PORT` | `3000` | MCP HTTP port |
| `AUTOTEL_HOST` | `127.0.0.1` | MCP HTTP bind address |
| `AUTOTEL_COLLECTOR_PORT` | `4318` | OTLP receiver port |
| `AUTOTEL_PERSIST` | — | libsql file path (omit for in-memory) |
| `AUTOTEL_RETENTION_MS` | `3600000` (1h mem) / `86400000` (24h persist) | Data retention |
| `AUTOTEL_MAX_TRACES` | `10000` | Max traces before eviction |
| `JAEGER_BASE_URL` | `http://localhost:16686` | Jaeger API URL |

### HTTP mode

Run as a standalone HTTP server (for remote clients or environments without stdio):

```bash
npx autotel-mcp --transport http --port 3000
```

Then configure your MCP client with:

```json
{
  "mcpServers": {
    "autotel": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## Tools

33 tools organized by investigation workflow.

<details>
<summary><b>Discovery (5)</b></summary>

- **list_services** — Services with span counts and error rates
- **list_operations** — Operations for a service, ranked by traffic
- **backend_health** — Backend reachability and ingestion status
- **backend_capabilities** — Signal support and query features
- **list_capabilities** — Full server manifest

</details>

<details>
<summary><b>Trace Investigation (4)</b></summary>

- **search_traces** — Find traces by service, operation, status, duration, tags, time window
- **search_spans** — Span-level search across traces
- **get_trace** — Full trace detail by ID
- **summarize_trace** — Compact summary: span tree, errors, critical path, duration breakdown

</details>

<details>
<summary><b>Diagnosis (4)</b></summary>

- **find_anomalies** — Scan for statistical outliers: latency spikes, error rate jumps
- **find_root_cause** — Walk a trace span tree to identify the bottleneck span
- **find_errors** — Aggregate error spans grouped by service and operation
- **check_slos** — Report SLO violations given p99 latency and error rate targets

</details>

<details>
<summary><b>Topology (2)</b></summary>

- **service_map** — Dependency graph with call counts, error rates, latency percentiles
- **list_services** / **list_operations** — Service and operation discovery

</details>

<details>
<summary><b>LLM Analytics (6)</b></summary>

- **get_llm_usage** — Token usage by model and service
- **list_llm_models** — Models in use with request counts
- **get_llm_model_stats** — Latency/token/error percentiles per model
- **get_llm_expensive_traces** — Top traces by token count
- **get_llm_slow_traces** — Slowest LLM traces
- **list_llm_tools** — Tool/function call usage by name

</details>

<details>
<summary><b>Signals (3)</b></summary>

- **list_metrics** — Available metric series
- **get_metric_series** — Time-series data for a metric
- **search_logs** — Log search by severity, service, trace ID, text

</details>

<details>
<summary><b>Cross-Signal Correlation (2)</b></summary>

- **correlate** — Given a trace ID: return trace + metrics from involved services + correlated logs
- **explain_slowdown** — Combines anomaly detection with cross-signal correlation

</details>

<details>
<summary><b>Collector Config (3)</b></summary>

- **validate_collector_config** — Validate OTLP receiver config fragment
- **explain_collector_config** — Explain config shape and defaults
- **suggest_collector_config** — Generate minimal config

</details>

<details>
<summary><b>Instrumentation Quality (2)</b></summary>

- **score_span_instrumentation** — Quality score 0-100 with A-F grade
- **explain_instrumentation_score** — Scoring rubric details

</details>

## Resources

MCP resources give agents context without burning tool calls:

| URI | Content |
|---|---|
| `otel://capabilities` | Server manifest: transports, tool groups, signals |
| `otel://tool-catalog` | All tools with descriptions and workflow hints |
| `otel://backend/capabilities` | Active backend's signal support |
| `otel://collector/config` | OTLP receiver config guidance |
| `otel://instrumentation/scoring` | Scoring rubric explanation |

## License

MIT
