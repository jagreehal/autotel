---
'autotel': patch
'autotel-edge': patch
'autotel-effect': patch
---

Carry rich values onto the attributes autotel emits.

A `Map` now flattens to dot-notation keys the way a nested object does, and a `Set` is read as the array it carries. This holds across every path that turns a value into an attribute — `flattenToAttributes`, `flattenMetadata`, `toAttributeValue`, and the edge execution logger — so the same input gives the same attributes wherever it is attached: structured error details, request logger fields, execution log lines, and spans.

`Effect.annotateLogs` values flow through the same helper, so an exported log record carries the shape the rest of autotel emits: nested objects as dot-notation keys, a `Date` as an ISO string, an `Error` as its message. The log severity mapping comes from `@effect/opentelemetry` rather than a local copy.
