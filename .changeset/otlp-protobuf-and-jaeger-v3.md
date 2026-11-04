---
'autotel-mcp': minor
'autotel-devtools': minor
---

OTLP/protobuf and gzip on both receivers, plus Jaeger 2.22 support.

- autotel-mcp's collector accepts OTLP/protobuf, answers a protobuf request in protobuf and returns a 400 for a malformed body.
- autotel-mcp's collector stores histogram, exponential histogram and summary points as their mean, and keeps sub-millisecond span durations.
- autotel-mcp's Jaeger backend moves to `/api/v3` when `/api/services` answers 404. `AUTOTEL_BACKEND=auto` detects those servers.
- autotel-devtools reads `fixed64` histogram and summary counts over protobuf.
- Both receivers accept `Content-Encoding: gzip` up to 64 MiB inflated, and store a log record's `event_name` as `event.name` unless the record sets that attribute.
- autotel-devtools answers protobuf requests per the OTLP spec: an empty body on success, a `google.rpc.Status` on error. The `accepted*` counts go to JSON clients.
- autotel-devtools exports its protobuf decoder as `autotel-devtools/otlp-proto`.
