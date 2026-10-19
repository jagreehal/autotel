---
'autotel': minor
'autotel-edge': patch
'autotel-cli': patch
---

**autotel**

- Sampling decides whole traces, auto-instrumented spans included. `TailSamplingSpanProcessor` holds a trace until its local root and every span started under it end, then keeps or drops all of it. A child that fails or calls `forceKeep()` after the root returns still keeps the trace. With `sampling` set, HTTP, database and queue roots follow the same rules as `trace()` roots: errors and slow traces stay, the rest at the baseline rate. Services that rely on auto-instrumentation send fewer spans. With no sampler set, autotel keeps everything.
- `AdaptiveSampler` hashes the trace id for its baseline, so nested spans and services on the same rate agree. `SamplingContext` gains `traceId`.
- `autotel.debug` baggage keeps the whole trace.
- `TailSamplingSpanProcessor` options: `sampler`, `maxBufferedSpans` (default 20,000) and `traceTimeoutMs` (default 30 s). `init()` gives a `TailSamplingSpanProcessor` in your own `spanProcessors` its sampler.
- `spanFilter` keeps trace shape: filtering a local root such as `GET /health` drops its trace, and filtering a middle span re-parents its children to the nearest kept ancestor.
- Telemetry policies accept `metric` targets (OTEP 4738) with a boolean `keep`, matched per data point on `metric_field`, `metric_type`, `datapoint_attribute`, resource and scope attributes. `init()` applies them to the exporters it builds; wrap your own in `PolicyMetricExporter` from `autotel/policy`.
- `trace(fn)` and `withTracing()` name a span after the `const` it is assigned to, from source and from the built package in ESM and CommonJS.
- `init()` warns once when a tail sampler is configured and none of your `spanProcessors` holds a `TailSamplingSpanProcessor`.

**autotel-edge**: a `WorkerTracerProvider` built with span processors records spans with a parent-based, always-on head sampler, without a `setHeadSampler` call.

**autotel-cli**: `autotel add --no-install` skips installing packages.

New `production-observability` skill, skills aligned with the current APIs, and a CI check that every import in a skill resolves to a real export.
