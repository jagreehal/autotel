# autotel-mongoose

OpenTelemetry instrumentation for Mongoose with stable semantic conventions, `db.query.text` capture, and default PII redaction.

## What It Adds

- Captures `db.query.text` by default using `JSON.stringify`
- Redacts PII by default using Autotel's `'default'` redactor preset
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

This package supports Mongoose 8+.

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

## Custom Statics, Methods & Query Helpers

The functions you add via `schema.statics`, `schema.methods`, and `schema.query`
are invisible to the built-in Model/Query instrumentation. This package traces
them automatically — **no manual `trace()` calls** and no behavioral side
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
     db.system.name=mongodb, db.operation.name=findOne, db.collection.name=users, db.query.text={"condition":{"email":"A***@***.com"},...
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
and — when parameter capture is on — `mongoose.method.parameters` (+
`mongoose.method.parameter_count`).

> **Behavior note (default on):** With no `customMethods` option, `instrumentMongoose(mongoose)`
> wraps **all** custom functions and captures their arguments by default
> (maximum observability). Arguments pass through the same redactor as
> `db.query.text`, but custom-function args are often business payloads rather
> than DB filters — redaction won't catch arbitrary fields. Use the options
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
  customMethods: true, // wrap all custom statics/methods/query helpers (default)
};
```

## Statement Capture

By default, this package serializes query payloads into `db.query.text` and redacts sensitive values before they are added to the span.

You can disable statement capture entirely:

```typescript
instrumentMongoose(mongoose, {
  dbStatementSerializer: false,
});
```

You can also provide a custom serializer:

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

PII redaction is enabled by default through Autotel's `'default'` preset.

You can provide a custom redactor config or disable redaction:

```typescript
instrumentMongoose(mongoose, {
  statementRedactor: false,
});
```

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

MIT
