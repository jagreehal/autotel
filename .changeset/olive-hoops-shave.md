---
'autotel-devtools': minor
'autotel-mcp': patch
'autotel': patch
---

Fix log attribute filtering, result totals, and the devtools dashboard title.

**autotel-mcp** — `searchLogs` filtered attributes with a JSON path built by
string interpolation (`$."key"`). SQLite's path parser does not honour the `\"`
escape, so any attribute key containing a quote or backslash matched **zero
rows** silently. Filtering now goes through `json_each`, which takes the key as
a bound value and removes path quoting from the picture entirely.

`searchLogs` and `listMetrics` also reported `totalCount` as the post-`LIMIT`
row count, so a caller could not tell one matching record from one of four
hundred. Both now count against the same predicate without the limit, matching
the fixture backend. The in-memory attribute matcher duplicated in the fixture
backend is now the shared `matchesAllTags` from `modules/query-filters`.

**autotel** — pretty log output rendered the OTel `SpanStatusCode` in the HTTP
status slot, printing a non-HTTP span as `1` and colouring a failed span green.
The slot is now HTTP-only; non-HTTP spans are named by their operation instead,
and a span that failed while its level was overridden below `error` is marked so
the failure is still visible.

**autotel-devtools** — `--title` / `AUTOTEL_DEVTOOLS_TITLE` was documented as
the dashboard title but only ever changed the startup banner; every browser tab
still read `autotel-devtools`. The title now reaches the served page and the
Picture-in-Picture window, HTML-escaped. `DevtoolsRoutesOptions` gains an
optional `title`.
