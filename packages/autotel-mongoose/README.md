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

## Notes

- Query and aggregate operations are traced automatically
- Instance methods like `save()` and `deleteOne()` are traced
- Static methods like `create()`, `insertMany()`, `aggregate()`, and `bulkWrite()` are traced
- Hook spans use `SpanKind.INTERNAL`

## License

MIT
