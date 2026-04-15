# autotel-mcp

MCP server for AI agents to investigate OpenTelemetry traces, metrics, and logs.

## Quick Start

```bash
npx autotel-mcp
```

This starts the MCP server with a built-in OTLP collector. Point your instrumented apps at `http://localhost:4318` and start investigating.

### MCP Client Config

Claude Desktop / Claude Code:

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

## Backends

### Collector (default)

Built-in OTLP collector with libsql storage. Accepts traces, metrics, and logs on port 4318.

```bash
# In-memory (default)
npx autotel-mcp

# Persistent storage
npx autotel-mcp --persist ./autotel.db
```

### Jaeger

Query an existing Jaeger instance:

```bash
AUTOTEL_BACKEND=jaeger JAEGER_BASE_URL=http://localhost:16686 npx autotel-mcp
```

## Environment Variables

| Variable                 | Default                  | Description                           |
| ------------------------ | ------------------------ | ------------------------------------- |
| `AUTOTEL_BACKEND`        | `collector`              | Backend: `collector`, `jaeger`        |
| `AUTOTEL_TRANSPORT`      | `stdio`                  | MCP transport: `stdio`, `http`        |
| `AUTOTEL_PORT`           | `3000`                   | MCP HTTP port                         |
| `AUTOTEL_COLLECTOR_PORT` | `4318`                   | OTLP receiver port                    |
| `AUTOTEL_PERSIST`        | —                        | libsql file path (omit for in-memory) |
| `AUTOTEL_MAX_TRACES`     | `10000`                  | Max traces before eviction            |
| `JAEGER_BASE_URL`        | `http://localhost:16686` | Jaeger API URL                        |

## Tools (33)

- **Discovery**: list_services, list_operations, backend_health, backend_capabilities, list_capabilities
- **Investigation**: search_traces, search_spans, get_trace, summarize_trace, compare_traces
- **Diagnosis**: find_anomalies, find_root_cause, find_errors, check_slos
- **Topology**: service_map, trace_flow
- **LLM Analytics**: get_llm_usage, list_llm_models, get_llm_model_stats, get_llm_expensive_traces, get_llm_slow_traces, list_llm_tools
- **Signals**: list_metrics, get_metric_series, search_logs
- **Correlation**: correlate, explain_slowdown
- **Config**: validate_collector_config, explain_collector_config, suggest_collector_config
- **Quality**: score_span_instrumentation, explain_instrumentation_score

## License

MIT
