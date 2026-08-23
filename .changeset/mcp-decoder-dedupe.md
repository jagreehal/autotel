---
'autotel-mcp': patch
---

Route value decoding through `lib/values`, and fix two bugs an assertion hid.

`lib/values.ts` documents itself as the module that turns unread JSON into typed
values, and a dozen modules re-derived it anyway: `discovery`, `tempo` and
`span-mapping` each carried a private `asNumber` identical to the shared one,
`llm-analytics` and `query-filters` had their own string and tag decoders, and
several backends inlined the same checks by hand. They now call the shared
decoders, which gained `asTagValue`, `tagText` and `tagKind` to cover what the
call sites needed.

Two latent bugs surfaced on the way. The fixture backend's `serviceMap` passed a
`lookbackMinutes` that `TraceSearchQuery` has never declared — an assertion was
discarding it, so the argument had never narrowed anything. `readDashboard`'s
catalog is now a `Map`, and listing it no longer goes through `Object.values`,
which returns nothing for one.

Lookup tables keyed by user input (CLI flags, duration units, dashboard ids) are
`Map`s, so a miss reads as `undefined` instead of an index signature promising a
value for every string. Assertions that only restated a declared type are gone,
and the ones that remain state the invariant they rest on.
