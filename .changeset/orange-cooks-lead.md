---
'autotel-mcp': patch
---

Add devtools telemetry backend that reads traces from a running autotel-devtools receiver via its GET /v1/traces read-back API. Extract shared span-mapping utilities (normalizeTagValue, normalizeTags, readNumericTag, inferErrorStatusFromTags) to eliminate duplication across jaeger, tempo, and devtools backends.
