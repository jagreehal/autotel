# Mongoose + Autotel Example

This example demonstrates how to use the **custom autotel-plugins/mongoose** package for complete MongoDB observability with automatic hook tracing.

## Why Custom Plugin (Not Official Package)?

The official [@opentelemetry/instrumentation-mongoose](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/plugins/node/instrumentation-mongoose) package is **fundamentally broken in ESM+tsx environments**:

- ❌ Uses module loading hooks (`import-in-the-middle`) that fail with ESM import hoisting
- ❌ Mongoose package lacks proper dual-mode exports (CJS only)
- ❌ Works in CommonJS, but fails in modern ESM+tsx projects
- ❌ ESM support won't be production-ready for 1-2 years

**Our custom plugin uses runtime patching instead of module loading hooks, so it works everywhere.**

## What Gets Automatically Traced

**No manual instrumentation needed!** Just call `instrumentMongoose()` before defining schemas:

### 1. All Mongoose Operations (Automatic)
- `create()`, `insertMany()`, `bulkWrite()`
- `find()`, `findOne()`, `findById()`
- `findOneAndUpdate()`, `findByIdAndUpdate()`, `updateOne()`, `updateMany()`
- `deleteOne()`, `deleteMany()`
- `countDocuments()`, `aggregate()`
- Instance methods: `save()`, `remove()`

### 2. All Schema Hooks (Automatic - No Manual trace() Needed!)
- **Pre hooks**: `pre('save')`, `pre('findOneAndUpdate')`, etc.
- **Post hooks**: `post('save')`, `post('remove')`, etc.
- **Built-in hooks**: `post('init')` (document hydration)

### 3. Custom Business Logic (Manual with trace())
- API endpoint handlers
- Background jobs
- Custom validation logic

## Quick Start

```bash
# Install dependencies
pnpm install

# Start MongoDB
pnpm docker:up

# Run the example
pnpm start
```

## How It Works

### 1. Instrument Mongoose BEFORE Schemas

Create `src/init-mongoose.ts` to run before schema definitions:

```typescript
import mongoose from 'mongoose';
import { instrumentMongoose } from 'autotel-plugins/mongoose';

// Instrument Mongoose - patches Schema.prototype for automatic hook tracing
instrumentMongoose(mongoose, {
  dbName: 'myapp',
  peerName: 'localhost',
  peerPort: 27017,
});
```

### 2. Import Init File First in index.ts

```typescript
import 'dotenv/config';
import { init } from 'autotel';

// CRITICAL: Import BEFORE schemas to enable automatic hook tracing
import './init-mongoose';

// NOW import schemas - hooks automatically instrumented
import mongoose from 'mongoose';
import { User, Post } from './schema';

// Initialize OpenTelemetry
init({ service: 'my-app' });

// Connect to MongoDB
await mongoose.connect('mongodb://localhost:27017/myapp');
```

### 3. Define Schemas Normally - NO Manual Instrumentation!

```typescript
// schema.ts
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: String,
  email: String
});

// Hooks are AUTOMATICALLY traced - no trace() calls needed!
userSchema.pre('save', async function() {
  // This hook is automatically traced with:
  // - span name: mongoose.users.pre.save
  // - attributes: hook.type, hook.operation, hook.model, db.mongodb.collection
  console.log('Normalizing user data');

  this.email = this.email.toLowerCase();
  if (this.name) {
    this.name = this.name.trim();
  }
});

userSchema.post('save', function(doc) {
  // This hook is automatically traced too!
  console.log(`User persisted: ${doc.email}`);
});

export const User = mongoose.model('User', userSchema);
```

### 4. Run Normally - No Special Flags!

```bash
# Just tsx - no --import or --loader flags needed
tsx src/index.ts
```

## What You Get

### Automatic Operation Spans

```json
{
  "name": "mongoose.users.create",
  "kind": "CLIENT",
  "instrumentationScope": { "name": "autotel-plugins/mongoose" },
  "attributes": {
    "db.system": "mongoose",
    "db.operation": "create",
    "db.mongodb.collection": "users",
    "db.name": "myapp",
    "net.peer.name": "localhost",
    "net.peer.port": 27017
  }
}
```

### Automatic Hook Spans

```json
{
  "name": "mongoose.users.pre.save",
  "kind": "INTERNAL",
  "instrumentationScope": { "name": "autotel-plugins/mongoose" },
  "attributes": {
    "hook.type": "pre",
    "hook.operation": "save",
    "hook.model": "User",
    "db.mongodb.collection": "users",
    "db.system": "mongoose",
    "db.name": "myapp"
  }
}
```

### Parent-Child Relationships

Hooks are automatically nested under their parent operation:

```
createUser (custom span)
└─ mongoose.users.create (operation span)
   ├─ mongoose.users.pre.save (hook span)
   └─ mongoose.users.post.save (hook span)
```

## Configuration Options

```typescript
instrumentMongoose(mongoose, {
  // Database name to include in spans
  dbName: 'myapp',

  // MongoDB server details
  peerName: 'db.example.com',
  peerPort: 27017,

  // Include collection names in spans (default: true)
  captureCollectionName: true,

  // Custom tracer name (default: 'autotel-plugins/mongoose')
  tracerName: 'my-custom-tracer',
});
```

## Comparison: Before vs After

### Before (Manual Instrumentation)

```typescript
import { trace } from 'autotel';

userSchema.pre('save', async function() {
  // 😓 Lots of boilerplate code
  await trace(ctx => async () => {
    console.log('Normalizing');
    ctx.setAttribute('hook.type', 'pre');
    ctx.setAttribute('hook.operation', 'save');
    ctx.setAttribute('hook.model', 'User');
    ctx.setAttribute('db.mongodb.collection', 'users');

    this.email = this.email.toLowerCase();
  })();
});
```

### After (Automatic Instrumentation)

```typescript
// NO IMPORTS NEEDED!

userSchema.pre('save', async function() {
  // ✨ Clean business logic - automatically traced!
  console.log('Normalizing');
  this.email = this.email.toLowerCase();
});
```

**Result: 70% less code, zero boilerplate, same observability!**

## Production Usage

Use environment variables for configuration:

```bash
# .env or deployment config
OTEL_SERVICE_NAME=my-app
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=YOUR_API_KEY
MONGO_URL=mongodb://db.example.com:27017/production
```

Code stays clean:

```typescript
// init-mongoose.ts
import mongoose from 'mongoose';
import { instrumentMongoose } from 'autotel-plugins/mongoose';

instrumentMongoose(mongoose, {
  dbName: process.env.DB_NAME || 'myapp',
  peerName: process.env.MONGO_HOST,
  peerPort: parseInt(process.env.MONGO_PORT || '27017'),
});
```

## Docker Setup

Start MongoDB locally:

```bash
# Start MongoDB container
pnpm docker:up

# Stop and remove
pnpm docker:down
```

MongoDB will be available at `mongodb://localhost:27019`.

## Key Benefits

✅ **Zero Boilerplate**: Write normal Mongoose code, get automatic tracing
✅ **Complete Coverage**: Operations + hooks traced automatically
✅ **Works in ESM+tsx**: No loader hooks required
✅ **Semantic Attributes**: Proper OTel conventions automatically applied
✅ **Production-Ready**: Battle-tested runtime patching approach

## See Also

- [autotel-plugins documentation](../../packages/autotel-plugins/README.md)
- [autotel core documentation](../../packages/autotel/README.md)
- [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/)
