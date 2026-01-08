---
'autotel-subscribers': minor
'autotel-cloudflare': minor
'autotel-backends': minor
'autotel-tanstack': minor
'autotel-terminal': minor
'autotel-plugins': minor
'autotel-edge': minor
'autotel-aws': minor
'autotel-mcp': minor
'autotel': minor
---

Add canonical log lines (wide events) feature to automatically emit spans as comprehensive log records. Implements the "canonical log line" pattern: one log line per request with all context, making logs queryable as structured data instead of requiring string search.

**autotel:**
- New `canonicalLogLines` option in `init()` config
- `CanonicalLogLineProcessor` for automatic span-to-log conversion
- Supports root spans only, custom message format, min level filtering
- Works with any logger (Pino, Winston) or OTel Logs API
- Attribute redaction support for sensitive data
