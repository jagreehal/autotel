---
'autotel-effect': patch
---

`Effect.withLogSpan` durations reach the log record as `logSpan.<label>` in milliseconds, and the record's timestamp comes from the fiber's clock.
