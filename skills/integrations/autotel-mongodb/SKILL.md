---
name: autotel-mongodb
description: >
  Use this skill when tracing the plain MongoDB driver with autotel: value-free db.query.text that groups repeated queries (serializeMongoCommand for @opentelemetry/instrumentation-mongodb), and reading explain() output into db.plan.* attributes with an index suggestion (planFromExplain).
---

# autotel-mongodb

MongoDB query insight for OpenTelemetry. `autotel-mongoose` uses it by default; with the plain `mongodb` driver you plug it into the official instrumentation that `init()` loads.

## Setup

```bash
npm install autotel autotel-mongodb
```

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

`users.findOne({ email: 'alice@example.com' })` now records:

```json
{
  "find": "users",
  "filter": { "email": "?" },
  "limit": "?",
  "singleBatch": "?"
}
```

## Core Patterns

### Value-free statements

- `serializeMongoCommand(command)`: for a whole driver command. Keeps the collection the command names and drops per-session fields (`lsid`, `$clusterTime`, `txnNumber`, `$db`).
- `serializeMongoStatement(value)`: for any filter, update or pipeline. Every field is data.

Every value becomes `?`. A list of values (`$in: [1, 2, 3]`) is one `?`. Batches (`insertMany` documents, bulk writes) and `$or` / `$and` branches keep one entry per distinct shape, so a batch of 3 and one of 3,000 group together. Pipelines keep every stage, in order.

### Query plans

```typescript
import { planAttributes } from 'autotel-db';
import { planFromExplain } from 'autotel-mongodb';

const plan = planFromExplain(
  await orders
    .find({ status: 'open' })
    .sort({ createdAt: -1 })
    .explain('executionStats'),
);
if (plan) span.setAttributes(planAttributes(plan));
```

`planFromExplain` reads find, count, update, delete, findAndModify and aggregate explains, the slot-based engine's plan wrapper, and sharded plans. It returns `undefined` for anything that is not an explain.

| Attribute                  | Meaning                                              |
| -------------------------- | ---------------------------------------------------- |
| `db.plan.stages`           | Every stage, root first: `[SORT, COLLSCAN]`          |
| `db.plan.full_scan`        | A `COLLSCAN` anywhere in the plan                    |
| `db.plan.blocking_sort`    | An in-memory `SORT`                                  |
| `db.plan.indexes`          | Indexes used (`_id_` for an `_id` lookup)            |
| `db.plan.keys_examined`    | `totalKeysExamined`                                  |
| `db.plan.rows_examined`    | `totalDocsExamined`                                  |
| `db.plan.rows_returned`    | `nReturned`                                          |
| `db.plan.index_suggestion` | `createIndex` call by the Equality, Sort, Range rule |

`indexAdvice(namespace, parsedQuery, sortPattern?)` returns the suggestion with each key's role (`equality`, `sort`, `range`); `suggestIndex` returns only the command.

## Common Mistakes

### HIGH: Passing `serializeMongoStatement` to the driver instrumentation

```typescript
// Collection names become "?" too
init({
  service: 'my-app',
  autoInstrumentations: {
    mongodb: { dbStatementSerializer: serializeMongoStatement },
  },
});

// The command serializer keeps them
init({
  service: 'my-app',
  autoInstrumentations: {
    mongodb: { dbStatementSerializer: serializeMongoCommand },
  },
});
```

### MEDIUM: Expecting a plan on every span

The driver instrumentation records statements, not plans. Fetch a plan where you run the query and attach it with `planFromExplain`. With Mongoose, `instrumentMongoose(mongoose, { explain: 'plan' })` does this for every query.
