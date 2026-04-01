---
name: autotel-mongoose
description: >
  Use this skill when adding OpenTelemetry tracing to a Mongoose 8+ application — covers instrumentMongoose(), query text capture, automatic PII redaction, and Schema hook instrumentation.
type: integration
library: autotel-mongoose
library_version: '0.0.2'
sources:
  - jagreehal/autotel:packages/autotel-mongoose/CLAUDE.md
---

# autotel-mongoose

OpenTelemetry instrumentation for Mongoose 8+ with automatic `db.query.text` capture and built-in PII redaction. This package exists because the official `@opentelemetry/instrumentation-mongodb` has broken ESM+tsx support; use this instead when running Mongoose in an ESM environment.

## Setup

```bash
npm install autotel-mongoose
# mongoose and autotel are peer dependencies
```

```typescript
// src/instrumentation.mts
import 'autotel/register';
import { init } from 'autotel';
import mongoose from 'mongoose';
import { instrumentMongoose } from 'autotel-mongoose';

init({ service: 'my-app' });

// IMPORTANT: call BEFORE defining schemas or models
instrumentMongoose(mongoose, {
  dbName: 'myapp',
  peerName: 'mongo.example.com',
  peerPort: 27017,
});
```

```bash
node --import ./src/instrumentation.mts dist/index.js
```

## Core Patterns

### Basic instrumentation

```typescript
import mongoose from 'mongoose';
import { instrumentMongoose } from 'autotel-mongoose';

// Minimal — defaults apply
instrumentMongoose(mongoose);

// With connection metadata
instrumentMongoose(mongoose, {
  dbName: 'myapp',
  peerName: 'localhost',
  peerPort: 27017,
});
```

### Configuration reference (`InstrumentMongooseConfig`)

```typescript
interface InstrumentMongooseConfig {
  dbName?: string; // Sets db.namespace on spans
  peerName?: string; // Sets server.address on spans
  peerPort?: number; // Sets server.port (default: 27017)
  tracerName?: string; // Default: 'autotel-mongoose'
  captureCollectionName?: boolean; // Include db.collection.name (default: true)
  instrumentHooks?: boolean; // Instrument Schema pre/post hooks (default: false)

  // Controls db.query.text serialization
  dbStatementSerializer?:
    | ((operation: string, payload: SerializerPayload) => string | undefined)
    | false; // false = disable statement capture entirely

  // Controls redaction applied to serialized db.query.text
  statementRedactor?:
    | AttributeRedactorPreset // 'default' | other preset names
    | AttributeRedactorConfig // custom redactor config
    | false; // false = no redaction
}
```

### Span attributes

| Attribute            | Condition                                                       |
| -------------------- | --------------------------------------------------------------- |
| `db.system.name`     | Always (`mongodb`)                                              |
| `db.operation.name`  | Always (e.g., `find`, `insertMany`)                             |
| `db.collection.name` | When `captureCollectionName: true` (default)                    |
| `db.namespace`       | When `dbName` is set                                            |
| `db.query.text`      | When statement serialization is enabled (default: JSON payload) |
| `server.address`     | When `peerName` is set                                          |
| `server.port`        | When `peerPort` is set                                          |

Span names follow `<operation> <collectionName>` (e.g., `find users`) or fall back to `mongoose.<operation>`.

### What is instrumented

**Query-returning Model methods** (spans created; `exec()` wrapped for finalization):
`find`, `findOne`, `findById`, `findOneAndUpdate`, `findOneAndDelete`, `findOneAndReplace`, `deleteOne`, `deleteMany`, `updateOne`, `updateMany`, `countDocuments`, `estimatedDocumentCount`

**Model static methods** (spans created; promise finalization):
`create`, `insertMany`, `aggregate`, `bulkWrite`

**Model instance methods** (spans created; promise finalization):
`save`, `deleteOne` (on prototype)

**Chainable Query methods** (context propagation only, no span):
`populate`, `select`, `lean`, `where`, `sort`, `limit`, `skip`

**Schema hooks** (opt-in via `instrumentHooks: true`):
User-defined `pre` and `post` hooks are wrapped. Internal Mongoose hooks are skipped automatically.

### Statement capture and redaction

By default, query payloads are serialized to JSON and set as `db.query.text`, with the `'default'` redactor applied (strips emails, phone numbers, SSNs, credit cards).

```typescript
// Custom serializer — return undefined to suppress db.query.text for this operation
instrumentMongoose(mongoose, {
  dbStatementSerializer: (operation, payload) => {
    if (operation === 'find') {
      return JSON.stringify({ filter: payload.condition });
    }
    return undefined; // suppress for other operations
  },
});

// Disable statement capture entirely
instrumentMongoose(mongoose, {
  dbStatementSerializer: false,
});

// Keep capture but disable redaction (dangerous — only for trusted environments)
instrumentMongoose(mongoose, {
  statementRedactor: false,
});
```

### SerializerPayload shape

```typescript
interface SerializerPayload {
  condition?: Record<string, unknown>; // Query filter (find*, delete*, update*, count*)
  updates?: Record<string, unknown>; // Update document (findOneAndUpdate, updateOne, etc.)
  options?: Record<string, unknown>; // Query options
  fields?: Record<string, unknown>; // Projection fields
  aggregatePipeline?: unknown[]; // aggregate()
  document?: unknown; // create(), save() — single document
  documents?: unknown[]; // insertMany()
  operations?: unknown[]; // bulkWrite()
}
```

### Enabling Schema hook instrumentation

```typescript
instrumentMongoose(mongoose, {
  instrumentHooks: true, // default: false
});

// Hooks defined AFTER instrumentation are automatically wrapped
const userSchema = new mongoose.Schema({ name: String });

userSchema.pre('save', async function () {
  // This hook gets its own span: mongoose.users.pre.save
});
```

Hook spans use `SpanKind.INTERNAL` and carry `hook.type`, `hook.operation`, `hook.model`, `db.system.name`, and optionally `db.collection.name`.

Internal Mongoose hooks (those starting with `_` or `$`, or containing known internal patterns like `this.$__`) are automatically skipped.

### Idempotency

`instrumentMongoose` is idempotent. Multiple calls on the same `mongoose` instance are safe; the `__autotelMongooseInstrumented` flag prevents double-patching.

## Common Mistakes

### HIGH — Calling `instrumentMongoose` after defining schemas

```typescript
// Wrong: hooks on existing schemas are not retroactively wrapped
const User = mongoose.model('User', new mongoose.Schema({ name: String }));
instrumentMongoose(mongoose);

// Correct: instrument BEFORE defining any schema or model
instrumentMongoose(mongoose, { dbName: 'myapp' });
const User = mongoose.model('User', new mongoose.Schema({ name: String }));
```

Hook wrapping (`instrumentHooks: true`) only applies to `pre`/`post` calls made after `instrumentMongoose` runs. Model method patching affects `mongoose.Model` globally and works regardless, but hook instrumentation is order-sensitive.

### HIGH — Disabling redaction when query text contains PII

```typescript
// Dangerous: raw query payloads may include emails, IDs, or sensitive fields
instrumentMongoose(mongoose, {
  statementRedactor: false,
});

// Safer: use a custom serializer that only captures safe fields
instrumentMongoose(mongoose, {
  dbStatementSerializer: (operation, payload) => {
    // Only capture the operation name, not the full payload
    return JSON.stringify({ op: operation });
  },
});
```

The default `'default'` redactor covers common PII patterns (email, phone, SSN, credit card) but is not exhaustive. Review your query payloads before disabling redaction.

### MEDIUM — Using `instrumentHooks: false` (default) and expecting hook spans

```typescript
// Wrong assumption: hooks are NOT traced by default
instrumentMongoose(mongoose);
userSchema.pre('save', async function () {
  // No span created for this hook
});

// Correct: opt in explicitly
instrumentMongoose(mongoose, { instrumentHooks: true });
```

Hook instrumentation is off by default to avoid unexpected performance overhead and to avoid wrapping Mongoose internals by accident.

### MEDIUM — Using deprecated semconv attribute names

autotel-mongoose uses stable OTel semconv:

```typescript
// Deprecated (do not use in custom code alongside this package)
'db.statement'; // use db.query.text
'db.system'; // use db.system.name
'net.peer.name'; // use server.address
'net.peer.port'; // use server.port
```

The package exports stable constants from `autotel-mongoose/constants` if needed for custom attribute access.

### MEDIUM — Expecting spans for `.find()` without calling `.exec()`

```typescript
// Wrong: span is created but never finalized — it stays open
const query = User.find({ active: true });
const users = await query; // Mongoose auto-calls exec(), but the span wrapper may miss it

// Correct: always call .exec() explicitly when you need a guaranteed finalized span
const users = await User.find({ active: true }).exec();
```

The instrumentation wraps `exec()` to finalize the span. Implicit execution (Mongoose auto-calling `exec()` when you `await` a Query) should also work, but explicit `.exec()` is more reliable and clearer.

## Version

Targets autotel-mongoose v0.0.2 with mongoose >= 8.0.0 (peer dep) and autotel (peer dep). Uses stable OTel semconv only (`db.query.text`, `db.operation.name`, `db.system.name`, `db.collection.name`, `db.namespace`, `server.address`, `server.port`).
