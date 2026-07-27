---
'autotel-tanstack': patch
---

Add the server implementations of `getTraceParent`, `getTraceState`, `getCurrentTraceId` and `getCurrentSpanId`. The browser build exported all four, the server build exported none of them, so importing any of the four from `autotel-tanstack/context` crashed on the server. A new test compares the export keys of both builds, so the next mismatch fails in CI instead of at runtime.
