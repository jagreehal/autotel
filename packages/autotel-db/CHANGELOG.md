# autotel-db

## 0.1.2

### Patch Changes

- 571b886: Trace MongoDB commands and Mongoose transactions, and mark returned error Results on the span.

  **autotel**

  - `trace({ name, result: true }, fn)` marks the span ERROR and sets `error.type` when the function returns `{ ok: false, error }`.
  - One warning names an OTLP endpoint that refuses connections, with the command that starts `autotel-devtools`.

  **autotel-mongodb**

  - `traceMongoCommands(new MongoDBInstrumentation())` gives native driver spans (3 to 7) value-free `db.query.text` and the `db.collection.name` of the command they ran. It supersedes `serializeMongoCommand`, now deprecated, which shows the collection as `?`.
  - `serializeMongoPayload` and `mongoPayloadKey` give a Mongoose operation's text and hash key.
  - `serializeMongoStatement` keeps one entry per shape in `$or`, `$and` and `$nor`, and each entry of other arrays in order.

  **autotel-mongoose**

  - `mongoose.transaction` spans with `db.transaction.attempts` and `db.transaction.outcome`, plus commit and abort spans.
  - One `db.statement.hash` per write, whatever document it carries or fields it sets. Text shows written documents as `?`, shorthand updates as `$set`, and up to 512 characters of an update. Write hashes and text take new values.
  - `SerializerPayload.updatePipeline` holds an update that is a pipeline.

  **autotel-db**

  - `queryIdentity()` groups statements by collection as well as text, under new key strings.

- Updated dependencies [571b886]
  - autotel@9.7.0

## 0.1.1

### Patch Changes

- eab108d: Update dependencies to their latest releases.
- Updated dependencies [eab108d]
  - autotel@8.2.2

## 0.1.0

### Minor Changes

- d7ec28e: Query insight for MongoDB and Postgres, with a Queries tab in devtools.

  - **`autotel-db`** (new): the shared vocabulary. `hashStatement()` for `db.statement.hash`, `planAttributes()` for `db.plan.*`, and `readPlan()` / `groupQueries()` for readers.
  - **`autotel-mongodb`** (new): `serializeMongoStatement()` and `serializeMongoCommand()` record each query with its values replaced by `?`, so repeats group. `planFromExplain()` reads `explain()` output, including an index suggestion by the Equality, Sort, Range rule.
  - **`autotel-mongoose`**: `db.query.text` records the value-free shape, and every operation sets `db.statement.hash`. To capture values, pass `dbStatementSerializer: (_op, payload) => JSON.stringify(payload)`. The new `explain: 'plan' | 'analyze'` option adds the plan to query and aggregate spans after the query settles.
  - **`autotel-drizzle`**: plans use the shared names (`db.plan.full_scan` for a full scan) and add stages, blocking sorts and a capture status. Inside `db.transaction()`, plans come from a separate pooled connection.
  - **`autotel-devtools`**: a Queries tab groups statements per database with count, p95, rows examined against returned, the plan and its stages, the index to create, and repeats within a trace. The waterfall marks full scans and repeats.
  - **`autotel-mcp`**: `find_repeated_queries` groups through `autotel-db`.
