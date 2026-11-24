---
'autotel-devtools': patch
'autotel-mcp': patch
---

Filter a large devtools history by service or duration in milliseconds. On 3,753 traces, `what_changed` for one service answers in under two seconds.

**autotel-devtools**

- Trace queries seek to their page by start time and look spans up through new `(trace_id, service)` and `(trace_id, duration)` indexes. A `--db` file gains them when devtools opens it; allow 20% headroom under `--db-max-size`.
- Spans that tie on start time or duration keep the order they arrived in.

**autotel-mcp**

- Span searches send devtools the end of their window. autotel-mcp filters a window with an infinite end itself, and accepts relative times that resolve to a finite timestamp.
