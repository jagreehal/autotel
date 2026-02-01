# Autotel Plugins

OpenTelemetry instrumentation for libraries **without official support** OR where the official support is fundamentally broken.

## Philosophy

**autotel-plugins only includes instrumentation that:**

1. **Has NO official OpenTelemetry package** (e.g., Drizzle ORM)
2. **Has BROKEN official instrumentation** (e.g., Mongoose in ESM+tsx)
3. **Adds significant value** beyond official packages

**We do NOT include:**

- Re-exports of official packages
- Wrappers that add no value
- Duplicates of working official packages

## Why This Approach?

With the `--import` pattern (Node.js 18.19+), using official OpenTelemetry packages **when they work** is simple:

```javascript
// instrumentation.mjs
import { init } from 'autotel';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

init({
  service: 'my-app',
  instrumentations: [new PgInstrumentation()],
});
```

```bash
# Run with --import flag
tsx --import ./instrumentation.mjs src/index.ts
```

**Benefits of official packages (when they work):**

- ✅ Always up-to-date (maintained by OpenTelemetry)
- ✅ Complete feature coverage
- ✅ Battle-tested in production
- ✅ Zero maintenance burden
- ✅ More discoverable and trustworthy

## When to Use Official Packages

For databases/ORMs with **working** official instrumentation, **use those directly**:

- **MongoDB** → [`@opentelemetry/instrumentation-mongodb`](https://www.npmjs.com/package/@opentelemetry/instrumentation-mongodb)
- **PostgreSQL** → [`@opentelemetry/instrumentation-pg`](https://www.npmjs.com/package/@opentelemetry/instrumentation-pg)
- **MySQL** → [`@opentelemetry/instrumentation-mysql2`](https://www.npmjs.com/package/@opentelemetry/instrumentation-mysql2)
- **Redis** → [`@opentelemetry/instrumentation-redis`](https://www.npmjs.com/package/@opentelemetry/instrumentation-redis)
- **Express** → [`@opentelemetry/instrumentation-express`](https://www.npmjs.com/package/@opentelemetry/instrumentation-express)
- **Fastify** → [`@opentelemetry/instrumentation-fastify`](https://www.npmjs.com/package/@opentelemetry/instrumentation-fastify)

[Browse all official instrumentations →](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/plugins/node)

### ⚠️ Mongoose ESM Exception

**Note:** [`@opentelemetry/instrumentation-mongoose`](https://www.npmjs.com/package/@opentelemetry/instrumentation-mongoose) is fundamentally broken in ESM+tsx environments due to module loading hook issues. It works in CommonJS, but if you're using ESM with tsx/ts-node, use our custom plugin below.

## Installation

Install the package and **autotel** (required for all plugins):

```bash
npm install autotel autotel-plugins
```

### What to install per plugin

Each plugin needs the core packages above plus the library (and optional OTel instrumentation) you use:

| Plugin       | Install                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **Mongoose** | `autotel` + `autotel-plugins` + `mongoose`                                                                                 |
| **Drizzle**  | `autotel` + `autotel-plugins` + `drizzle-orm` + your driver (e.g. `postgres`, `mysql2`, `better-sqlite3`)                  |
| **BigQuery** | `autotel` + `autotel-plugins` + `@google-cloud/bigquery`                                                                   |
| **Kafka**    | `autotel` + `autotel-plugins` + `kafkajs`. Optional: `@opentelemetry/instrumentation-kafkajs` for producer/consumer spans. |

Examples:

```bash
# Mongoose
npm install autotel autotel-plugins mongoose

# Drizzle (e.g. Postgres)
npm install autotel autotel-plugins drizzle-orm postgres

# BigQuery
npm install autotel autotel-plugins @google-cloud/bigquery

# Kafka (with optional official instrumentation)
npm install autotel autotel-plugins kafkajs @opentelemetry/instrumentation-kafkajs
```

## Currently Supported

### Mongoose

Instrument Mongoose database operations with OpenTelemetry tracing using runtime patching. Works in ESM+tsx unlike the official package. **✨ NEW: Automatic hook instrumentation - no manual trace() calls needed!**

**Why we provide this:**

The official [`@opentelemetry/instrumentation-mongoose`](https://www.npmjs.com/package/@opentelemetry/instrumentation-mongoose) package is fundamentally broken in ESM+tsx environments:

- Uses module loading hooks (`import-in-the-middle`) that fail with ESM import hoisting
- Mongoose package lacks proper dual-mode exports (CJS only)
- Works in CommonJS, but fails in modern ESM projects
- No timeline for ESM support

Our implementation uses **runtime patching** instead of module loading hooks, so it works everywhere.

#### Basic Usage (with Automatic Hook Tracing)

```typescript
import mongoose from 'mongoose';
import { init } from 'autotel';
import { instrumentMongoose } from 'autotel-plugins/mongoose';

// Initialize Autotel
init({ service: 'my-app' });

// IMPORTANT: Instrument BEFORE defining schemas to enable automatic hook tracing
instrumentMongoose(mongoose, {
  dbName: 'myapp',
  peerName: 'localhost',
  peerPort: 27017,
});

// NOW define schemas - hooks are automatically traced!
const userSchema = new mongoose.Schema({ name: String, email: String });

userSchema.pre('save', async function () {
  // ✨ This hook is AUTOMATICALLY traced - no manual trace() needed!
  this.email = this.email.toLowerCase();
});

const User = mongoose.model('User', userSchema);

// Connect to MongoDB
await mongoose.connect('mongodb://localhost:27017/myapp');

// All operations AND hooks are automatically traced
await User.create({ name: 'Alice', email: 'ALICE@EXAMPLE.COM' });
// Creates spans: mongoose.users.create + mongoose.users.pre.save
```

#### What Gets Automatically Traced

**1. Model Operations** (all automatic):

- `create`, `insertMany`, `find`, `findOne`, `findById`
- `findOneAndUpdate`, `findByIdAndUpdate`, `updateOne`, `updateMany`
- `deleteOne`, `deleteMany`, `countDocuments`, `aggregate`
- Instance methods: `save`, `remove`, `deleteOne`

**2. Schema Hooks** (automatic - no manual code needed!):

- Pre hooks: `pre('save')`, `pre('findOneAndUpdate')`, etc.
- Post hooks: `post('save')`, `post('remove')`, etc.
- Built-in hooks: `post('init')` (document hydration)

#### Hook Instrumentation Setup

For automatic hook tracing, call `instrumentMongoose()` **before** defining schemas. ESM import hoisting means you need a separate init file:

**Pattern for ESM+tsx projects:**

Create `init-mongoose.ts`:

```typescript
import mongoose from 'mongoose';
import { instrumentMongoose } from 'autotel-plugins/mongoose';

instrumentMongoose(mongoose, { dbName: 'myapp' });
```

Import before schemas in `index.ts`:

```typescript
import './init-mongoose'; // Import first!
import { User, Post } from './schema'; // Hooks auto-instrumented
```

#### Configuration

```typescript
{
  dbName?: string                  // Database name
  captureCollectionName?: boolean  // Include collection in spans (default: true)
  peerName?: string                // MongoDB host
  peerPort?: number                // MongoDB port (default: 27017)
  tracerName?: string              // Custom tracer name
}
```

#### Span Attributes

**Operation Spans (SpanKind.CLIENT):**

- `db.system` - "mongoose"
- `db.operation` - create, find, update, etc.
- `db.mongodb.collection` - Collection name
- `db.name` - Database name
- `net.peer.name` / `net.peer.port` - MongoDB server

**Hook Spans (SpanKind.INTERNAL):**

- `hook.type` - "pre" or "post"
- `hook.operation` - save, findOneAndUpdate, etc.
- `hook.model` - Model name (User, Post, etc.)
- `db.mongodb.collection` - Collection name
- `db.system` - "mongoose"
- `db.name` - Database name

#### Before vs After (70% Less Code!)

**Before (Manual instrumentation):**

```typescript
import { trace } from 'autotel';

userSchema.pre('save', async function () {
  await trace((ctx) => async () => {
    ctx.setAttribute('hook.type', 'pre');
    ctx.setAttribute('hook.operation', 'save');
    // ... lots of boilerplate
    this.email = this.email.toLowerCase();
  })();
});
```

**After (Automatic instrumentation):**

```typescript
// NO trace() imports needed!
userSchema.pre('save', async function () {
  // Automatically traced with all attributes!
  this.email = this.email.toLowerCase();
});
```

### Drizzle ORM

Instrument Drizzle database operations with OpenTelemetry tracing. Drizzle doesn't have official instrumentation, so we provide it here.

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { instrumentDrizzleClient } from 'autotel-plugins/drizzle';

const queryClient = postgres(process.env.DATABASE_URL!);
const db = drizzle({ client: queryClient });

// Instrument the database instance
instrumentDrizzleClient(db, {
  dbSystem: 'postgresql',
  dbName: 'myapp',
  peerName: 'db.example.com',
  peerPort: 5432,
  captureQueryText: true,
});

// All queries are now traced
await db.select().from(users).where(eq(users.id, 123));
```

**Supported databases:**

- PostgreSQL (node-postgres, postgres.js)
- MySQL (mysql2)
- SQLite (better-sqlite3, LibSQL/Turso)

**Functions:**

- `instrumentDrizzle(client, config)` - Instrument a database client/pool
- `instrumentDrizzleClient(db, config)` - Instrument a Drizzle database instance

**Configuration:**

```typescript
{
  dbSystem?: string           // Database type (postgresql, mysql, sqlite)
  dbName?: string            // Database name
  captureQueryText?: boolean // Capture SQL in spans (default: true)
  maxQueryTextLength?: number // Max SQL length (default: 1000)
  peerName?: string          // Database host
  peerPort?: number          // Database port
}
```

**Span Attributes:**

- `db.system` - Database type (postgresql, mysql, sqlite)
- `db.operation` - Operation name (SELECT, INSERT, UPDATE, DELETE)
- `db.name` - Database name
- `db.statement` - SQL query text (if `captureQueryText: true`)
- `net.peer.name` - Database host
- `net.peer.port` - Database port

## Usage with Autotel

Drizzle instrumentation works seamlessly with [Autotel](../autotel):

```typescript
import { init } from 'autotel';
import { instrumentDrizzleClient } from 'autotel-plugins/drizzle';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

// Initialize Autotel
init({
  service: 'my-service',
  endpoint: 'http://localhost:4318',
});

// Instrument your database
const client = postgres(process.env.DATABASE_URL!);
const db = drizzle({ client });
instrumentDrizzleClient(db, { dbSystem: 'postgresql' });

// Traces will be sent to your OTLP endpoint
await db.select().from(users);
```

## Combining with Official Packages

Mix autotel-plugins with official OpenTelemetry instrumentations:

```typescript
import { init } from 'autotel';
import { instrumentDrizzleClient } from 'autotel-plugins/drizzle';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

init({
  service: 'my-service',
  instrumentations: [
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
    new PgInstrumentation(), // Official packages
  ],
});

// Drizzle (no official package available)
const db = drizzle({ client: postgres(process.env.DATABASE_URL!) });
instrumentDrizzleClient(db, { dbSystem: 'postgresql' });
```

## Security Considerations

### Query Text Capture

By default, Drizzle instrumentation captures SQL text which may contain sensitive data:

```typescript
// Disable SQL capture to prevent PII leakage
instrumentDrizzleClient(db, {
  captureQueryText: false,
});
```

## Examples

See the [example-drizzle](../../apps/example-drizzle) directory for a complete working example.

## TypeScript

Full type safety with TypeScript:

```typescript
import type { InstrumentDrizzleConfig } from 'autotel-plugins';

const config: InstrumentDrizzleConfig = {
  dbSystem: 'postgresql',
  captureQueryText: true,
  maxQueryTextLength: 1000,
};
```

## Future

When official OpenTelemetry instrumentation becomes available for Drizzle ORM, we will announce deprecation and provide a migration guide.

## Creating Your Own Instrumentation

Don't see your library here? Autotel makes it easy to create custom instrumentation for any library using simple, well-tested utilities.

### Quick Example

```typescript
import { trace, SpanKind } from '@opentelemetry/api';
import { runWithSpan, finalizeSpan } from 'autotel/trace-helpers';

const INSTRUMENTED_FLAG = Symbol('instrumented');

export function instrumentMyLibrary(client) {
  if (client[INSTRUMENTED_FLAG]) return client;

  const tracer = trace.getTracer('my-library');
  const originalMethod = client.someMethod.bind(client);

  client.someMethod = async function (...args) {
    const span = tracer.startSpan('operation', { kind: SpanKind.CLIENT });
    span.setAttribute('operation.param', args[0]);

    try {
      const result = await runWithSpan(span, () => originalMethod(...args));
      finalizeSpan(span);
      return result;
    } catch (error) {
      finalizeSpan(span, error);
      throw error;
    }
  };

  client[INSTRUMENTED_FLAG] = true;
  return client;
}
```

### Full Guide

For a comprehensive guide including:

- Step-by-step tutorial with real examples
- Best practices for security and idempotency
- Complete utilities reference
- Ready-to-use template code

**See: [Creating Custom Instrumentation](../autotel/README.md#creating-custom-instrumentation)** in the main autotel docs.

You can also check [`INSTRUMENTATION_TEMPLATE.ts`](../autotel/INSTRUMENTATION_TEMPLATE.ts) for a fully commented, copy-paste-ready template.

## Contributing

Found a database/ORM without official OpenTelemetry instrumentation? Please [open an issue](https://github.com/jagreehal/autotel/issues) to discuss adding it.

## License

MIT
