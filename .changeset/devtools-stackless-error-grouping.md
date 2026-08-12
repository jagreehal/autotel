---
'autotel-devtools': patch
---

Group stackless errors that differ only in a number with a unit suffix

`normalizeMessage` stripped numbers with `\b\d+\b`, which never matches `37` in
`37ms` — there is no word boundary between a digit and a letter. Durations,
sizes and timeouts written with their unit therefore survived normalisation.

That only matters when an error has no stack trace, because then the normalised
message _is_ the fingerprint: one bug produced a fresh group per occurrence, so
a repeating timeout showed up as many one-off errors rather than one frequent
one — the opposite of what aggregation is for.

Fingerprints for affected errors change value, so groups carried over from a
previous run will not merge with new ones.

The bounded form is still correct in the SQL normalisers elsewhere in the
monorepo, where it deliberately protects identifiers like `col1` from being
rewritten to `col?`. Those are unchanged.
