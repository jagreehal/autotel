# autotel-mongoose

OpenTelemetry instrumentation for Mongoose with stable semantic conventions, `db.query.text` that carries no values, a statement hash to group by, and optional query plans.

## What It Adds

- Captures `db.query.text` as the query's shape, every value replaced by `?`, so no user data reaches the span and the same query always reads the same
- Sets `db.statement.hash` on every operation, to group repeated queries (an N+1 is one hash, many spans)
- With `explain`, adds `db.plan.*`: stages, indexes used, documents examined, and the `createIndex` call a collection scan is missing
- Redacts PII by default (Autotel's `'default'` preset) in whatever a custom serializer emits
- Supports custom `dbStatementSerializer` functions with the same payload shape as the OpenTelemetry MongoDB plugin
- Uses stable semantic conventions only:
  - `db.system.name`
  - `db.operation.name`
  - `db.collection.name`
  - `db.namespace`
  - `db.query.text`
  - `server.address`
  - `server.port`
- Uses stable span names like `find users`

## Installation

Install `autotel-mongoose`, `autotel`, and `mongoose`:

```bash
npm install autotel autotel-mongoose mongoose
```

This package supports Mongoose 8+. Both major versions are exercised by the
test suite: Mongoose 8 drives hooks through kareem v2's callback convention
and Mongoose 9 through kareem v3's promise-based one, and the instrumentation
handles both.

## Basic Usage

```typescript
import mongoose from 'mongoose';
import { init } from 'autotel';
import { instrumentMongoose } from 'autotel-mongoose';

init({
  service: 'my-app',
  endpoint: 'http://localhost:4318',
});

instrumentMongoose(mongoose, {
  dbName: 'myapp',
});

const userSchema = new mongoose.Schema({
  name: String,
  email: String,
});

const User = mongoose.model('User', userSchema);

await mongoose.connect(process.env.MONGODB_URI!);
await User.findOne({ email: 'alice@example.com' }).exec();
```

`instrumentMongoose()` is safe to call more than once. Mongoose's `Model` and
`Query` prototypes are shared by every `new mongoose.Mongoose()`, so a second
call recognises what the first installed and leaves it alone: one span per
operation either way.

Methods Mongoose implements with other methods produce one span, not one per
delegation: `findById` traces as `findById`, without a nested `findOne` for the
same round trip. A query a hook issues is a separate round trip and keeps its
own span.

## Hook Instrumentation

Schema hook instrumentation is optional and disabled by default.

If you enable it, call `instrumentMongoose()` before defining schemas so `pre` and `post` hooks can be wrapped:

```typescript
import mongoose from 'mongoose';
import { instrumentMongoose } from 'autotel-mongoose';

instrumentMongoose(mongoose, {
  instrumentHooks: true,
});

const userSchema = new mongoose.Schema({
  name: String,
});

userSchema.pre('save', async function () {
  this.set('name', this.get('name')?.trim());
});
```

Spans are named after the operation that ran (`mongoose.users.pre.save`), and
Mongoose's own hooks stay out of the way: a schema using `timestamps`,
subdocuments or virtuals emits spans only for the hooks you wrote.

To limit span volume, pass an include list or an `{ include?, exclude? }`
selector. For example, `init` runs once for every hydrated document, so a find
returning 500 documents means 500 spans:

```typescript
instrumentMongoose(mongoose, {
  instrumentHooks: { exclude: ['init'] },
});
```

Selection works a hook at a time whichever way you register. Both
`pre(['save', 'validate'], fn)` and `pre(/^find/, fn)` are selected and named
per operation, so a `find` gets `pre.find` and a `findOne` gets `pre.findOne`.
Excluding a hook only stops the span; the handler still runs.

## Custom Statics, Methods & Query Helpers

The functions you add via `schema.statics`, `schema.methods`, and `schema.query`
are invisible to the built-in Model/Query instrumentation. This package traces
them automatically. **no manual `trace()` calls** and no behavioral side
effects (same `this`, same return value, same error propagation). Each call
gets an `INTERNAL` span named `mongoose.<Model>.<fn>`.

```typescript
userSchema.statics.findByEmail = function (email: string) {
  return this.findOne({ email }); // span: mongoose.User.findByEmail
};

userSchema.methods.describe = function () {
  return `${this.name} <${this.email}>`; // span: mongoose.User.describe
};

userSchema.query.byEmailDomain = function (domain: string) {
  return this.where({ email: new RegExp(`@${domain}$`) }); // span: mongoose.User.byEmailDomain
};
```

Example spans (from `apps/example-mongoose`, debug output). Note that a static
returning a Query becomes the **parent** of the underlying operation span, and
parameters are redacted by default:

```text
✓ findOne users                           1ms [autotel-mongoose]
     db.system.name=mongodb, db.operation.name=findOne, db.collection.name=users, db.query.text={"condition":{"email":"?"},...
✓ mongoose.User.findByEmail               2ms [autotel-mongoose]
     db.system.name=mongodb, code.function.name=findByEmail, mongoose.method.name=findByEmail, mongoose.method.type=static, mongoose.method.model=User, db.collection.name=users, mongoose.method.parameter_count=1, mongoose.method.parameters=["A***@***.com"]

✓ mongoose.User.describe                 27µs [autotel-mongoose]
     db.system.name=mongodb, code.function.name=describe, mongoose.method.name=describe, mongoose.method.type=instance, mongoose.method.model=User, db.collection.name=users, mongoose.method.parameter_count=0

✓ mongoose.User.countByDomain             2ms [autotel-mongoose]
     db.system.name=mongodb, code.function.name=countByDomain, mongoose.method.name=countByDomain, mongoose.method.type=static, mongoose.method.model=User, db.collection.name=users, mongoose.method.parameter_count=1, mongoose.method.parameters=["hotmail.com"]

✓ mongoose.User.byEmailDomain            82µs [autotel-mongoose]
     db.system.name=mongodb, code.function.name=byEmailDomain, mongoose.method.name=byEmailDomain, mongoose.method.type=query, mongoose.method.model=User, db.collection.name=users, mongoose.method.parameter_count=1, mongoose.method.parameters=["hotmail.com"]
```

As JSON:

```json
{
  "name": "mongoose.User.findByEmail",
  "kind": "INTERNAL",
  "instrumentationScope": { "name": "autotel-mongoose" },
  "attributes": {
    "db.system.name": "mongodb",
    "code.function.name": "findByEmail",
    "mongoose.method.name": "findByEmail",
    "mongoose.method.type": "static",
    "mongoose.method.model": "User",
    "db.collection.name": "users",
    "mongoose.method.parameter_count": 1,
    "mongoose.method.parameters": "[\"A***@***.com\"]"
  }
}
```

Span attributes: `mongoose.method.name`, `mongoose.method.type`
(`static` | `instance` | `query`), `mongoose.method.model`, `code.function.name`,
and, when parameter capture is on, `mongoose.method.parameters` (+
`mongoose.method.parameter_count`).

> **Behavior note (default on):** With no `customMethods` option, `instrumentMongoose(mongoose)`
> wraps **all** custom functions and captures their arguments by default
> (maximum observability). Arguments pass through the same redactor as
> `db.query.text`, but custom-function args are often business payloads rather
> than DB filters: redaction won't catch arbitrary fields. Use the options
> below to scope this down for privacy/compliance.

### Opting out / scoping (privacy & compliance)

```typescript
// Disable entirely
instrumentMongoose(mongoose, { customMethods: false });

// Per-category control. Anything not explicitly disabled stays on.
instrumentMongoose(mongoose, {
  customMethods: {
    statics: { exclude: ['chargeCard'] }, // opt-out specific statics
    methods: ['describe'], //               opt-in: only these instance methods
    query: false, //                        no query helpers
    captureParameters: false, //            trace calls, don't serialize args
  },
});

// Keep tracing, but never serialize arguments anywhere
instrumentMongoose(mongoose, { customMethods: { captureParameters: false } });

// Custom parameter serializer / longer cap / dedicated redactor
instrumentMongoose(mongoose, {
  customMethods: {
    captureParameters: {
      maxLength: 4096,
      redactor: 'default',
      serializer: (args, { methodName }) =>
        methodName === 'chargeCard' ? undefined : JSON.stringify(args),
    },
  },
});
```

A selector accepts `true` (all), `false` (none), `string[]` (opt-in to those
names), or `{ include?, exclude? }`. Config is resolved **per Mongoose
instance** at call time, so a schema object reused across multiple
instances/connections honors each instance's own configuration.

## Configuration

```typescript
import type { InstrumentMongooseConfig } from 'autotel-mongoose';

const config: InstrumentMongooseConfig = {
  dbName: 'myapp',
  peerName: 'mongodb.internal',
  peerPort: 27017,
  tracerName: 'autotel-mongoose',
  captureCollectionName: true,
  instrumentHooks: false,
  dbStatementSerializer: false,
  statementRedactor: 'default',
  explain: false, // or 'plan' / 'analyze'
  customMethods: true, // wrap all custom statics/methods/query helpers (default)
};
```

## Statement Capture

By default `db.query.text` is the payload's shape, from `autotel-mongodb`:
field names and operators, every value `?`. `find({ email: 'a@b.c' })` records
`{"condition":{"email":"?"},"options":{}}`, as does every other find by email.
A list of values is one `?`, and an `insertMany` batch keeps one entry per
distinct document shape, so batches of any size are one statement. Pipelines
keep every stage in order. The payload is read when `exec()` starts, so
`find().where('age').gt(0)` and `.lt(0)` are different statements.

`db.statement.hash` is computed from the operation, the collection and that
shape on every operation, whatever the serializer below emits, and even when
capture is off.

You can disable statement capture entirely:

```typescript
instrumentMongoose(mongoose, {
  dbStatementSerializer: false,
});
```

You can also provide a custom serializer. To capture values, which the
redactor below then masks:

```typescript
instrumentMongoose(mongoose, {
  dbStatementSerializer: (_operation, payload) => JSON.stringify(payload),
});
```

Or pick what to keep:

```typescript
instrumentMongoose(mongoose, {
  dbStatementSerializer(operation, payload) {
    return JSON.stringify({
      operation,
      condition: payload.condition,
      updates: payload.updates,
    });
  },
});
```

## Redaction

PII redaction is enabled by default through Autotel's `'default'` preset. It
applies to whatever the serializer returns; the default serializer has no
values to redact.

You can provide a custom redactor config or disable redaction:

```typescript
instrumentMongoose(mongoose, {
  statementRedactor: false,
});
```

## Query Plans

```typescript
instrumentMongoose(mongoose, { explain: 'analyze' });

await Order.find({ status: 'open', total: { $gte: 10 } })
  .sort({ createdAt: -1 })
  .exec();
```

| Attribute                  | Value                                                           |
| -------------------------- | --------------------------------------------------------------- |
| `db.plan.node`             | `SORT`                                                          |
| `db.plan.full_scan`        | `true`                                                          |
| `db.plan.rows_examined`    | `60`                                                            |
| `db.plan.rows_returned`    | `16`                                                            |
| `db.plan.index_suggestion` | `db.orders.createIndex({ status: 1, createdAt: -1, total: 1 })` |

The span also carries `db.plan.stages` (`[SORT, COLLSCAN]`),
`db.plan.keys_examined`, `db.plan.blocking_sort`, `db.plan.mode`, and the
suggested keys by role (`db.plan.index_suggestion.equality` / `.sort` /
`.range`). When explain cannot produce a plan, `db.plan.status` says why:
`unsupported` for a save, an insert or `estimatedDocumentCount`, `failed` with
`db.plan.error` when the database refused (a missing explain privilege, say).
A span without `db.plan.status` was never explained.

Create the suggested index and the same query records
`db.plan.full_scan: false`, `db.plan.indexes: status_1_createdAt_-1_total_1`,
and 16 documents examined for 16 returned.

- `'analyze'` runs `explain('executionStats')`: the query again, which is what
  reports documents examined and time.
- `'plan'` runs `explain('queryPlanner')`: the plan, without running anything.

Explain never applies a write, so updates and deletes are explained safely. It
is sent to the driver as a raw command, so your schema's pre and post hooks
run once per query, never again for the explain.
Queries and aggregates are explained; `estimatedDocumentCount` reads metadata
and has no plan.

The explain runs after the query settles. Your code gets its result without
waiting, and the span ends at the moment the query settled, so its duration is
the query's own. It is one more round trip per query: turn it on in
development, in CI, or for a sample of traffic.

The attribute names come from `autotel-db` and are shared with
`autotel-drizzle`'s Postgres plans, so `db.plan.full_scan: true` finds a
MongoDB `COLLSCAN` and a Postgres `Seq Scan` alike.

## Exported API

- `instrumentMongoose(mongoose, config?)`
- `InstrumentMongooseConfig`
- `SerializerPayload`
- `CustomMethodsConfig`, `CustomMethodType`, `MethodSelector`, `ParameterCaptureConfig`

## Notes

- Query and aggregate operations are traced automatically
- Instance methods like `save()` and `deleteOne()` are traced
- Static methods like `create()`, `insertMany()`, `aggregate()`, and `bulkWrite()` are traced
- User-defined statics, instance methods, and query helpers are traced automatically (see above)
- Hook and custom-function spans use `SpanKind.INTERNAL`

## License

Apache-2.0
