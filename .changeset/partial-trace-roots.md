---
'autotel-devtools': minor
---

Mark partial traces instead of presenting a child as the root.

A trace arrives in pieces. Sampling keeps a failed span and drops the routine
parent above it; a downstream service exports before the service that started
the request. Devtools previously fell back to `spans[0]` whenever no parentless
span was present, so a fragment rendered exactly like a whole trace — a child
operation shown as the entry point, with a duration covering only the part that
happened to arrive.

`TraceData` now carries `partial?: boolean`. It is true when every span held has
a parent that did not arrive, and `rootSpan` is then the earliest span whose
parent is absent rather than an arbitrary child. The traces list shows a
`PARTIAL` badge and the trace detail says the duration covers only the spans
present.

`partial` is a fact about the spans held, not about a batch, so it is recomputed
as spans merge — a complete trace whose children arrive first is flagged on
arrival and unflagged the moment its root lands.
