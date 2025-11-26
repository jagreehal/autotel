---
'autotel-edge': minor
'autotel': minor
'autotel-cloudflare': minor
---

Add support for array attributes in trace context

Extended `setAttribute` and `setAttributes` methods to support array values (string[], number[], boolean[]) in addition to primitive values, aligning with OpenTelemetry's attribute specification. This allows setting attributes like tags, scores, or flags as arrays.
