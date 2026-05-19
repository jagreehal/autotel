---
name: autotel-investigate
description: >
  Query OpenTelemetry telemetry (traces, metrics, logs, LLM analytics) via the autotel CLI. Use when the user asks about a production issue, slow request, error spike, expensive LLM call, or any "what is happening in my service" question. Each command returns one JSON document on stdout — parse it and answer from the data.
---

# autotel-investigate

When the user asks about a production issue or telemetry data, drive the `autotel` CLI. Every command below emits one JSON document on stdout. Parse `result.data` on success or `result.error` on failure.

## Backend selection — required for every command in this file

Every command needs a backend. Pick one and reuse it:

| Backend | Flags |
|---|---|
| Built-in OTLP collector (in-memory) | `--backend collector` |
| Jaeger | `--backend jaeger --jaeger-base-url http://localhost:16686` |
| Tempo | `--backend tempo --tempo-base-url http://localhost:3200` |
| Prometheus | `--backend prometheus --prometheus-base-url http://localhost:9090` |
| Loki | `--backend loki --loki-base-url http://localhost:3100` |
| Tempo + Prom + Loki together | `--backend stack` + the three URL flags |
| Auto-detect localhost | `--backend auto` |
| Local JSON fixture | `--backend fixture --fixture-path ./telemetry.json` |

Environment variables work too (`AUTOTEL_BACKEND`, `JAEGER_BASE_URL`, …). Flags win over env. If you're not sure which backend is configured, run `autotel health` first.

## Decision tree — pick a command

1. **"Is anything broken?"** → `autotel diagnose errors` (recent error spans grouped by service/operation)
2. **"What's slow?"** → `autotel diagnose anomalies` or `autotel llm slow` for LLM-heavy services
3. **"Show me trace `<id>`"** → `autotel trace get <id>` for raw, `autotel trace summary <id>` for incident-friendly
4. **"Why did this trace fail?"** → `autotel diagnose root-cause <id>`, then `autotel correlate trace <id>` for the full picture
5. **"Why is service X degraded?"** → `autotel correlate explain-slowdown --service X` (anomalies + root causes + logs)
6. **"How much are we spending on LLMs?"** → `autotel llm usage`, then `autotel llm expensive` for top traces
7. **"What services / ops / fields exist?"** → `autotel discover services` / `autotel topology services` / `autotel discover trace-fields`
8. **"Are we meeting SLOs?"** → `autotel diagnose slos --service X --p99-latency-ms 500 --max-error-rate 0.01`

## Reference — every command

### Health
- `autotel health` — backend reachable + signal coverage
- `autotel capabilities` — which signals (traces/metrics/logs) the backend serves

### Discovery
- `autotel discover services` — services with cross-signal metadata
- `autotel discover trace-fields [--search foo]` — span field names + example values
- `autotel discover log-fields [--search foo]` — log field names + example values

### Query (raw search)
- `autotel query traces --service-name X --error-only --limit 20` — search traces
- `autotel query spans --min-duration-ms 1000` — search individual spans
- `autotel query metrics --metric-name http.server.duration` — list metric series
- `autotel query logs --severity-text ERROR --text "timeout"` — search logs

Common filters for `query traces` / `query spans`:
- Service/op: `--service-name`, `--operation-name`
- Time: `--lookback-minutes 60` OR `--from <iso> --to <iso>`
- Errors: `--error-only`, `--status-code ERROR`
- Duration: `--min-duration-ms`, `--max-duration-ms`
- LLM: `--gen-ai-system openai`, `--gen-ai-request-model gpt-4`

### Trace lookup
- `autotel trace get <traceId>` — full trace
- `autotel trace summary <traceId>` — compact incident-friendly view

### Topology
- `autotel topology services` — list services
- `autotel topology operations <serviceName>` — ops for one service
- `autotel topology map [--lookback-minutes 60]` — service dependency graph

### Diagnosis
- `autotel diagnose anomalies [--service X]` — statistical outliers
- `autotel diagnose root-cause <traceId>` — bottleneck span
- `autotel diagnose errors [--service X]` — error spans grouped by service/op
- `autotel diagnose slos --service X --p99-latency-ms 500 --max-error-rate 0.01` — SLO violations

### Correlation
- `autotel correlate trace <traceId>` — trace + metrics + logs in one call
- `autotel correlate explain-slowdown --service X` — anomalies enriched with root cause + signals

### LLM analytics
- `autotel llm usage` — tokens + USD by model and service
- `autotel llm models` — discover models in use
- `autotel llm model-stats --model-name gpt-4` — per-model stats
- `autotel llm expensive [--min-tokens 1000]` — top token-spend traces
- `autotel llm slow [--min-duration-ms 5000]` — slowest LLM traces
- `autotel llm tools` — tool/function spans grouped by tool

### Semantic conventions (no backend needed)
- `autotel semconv list` — list namespaces
- `autotel semconv get http` — groups for a namespace
- `autotel semconv refresh` — clear cache

### Instrumentation scoring (no backend needed)
- `autotel score < span.json` — score a span for instrumentation quality (JSON on stdin)
- `autotel score explain` — explain the rubric

### Collector config + schema (no backend needed)
- `autotel collector validate < config.json` — validate OTLP receiver config
- `autotel collector suggest` — minimal OTLP receiver config
- `autotel collector explain` — config shape + defaults
- `autotel collector versions` — supported collector schema versions
- `autotel collector components --version 0.110.0 --kind exporter` — components for a version
- `autotel collector schema --kind exporter --name otlphttp` — JSON schema for one component
- `autotel collector readme --kind exporter --name otlphttp` — README for one component
- `autotel collector validate-component --kind exporter --name otlphttp < cfg.json` — validate component config
- `autotel collector refresh` — refresh metadata cache

## Output contract

```json
// success
{ "ok": true, "command": "query traces", "data": { … } }

// failure
{ "ok": false, "error": { "type": "validation"|"runtime", "code": "AUTOTEL_E_*", "message": "…", "retryable": false } }
```

Exit codes: `0` success, `2` validation error, `1` runtime error.

Always parse the JSON; never try to read prose from stdout.

## When to use this vs the MCP server

- Use this skill when: the user just wants an answer, you're driving a one-shot prompt, or no MCP server is configured.
- Prefer `autotel-mcp` when: the session is an extended incident review with many follow-ups against a slow remote backend (the persistent connection wins on repeated queries).

Both return the same data — pick the one with less ceremony for the situation.
