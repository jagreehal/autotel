---
'autotel-plugins': minor
'autotel': minor
'autotel-terminal': minor
---

- **autotel-plugins**: Add BigQuery and Kafka plugins.
  - **BigQuery**: OpenTelemetry instrumentation for `@google-cloud/bigquery` (query, insert, load, copy, extract, job tracking; optional query sanitization and GCP semantic attributes). No official OTel support; optional peer dependency.
  - **Kafka**: Composition layer for use with `@opentelemetry/instrumentation-kafkajs`: processing span wrapper with context mode (inherit/link/none), batch lineage for fan-in trace correlation, and correlation ID policy. Re-exports messaging constants and helpers from `common/constants`.
  Kafka plugin EDA enhancements — add `withProducerSpan` and `injectTraceHeaders` for PRODUCER semantics, processing-span context mode, batch lineage attributes, and correlation ID header support.
- **autotel**: Version alignment with autotel-plugins.
- **autotel-terminal**: Terminal trace viewer updates — README and setup docs, internal refactor (lib/), and CHANGELOG.
