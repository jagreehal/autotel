---
'autotel-mcp': minor
---

New analysis tools for every backend:

- `aggregate_spans` reports count, error rate and avg/p50/p95/p99/max latency grouped by service, operation, version or any span attribute, with optional time buckets. On Datadog it runs server-side over every span.
- `aggregate_logs` counts logs by service, severity or attribute and lists the top message patterns.
- `what_changed` lists services whose `service.version` changed in the window, with error rate and p95 before and after.
- `find_root_cause` ranks spans by self time and returns the top five.

Agent experience:

- `AUTOTEL_TOOLSETS` (`core`, `llm`, `collector`, `semconv`, `estimate`) and `AUTOTEL_OMIT_TOOLS` choose which tools load.
- Tools reject unknown arguments by name.
- Results that reach their limit carry a `hint`, and traces carry a `url` into Datadog, Jaeger, SigNoz or Grafana.

Datadog now serves logs and metrics alongside traces. `correlate` returns a trace with its logs, and `list_services` includes services that send OTLP spans. Spans keep their attributes as dotted keys and nanosecond durations, and searches stay within Datadog's rate limit.

Grafana Cloud: set `GRAFANA_CLOUD_TOKEN` with `TEMPO_USERNAME`, `LOKI_USERNAME` and `PROMETHEUS_USERNAME` to query Tempo, Loki and Prometheus.
