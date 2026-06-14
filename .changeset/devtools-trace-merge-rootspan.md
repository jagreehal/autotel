---
"autotel-devtools": patch
---

Fix distributed traces appearing disconnected in the live UI. Spans for a single trace arrive across multiple batches and services, and the previous merge logic dropped every update to an already-known trace (the live widget/dashboard stayed stuck on the first batch) and never recomputed the root span when later batches arrived (so a trace whose downstream service exported first was mislabeled and rooted on a child span).

The server now recomputes the root span (and service label) on merge and broadcasts the merged trace, and the widget store merges late-arriving spans into existing traces instead of discarding them. End-to-end browser → API → auth → worker traces now connect correctly in both the embedded widget and the standalone dashboard, including the Service Map topology.
