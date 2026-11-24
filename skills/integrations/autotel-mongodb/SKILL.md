---
name: autotel-mongodb
description: >
  Use this skill when tracing the plain MongoDB driver with autotel: value-free db.query.text that groups repeated queries (traceMongoCommands around @opentelemetry/instrumentation-mongodb), and reading explain() output into db.plan.* attributes with an index suggestion (planFromExplain).
---

# autotel-mongodb

MongoDB query insight for OpenTelemetry. `autotel-mongoose` uses it by default; with the plain `mongodb` driver you wrap the official instrumentation and pass it to `init()`.

## Setup

```bash
npm install autotel autotel-mongodb mongodb @opentelemetry/instrumentation-mongodb
```

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

The query now records:

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

- `traceMongoCommands(instrumentation)`: gives each native span the text and `db.collection.name` of the command it ran. A `dbStatementSerializer` you configure keeps the text; set one to export values. Group these spans by `db.collection.name` and `db.query.text`.
- `serializeMongoStatement(value)`: for any filter, projection or pipeline. Every field is data.
- `serializeMongoPayload(operation, payload)` and `mongoPayloadKey(operation, payload)`: the text and the hash key of a Mongoose operation. Shorthand updates read as `$set`; the key drops the fields an update sets.

Every value becomes `?`. A list of values (`$in: [1, 2, 3]`) is one `?`. Written documents are one `?`, and an update's text is cut at 512 characters. Bulk writes and `$or` / `$and` branches keep one entry per distinct shape, so a batch of 3 and one of 3,000 group together. Pipelines keep every stage, in order.

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

### HIGH: Passing a serializer to the driver instrumentation

```typescript
// Receives part of some commands: an inserted document or a bare filter
init({
  service: 'my-app',
  autoInstrumentations: {
    mongodb: { dbStatementSerializer: serializeMongoStatement },
  },
});

// Reads the whole command
init({
  service: 'my-app',
  instrumentations: [traceMongoCommands(new MongoDBInstrumentation())],
});
```

### MEDIUM: Expecting a plan on every span

The driver instrumentation records statements, not plans. Fetch a plan where you run the query and attach it with `planFromExplain`. With Mongoose, `instrumentMongoose(mongoose, { explain: 'plan' })` does this for every query.
