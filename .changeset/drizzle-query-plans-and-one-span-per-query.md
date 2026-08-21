---
'autotel-drizzle': patch
---

Trace each query once, and record what the database did with it.

**One span per query.** drizzle layers a database object over a session and both
expose an entry point for the same round trip, so every query was traced twice:
once properly, and once as a blank `drizzle.query` span carrying no SQL and no
operation. One `db.execute()` produced 2 spans and a transaction with a single
statement produced 4. The lower layer now claims the query.

**Query plans.** `explain: 'plan' | 'analyze'` puts the postgres planner's answer
on the span, so a trace shows what the database did and not only what it was
asked for. Add an index and `db.statement` is unchanged, byte for byte, with the
same `db.statement.hash`; the duration moves and nothing says why. The same query
either side of a `CREATE INDEX`:

| | before | after |
| --- | --- | --- |
| `db.statement.hash` | `372269a8881e921a` | `372269a8881e921a` |
| `db.plan.hash` | `0b50591ce9f68f51` | `eb8765b8d1c4af5a` |
| `db.plan.node` | `Seq Scan` | `Bitmap Heap Scan` |
| `db.plan.indexes` | | `idx_comments_post_id` |
| `db.plan.rows_examined` | `200199` | `1001` |
| `db.plan.blocks` | `1861` | `1005` |

An unchanged statement hash beside a changed plan hash is a planner decision.
Off by default: both modes add a round trip, and `'analyze'` executes the
statement again to measure it, so it runs on read-only statements only and a
traced insert never runs twice.

**Transaction spans.** `drizzle.transaction` wraps the whole callback, so it
measures how long the transaction held its connection and its locks, including
the time your code spent between statements. Turn it off with
`traceTransactions: false`.

**Table names.** `db.collection.name` carries the table, read from the SQL so raw
`db.execute` groups alongside query-builder calls.

**Current attribute names.** `semconv` selects `'legacy'`, `'stable'`, or
`'dup'`, and follows `OTEL_SEMCONV_STABILITY_OPT_IN` when unset. The default
stays legacy, so existing dashboards keep working.

**Tracer injection.** `tracerProvider` sends this client's spans to a provider
of your own rather than the globally registered one.

**mysql and sqlite.** mysql spans reported no table, because the pattern only
understood double-quoted identifiers and mysql quotes with backticks.
better-sqlite3 and bun-sqlite traced one query as two spans, because their
prepared query answers `all()` by calling `this.values()` on itself. Verified
across node-postgres, postgres.js, pglite, mysql2, better-sqlite3, and libsql,
each driven through the query builder, the relational API, and raw
`db.execute`.
