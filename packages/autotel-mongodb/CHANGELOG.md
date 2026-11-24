# autotel-mongodb

## 0.2.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [571b886]
  - autotel@9.7.0
  - autotel-db@0.1.2

## 0.1.2

### Patch Changes

- 039f92c: Adopt OpenTelemetry JS SDK 3 and add state transitions.

  **SDK 3:** upgrade to Node.js 22.15+ and `@opentelemetry/api` 1.10.

  - Import `@opentelemetry/sdk-trace` in place of `sdk-trace-base`, `sdk-trace-node` and `sdk-trace-web`, and `@opentelemetry/api` in place of `api-logs`.
  - Use `TracerProvider` for the Basic, Node and Web providers, and `trace.setGlobalTracerProvider()` for `register()`.
  - Pass processors an options object: `new BatchSpanProcessor({ exporter })`.
  - Rename `SdkLogRecord` to `ReadWriteLogRecord`. `SpanAttributeValue` in `autotel-subscribers` is now `unknown`.
  - Send to Jaeger over OTLP.
  - `init()` reads `OTEL_BSP_*`, `OTEL_SPAN_*` and `OTEL_ATTRIBUTE_*`.

  **State transitions:**

  - **autotel:** `transition()` counts `autotel.state.transitions` after a persisted write, whatever the sampling decision. `init()` warns when another tracer provider holds the global, and sets `deployment.environment` and `deployment.environment.name` to one value, taken from `environment`, then either key in `OTEL_RESOURCE_ATTRIBUTES` or `resourceAttributes`, then `NODE_ENV`.
  - **autotel-subscribers:** `ArchitectureSnapshotSubscriber` adds aggregated `transitions`.
  - **autotel-mongoose:** prototype `watchTransitions()` records transitions from a change stream.
  - **autotel-mcp:** `get_state_transitions` and `get_entity_history` read them. `getMetricSeries` takes `groupBy`, the collector keeps metric temporality and start times, and Loki attribute filters reach structured metadata.

  `autotel-aws/durable` has an install command in its README.

- Updated dependencies [092e810]
- Updated dependencies [6e32484]
- Updated dependencies [039f92c]
- Updated dependencies [092e810]
- Updated dependencies [3c872f2]
  - autotel@9.0.0
  - autotel-db@0.1.1

## 0.1.1

### Patch Changes

- eab108d: Update dependencies to their latest releases.
- Updated dependencies [eab108d]
  - autotel@8.2.2
  - autotel-db@0.1.1

## 0.1.0

### Minor Changes

- d7ec28e: Query insight for MongoDB and Postgres, with a Queries tab in devtools.

  - **`autotel-db`** (new): the shared vocabulary. `hashStatement()` for `db.statement.hash`, `planAttributes()` for `db.plan.*`, and `readPlan()` / `groupQueries()` for readers.
  - **`autotel-mongodb`** (new): `serializeMongoStatement()` and `serializeMongoCommand()` record each query with its values replaced by `?`, so repeats group. `planFromExplain()` reads `explain()` output, including an index suggestion by the Equality, Sort, Range rule.
  - **`autotel-mongoose`**: `db.query.text` records the value-free shape, and every operation sets `db.statement.hash`. To capture values, pass `dbStatementSerializer: (_op, payload) => JSON.stringify(payload)`. The new `explain: 'plan' | 'analyze'` option adds the plan to query and aggregate spans after the query settles.
  - **`autotel-drizzle`**: plans use the shared names (`db.plan.full_scan` for a full scan) and add stages, blocking sorts and a capture status. Inside `db.transaction()`, plans come from a separate pooled connection.
  - **`autotel-devtools`**: a Queries tab groups statements per database with count, p95, rows examined against returned, the plan and its stages, the index to create, and repeats within a trace. The waterfall marks full scans and repeats.
  - **`autotel-mcp`**: `find_repeated_queries` groups through `autotel-db`.

### Patch Changes

- Updated dependencies [d7ec28e]
  - autotel-db@0.1.0
