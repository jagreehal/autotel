---
'autotel': minor
---

Add zero-config built-in logger option. Users can now use autotel without providing a logger - a built-in structured JSON logger with automatic trace context injection is used by default. The built-in logger supports dynamic log level control per-request and can be used directly via `createBuiltinLogger()` from 'autotel/logger'. Internal autotel logs are now silent by default to avoid spam.
