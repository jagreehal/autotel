---
name: autotel-mcp
description: >
  MCP server AI agents connect to for investigating OpenTelemetry telemetry. Use when an agent needs to query traces, metrics, or logs from Jaeger, Tempo, Prometheus, Loki, or a built-in OTLP collector — including LLM-specific analytics (USD cost, token usage, per-model stats).
type: integration
library: autotel-mcp
library_version: '0.1.1'
sources:
  - jagreehal/autotel:packages/autotel-mcp/CLAUDE.md
  - jagreehal/autotel:packages/autotel-mcp/README.md
---

# autotel-mcp

MCP server AI agents connect to for querying OpenTelemetry telemetry. Ships with multiple backends, capability-aware tool registration, and first-class LLM analytics (USD cost attribution, token stats, expensive/slow trace ranking).

## Quick Start — pick a backend

Add to your MCP client config (e.g. `.mcp.json` for Claude Code):

### Built-in collector (default, zero-infra)

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

Receives OTLP on `:4318`, stores in-memory (or libsql with `--persist ./autotel.db`).

### Jaeger

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

### Grafana stack (Tempo + Prometheus + Loki)

```json
{
  "env": {
    "AUTOTEL_BACKEND": "stack",
    "TEMPO_BASE_URL": "http://localhost:3200",
    "PROMETHEUS_BASE_URL": "http://localhost:9090",
    "LOKI_BASE_URL": "http://localhost:3100"
  }
}
```

Each signal is wired only if its URL is set. Missing signals are cleanly reported as unsupported.

### Auto-detect

```json
{ "env": { "AUTOTEL_BACKEND": "auto" } }
```

Probes well-known endpoints and picks what responds. Falls back to fixture data if nothing is reachable.

## Tool Catalog

Tools are registered per backend capability — agents only see tools the backend can actually serve.

| Group                     | Tools                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trace investigation       | `search_traces`, `search_spans`, `get_trace`, `summarize_trace`                                                                                                                       |
| Topology / discovery      | `list_services`, `list_operations`, `service_map`, `discover_services`, `discover_trace_fields`, `discover_log_fields`                                                                |
| Diagnosis                 | `find_errors`, `find_anomalies`, `find_root_cause`, `check_slos`, `explain_slowdown`                                                                                                  |
| Cross-signal              | `correlate` (trace + metrics + logs for a traceId)                                                                                                                                    |
| LLM analytics             | `get_llm_usage` (with USD cost), `get_llm_expensive_traces` (ranked by USD), `get_llm_slow_traces`, `get_llm_model_stats`, `list_llm_models`, `list_llm_tools`                        |
| Metrics / logs            | `list_metrics`, `search_logs`                                                                                                                                                         |
| OTel semantic conventions | `semconv_list_namespaces`, `semconv_get_namespace`, `semconv_refresh_cache`                                                                                                           |
| Collector schema          | `collector_list_components`, `collector_component_schema`, `collector_component_readme`, `collector_validate_component_config`, `collector_get_versions`, `collector_refresh_catalog` |
| Health                    | `backend_health`, `backend_capabilities`, `list_capabilities`                                                                                                                         |

## Resources

| URI                                                         | Content                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| `otel://capabilities`                                       | Server manifest                                            |
| `otel://tool-catalog`                                       | All tools with workflow hints                              |
| `otel://backend/capabilities`                               | Backend declared + runtime-probed signal availability      |
| `otel://dashboards`                                         | Index of prebuilt dashboards                               |
| `otel://dashboards/grafana-llm`                             | Grafana dashboard JSON for LLM workloads (import directly) |
| `otel://semconv/namespaces`                                 | OTel semantic-convention namespaces                        |
| `otel://collector/versions` / `otel://collector/components` | OTel collector schema catalog                              |

## Environment Variables

| Variable                        | Default                  | Purpose                                                                                 |
| ------------------------------- | ------------------------ | --------------------------------------------------------------------------------------- |
| `AUTOTEL_BACKEND`               | `collector`              | `collector` / `jaeger` / `tempo` / `prometheus` / `loki` / `stack` / `auto` / `fixture` |
| `AUTOTEL_TRANSPORT`             | `stdio`                  | `stdio` / `http` / `sse`                                                                |
| `AUTOTEL_PORT` / `AUTOTEL_HOST` | `3000` / `127.0.0.1`     | HTTP/SSE bind                                                                           |
| `AUTOTEL_COLLECTOR_PORT`        | `4318`                   | OTLP receiver port (collector backend)                                                  |
| `AUTOTEL_PERSIST`               | —                        | libsql file path (persistent collector storage)                                         |
| `AUTOTEL_RETENTION_MS`          | `3600000` / `86400000`   | Data retention (in-memory / persistent)                                                 |
| `JAEGER_BASE_URL`               | `http://localhost:16686` | Jaeger backend                                                                          |
| `TEMPO_BASE_URL`                | `http://localhost:3200`  | Tempo backend                                                                           |
| `PROMETHEUS_BASE_URL`           | `http://localhost:9090`  | Prometheus backend                                                                      |
| `LOKI_BASE_URL`                 | `http://localhost:3100`  | Loki backend                                                                            |
| `AUTOTEL_LLM_PRICES_JSON`       | —                        | Path to custom model pricing JSON                                                       |

## LLM Cost Attribution

`get_llm_usage` returns `totalCostUsd` and per-model / per-service USD breakdowns. Pricing catalog covers current Claude (3/4/4.5/4.6/4.7), GPT-4/4.1/4o, o1/o3, Gemini 1.5/2.0/2.5, Mistral, and Llama families. Unknown models contribute to `unpricedRequests` (coverage gap, never silent `$0`).

Override with:

```bash
AUTOTEL_LLM_PRICES_JSON=/path/to/prices.json
```

Where `prices.json` is `{ "model-name": { "inputPerMtok": N, "outputPerMtok": N } }`. Longest-prefix matching handles dated variants (`gpt-4o-2024-11-20` → `gpt-4o`).

`get_llm_expensive_traces` now sorts by USD spend, not token count.

## Transports

| Transport | Endpoint                                 | Use                                              |
| --------- | ---------------------------------------- | ------------------------------------------------ |
| `stdio`   | —                                        | Default. Claude Code, Cursor, Codex, Copilot CLI |
| `http`    | `POST /mcp`                              | Streamable HTTP MCP clients                      |
| `sse`     | `GET /sse`, `POST /messages?sessionId=…` | Legacy SSE MCP clients                           |

`GET /health` is always exposed when HTTP/SSE is active — returns `{ status, backend, transport, signals, detail, version }` for k8s readiness probes.

## Common Mistakes

- Do NOT expect trace tools to register against a Prometheus-only backend — capability-aware registration hides them, and runtime probing hides tools whose backends are configured-but-unreachable. Check `otel://backend/capabilities` for the live view.
- Do NOT confuse `autotel-mcp` (the query server) with `autotel-mcp-instrumentation` (the OTel plugin for instrumenting MCP servers themselves) — they're separate packages.
- Do NOT guess at backend endpoints — `AUTOTEL_BACKEND=auto` probes them for you and composes a `CompositeBackend` automatically.
- Use `get_llm_expensive_traces` over `get_llm_slow_traces` when answering cost questions — slow traces are ranked by latency, expensive traces by USD spend.
