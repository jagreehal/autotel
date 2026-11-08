---
'autotel': minor
---

Canonical log lines sent through the OTel Logs API no longer repeat what an OTLP record already carries.

- Each record now belongs to its span's trace through the record's own trace context, even when the span ends after its request's context is gone. Before, such a line had no trace context at all.
- `traceId` and `spanId` are no longer copied into the record's attributes. Every OTLP backend reads them from the record's trace context.
- Resource attributes (`service.name`, `service.version`, and so on) are no longer copied into the attributes either. The record's resource already holds them. In Loki, the copies showed up as `*_extracted` fields.

`correlationId` stays: OTLP has no native field for it. Lines sent to a `logger` (pino, console) are unchanged, as are the events passed to `shouldEmit` and `drain`.

**Migration:** queries that filter on the `traceId` or `spanId` log attribute should use the backend's trace id field instead, such as `trace_id` in Loki. If your LoggerProvider was built with a different resource than your tracer, set `canonicalLogLines.includeResourceAttributes: true` to keep copying them.
