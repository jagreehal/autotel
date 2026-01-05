---
'autotel': minor
'@jagreehal/example-canonical-logs': minor
---

Add canonical log lines (wide events) feature to automatically emit spans as comprehensive log records. Implements the "canonical log line" pattern: one log line per request with all context, making logs queryable as structured data instead of requiring string search.

**autotel:**
- New `canonicalLogLines` option in `init()` config
- `CanonicalLogLineProcessor` for automatic span-to-log conversion
- Supports root spans only, custom message format, min level filtering
- Works with any logger (Pino, Winston) or OTel Logs API

**@jagreehal/example-canonical-logs:**
- New demo app showcasing canonical log lines vs traditional logging
- Demonstrates the difference between scattered log lines and one wide event per request
