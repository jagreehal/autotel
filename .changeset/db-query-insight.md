---
'autotel-db': minor
'autotel-mongodb': minor
'autotel-mongoose': major
'autotel-drizzle': minor
'autotel-devtools': minor
'autotel-mcp': patch
---

Query insight for MongoDB and Postgres, with a Queries tab in devtools.

- **`autotel-db`** (new): the shared vocabulary. `hashStatement()` for `db.statement.hash`, `planAttributes()` for `db.plan.*`, and `readPlan()` / `groupQueries()` for readers.
- **`autotel-mongodb`** (new): `serializeMongoStatement()` and `serializeMongoCommand()` record each query with its values replaced by `?`, so repeats group. `planFromExplain()` reads `explain()` output, including an index suggestion by the Equality, Sort, Range rule.
- **`autotel-mongoose`**: `db.query.text` records the value-free shape, and every operation sets `db.statement.hash`. To capture values, pass `dbStatementSerializer: (_op, payload) => JSON.stringify(payload)`. The new `explain: 'plan' | 'analyze'` option adds the plan to query and aggregate spans after the query settles.
- **`autotel-drizzle`**: plans use the shared names (`db.plan.full_scan` for a full scan) and add stages, blocking sorts and a capture status. Inside `db.transaction()`, plans come from a separate pooled connection.
- **`autotel-devtools`**: a Queries tab groups statements per database with count, p95, rows examined against returned, the plan and its stages, the index to create, and repeats within a trace. The waterfall marks full scans and repeats.
- **`autotel-mcp`**: `find_repeated_queries` groups through `autotel-db`.
