---
'autotel': patch
---

Fix `Metric` recording into a no-op meter, and honour `OTEL_METRIC_EXPORT_INTERVAL`.

Two bugs that combined to mean business metrics never reached Prometheus.

`Config` resolves `metrics.getMeter()` when the module is imported, which is always before `init()` registers a MeterProvider. The metrics API hands back a no-op meter until a provider exists and never revisits that decision, so every counter and histogram created through `new Metric(...)` or `getMetrics(...)` silently recorded nothing. The meter is now re-resolved on read unless the caller supplied their own instance. Existing tests missed it because they call `configure({ meterName })` in setup, which happened to re-resolve.

`PeriodicExportingMetricReader` hardcodes a 60s interval and only `NodeSDK` reads the standard env var, but autotel builds the reader itself. `OTEL_METRIC_EXPORT_INTERVAL` and `OTEL_METRIC_EXPORT_TIMEOUT` are now honoured, so a short-lived process or a local demo can export often enough for `rate()` to return anything. Unset, the SDK defaults are untouched.
