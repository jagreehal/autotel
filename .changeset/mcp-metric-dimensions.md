---
'autotel-mcp': patch
---

Keep metric dimensions through the collector, and honour the query window.

**Dimensions survive ingest.** OTel puts a metric's labels on the data point,
not the resource, but the OTLP receiver only read `resource.attributes`. Every
label set for a metric collapsed into one series at write time, so a counter
split by `lane` or `http.route` arrived as a single undifferentiated timeline
and the dimension was unrecoverable. Data-point attributes are now parsed and
merged with the resource attributes, one series per distinct set.

**`list_metrics` reports the series it found.** Series were keyed by metric name
alone, so two label sets merged into one series labelled with whichever row
SQLite returned first — wrong values under a real label, not missing ones. The
key is now name plus attributes, matching `getMetricSeries`, and `serviceName`
filters the result.

**`lookbackMinutes` is applied.** The tool always sends a window and defaults it
to 60 minutes; the collector ignored it and returned every point inside the
retention period. Point history is capped per call, with `detail` set when the
cap truncates a series.

**One definition per type.** `ServiceMap`, `ServiceMapNode`, `ServiceMapEdge`
and `TraceSummary` were declared both in `types.ts` and again in the modules
that build them. The declarations were structurally identical, so the duplicate
forced every backend to launder its result through `as unknown as` — fourteen
double assertions across seven backends, each one discarding the type evidence
it was written to preserve. The modules now re-export the canonical types and
the assertions are gone.

**One decoder, not fourteen.** `lib/values.ts` documents itself as the module
that turns unread JSON into typed values, and a dozen modules re-derived it
anyway: `discovery`, `tempo` and `span-mapping` each carried a private
`asNumber` identical to the shared one, `llm-analytics` and `query-filters` had
their own string and tag decoders, and several backends inlined the same checks
by hand. They now call the shared decoders. Two latent bugs surfaced on the way:
the fixture backend's `serviceMap` passed a `lookbackMinutes` that
`TraceSearchQuery` has never declared — an assertion was discarding it, so the
argument had never done anything — and `readDashboard`'s catalog was reachable
only by exact key.

Lookup tables keyed by user input (CLI flags, duration units, dashboard ids) are
`Map`s, so a miss reads as `undefined` instead of an index signature promising a
value for every string.
