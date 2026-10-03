# autotel-mongodb

MongoDB query insight for OpenTelemetry: `db.query.text` that carries no values
and groups, and `db.plan.*` from `explain()` with an index suggestion.

`autotel-mongoose` uses it by default. For the plain `mongodb` driver, plug it
into the official `@opentelemetry/instrumentation-mongodb`.

```bash
npm install autotel-mongodb
```

## Query text

```typescript
import { init } from 'autotel';
import { serializeMongoCommand } from 'autotel-mongodb';

init({
  service: 'my-app',
  autoInstrumentations: {
    mongodb: { dbStatementSerializer: serializeMongoCommand },
  },
});
```

`users.findOne({ email: 'alice@example.com' })` records:

```json
{
  "find": "users",
  "filter": { "email": "?" },
  "limit": "?",
  "singleBatch": "?"
}
```

- Every value is `?`: nothing user-supplied reaches the span, and the same query
  with different values has the same text.
- A list of values is one `?`, so `$in` lists of any length are one statement.
  Batches (`insertMany` documents, bulk writes, update and delete batches) and
  `$or` / `$and` / `$nor` branches keep one entry per distinct shape, so a batch
  of 3 and one of 3,000 match. Every other array, an aggregation pipeline above
  all, keeps every entry in order: one `$match` stage and two are different
  queries.
- `serializeMongoCommand` keeps the collection a driver command names and drops
  the per-call session fields (`lsid`, `$clusterTime`, `txnNumber`, `$db`).
- `serializeMongoStatement` does the rest for any filter, update or pipeline,
  and treats every field as data.

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
