---
'autotel-backends': patch
---

`createDatadogConfig()` now exports metrics with delta temporality for direct ingestion, so counters, histograms and instrumentation metrics such as `http.client.request.duration` show up in Datadog. Agent mode is unchanged, and an explicit `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` still takes precedence.
