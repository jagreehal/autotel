---
'autotel-schema': minor
'autotel': minor
---

Scenario conformance: flow-level contracts with completion boundaries.

`autotel-schema` gains a `scenarios` section in `defineContract()` — declare which events one exercised flow must emit, their cardinality (`'exactly 1'`, `'at most 3'`, ranges), required ancestor→descendant topology edges, and a first-class completion boundary (`terminal-event`, `root-span-closed`, `workflow-completed`, `phase-completed`, `externally-reconciled`). `checkScenario()` polls collected spans until the boundary closes, a definitive violation appears, or the observation budget is spent, and returns one of **three** outcomes: `conformant`, `non-conformant`, or `incomplete` — so infrastructure slowness is never reported as behavioural regression. Absence is definitive only after closure; unexpected errors and exceeded `max` cardinality fail fast while the flow is still open; undeclared events are additive (reported, never failing). `proposeScenario()` drafts a contract from N recorded runs (record → propose → commit).

`autotel` gains `TestSpanCollector.peekTrace(traceId, rootSpanId?)` — a non-destructive read of a trace's finished spans, so a scenario checker can poll while an async flow is still emitting. Its `SerializedSpan` output feeds `checkScenario()` directly.
