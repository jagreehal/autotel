# autotel-mongodb

MongoDB query insight for OpenTelemetry: `db.query.text` that carries no values
and groups, and `db.plan.*` from `explain()` with an index suggestion.

`autotel-mongoose` uses it by default. For the plain `mongodb` driver, plug it
into the official `@opentelemetry/instrumentation-mongodb`.

```bash
npm install autotel autotel-mongodb mongodb @opentelemetry/instrumentation-mongodb
```

## Query text

```typescript
// instrumentation.ts, loaded first: node --import ./instrumentation.ts app.ts
import 'autotel/register';
import { init } from 'autotel';
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb';
import { traceMongoCommands } from 'autotel-mongodb';

init({
  service: 'my-app',
  instrumentations: [traceMongoCommands(new MongoDBInstrumentation())],
});
```

```typescript
// app.ts
import { trace } from 'autotel';

await trace.run('user.load', () =>
  users.findOne({ email: 'alice@example.com' }),
);
```

The instrumentation traces calls made inside a span. To trace the rest, pass
`new MongoDBInstrumentation({ requireParentSpan: false })`.

The query records:

```json
{
  "find": "users",
  "filter": { "email": "?" },
  "limit": "?",
  "singleBatch": "?"
}
```

- Every value is `?`: user data stays out of the span, and the same query with
  different values has the same text.
- A list of values is one `?`, so `$in` lists of any length are one statement.
  Batches (bulk writes, update and delete batches) and `$or` / `$and` / `$nor`
  branches keep one entry per distinct shape, so a batch of 3 and one of 3,000
  match. Other arrays, such as a pipeline, keep each entry in order.
- A document being written (insert, replacement) is one `?`. An update keeps its
  operators and the fields they set, and its text is cut at 512 characters.
- `traceMongoCommands` gives each span the text and `db.collection.name` of the
  command it ran, for driver 3 to 7, and drops per-call session fields (`lsid`,
  `$clusterTime`, `txnNumber`, `$db`). It reads data fields and leaves getters and
  methods uncalled, showing `?` for what they hold.
- A `dbStatementSerializer` you configure keeps the text. Set one to export
  values: without it, text stays value-free under `enhancedDatabaseReporting` too.
- `traceMongoCommands` replaces two private methods of the instrumentation. With a
  version that renames one, it warns at startup and the text is `"?"`.
- Group native spans by `db.collection.name` and `db.query.text`;
  `db.statement.hash` comes with `autotel-mongoose`.
- `serializeMongoStatement` reads any filter, projection or pipeline, and treats
  each field as data.
- `serializeMongoPayload(operation, payload)` reads a Mongoose operation, with
  shorthand updates as the `$set` they become. `mongoPayloadKey` is the text to
  hash: it drops the fields an update sets, so one write is one hash.
- `serializeMongoCommand` is deprecated in favour of `traceMongoCommands`.

## Query plans

```typescript
import { planAttributes } from 'autotel-db';
import { planFromExplain } from 'autotel-mongodb';

const explain = await orders
  .find({ status: 'open', total: { $gte: 10 } })
  .sort({ createdAt: -1 })
  .explain('executionStats');

const plan = planFromExplain(explain);
if (plan) span.setAttributes(planAttributes(plan));
// db.plan.node: SORT, db.plan.full_scan: true, db.plan.rows_examined: 60,
// db.plan.index_suggestion: db.orders.createIndex({ status: 1, createdAt: -1, total: 1 })
```

`planFromExplain` reads find, count, update, delete and findAndModify explains,
aggregates with a `$cursor` stage, the slot-based engine's `queryPlan` wrapper,
and sharded plans. It returns `undefined` for anything that is not an explain.

When the plan scanned the collection or sorted in memory, it suggests the index
MongoDB's Equality, Sort, Range rule asks for. `suggestIndex(namespace,
parsedQuery, sortPattern?)` is exported for the same rule on its own. An `$or`
gets no suggestion: no single compound index serves one.

The attribute names come from `autotel-db`, shared with `autotel-drizzle`'s
Postgres plans.

## Testing

```bash
pnpm test
MONGO_TEST_URI=mongodb://127.0.0.1:27017 pnpm test:integration
```

The integration suite drives the real driver through the upstream
instrumentation and reads live explains; each run uses its own database and
drops it.
