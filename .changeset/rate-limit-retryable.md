---
'autotel-cli': patch
---

Report a rate-limited backend as retryable.

A 429 that outlasted the HTTP layer's retry budget was returned as
`AUTOTEL_E_UNKNOWN` with `retryable: false`, which says the query failed for
good. An agent reading that answers "no data" instead of waiting for the limit
window and asking again — a confident wrong answer drawn from a transient
condition.

It now returns `AUTOTEL_E_RATE_LIMITED` with `retryable: true` and a message
saying to wait for the window to reset. Found while driving the Logfire backend
against a live project, whose query API allows roughly ten requests a minute.
