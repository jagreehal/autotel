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

**No manual instrumentation needed!** Just call `instrumentMongoose()` before defining schemas (and enable `instrumentHooks: true`):

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

### 3. Custom Statics, Methods & Query Helpers (Automatic - No Manual trace() Needed!)
- **Statics**: `userSchema.statics.findByEmail` → span `mongoose.User.findByEmail`
- **Instance methods**: `userSchema.methods.describe` → span `mongoose.User.describe`
- **Query helpers**: `userSchema.query.byEmailDomain` → span `mongoose.User.byEmailDomain`
- Wrapped automatically as the model compiles, with `mongoose.method.*` attributes and **redacted** call parameters (`mongoose.method.parameters`)
- On by default; scope with `customMethods` (see `init-mongoose.ts`)

### 4. Custom Business Logic (Manual with trace())
- API endpoint handlers
- Background jobs
- Custom validation logic

## Quick Start

```bash
# From the repo root:
cd apps/example-mongoose

# Install dependencies (workspace)
pnpm install

# Start MongoDB
pnpm docker:up

# Run the example
pnpm start

# Stop MongoDB
pnpm docker:down
```

## Debug Output (stdout) + Capturing Logs

This example enables Autotel debug output (spans printed to **stdout**) so you can see traces without configuring an OTLP backend.

- **Capture everything** (recommended for sharing in issues):

```bash
pnpm start 2>&1 | tee run.log
```

- **Control debug output** (env var overrides code):

```bash
# Pretty, hierarchical console output (recommended)
AUTOTEL_DEBUG=pretty pnpm start

# Raw JSON spans (very verbose)
AUTOTEL_DEBUG=true pnpm start

# Disable console span output
AUTOTEL_DEBUG=false pnpm start
```

- **What you should see**:
  - `✅ Mongoose instrumented ...`
  - `✅ Connected to MongoDB: mongodb://localhost:27017/autotel-example`
  - Span lines including operation spans like `mongoose.users.create`
  - **Hook span lines** like `mongoose.users.pre.save`, `mongoose.users.post.save`, `mongoose.users.pre.findOneAndUpdate`

Tip: to quickly prove hook spans are present, you can filter stdout for `.pre.` / `.post.` spans:

```bash
pnpm start 2>&1 | grep -E "mongoose\\.[^.]+\\.(pre|post)\\."
```

### Full Example Output (Actual Captured Run)

The demo covers: **CRUD operations**, **instance methods (doc.save)**, **bulk operations (insertMany, bulkWrite)**, **transactions**, **error handling with span recording**, and **automatic hook tracing**.

```text
✅ Mongoose instrumented (operations + hooks will be automatically traced)
🚀 Starting Mongoose + Autotel Example
All operations are automatically traced with OpenTelemetry!
✅ Connected to MongoDB: mongodb://localhost:27017/autotel-example

# ═══════════════════════════════════════════════════════════════════════════════
# BASIC CRUD - Model.create() with automatic hook tracing
# ═══════════════════════════════════════════════════════════════════════════════

📝 Creating user: Alice_Example-c8ffa410-cf54-49f2-b880-deace04177d4@yahoo.com
🪝 [user pre-save] normalizing alice_example-c8ffa410-cf54-49f2-b880-deace04177d4@yahoo.com
✓ mongoose.users.pre.save                27ms [mongoose]
     hook.type=pre, hook.operation=save, hook.model=User, db.mongodb.collection=users

🪝 [user post-save] persisted alice_example-c8ffa410-cf54-49f2-b880-deace04177d4@yahoo.com
✓ mongoose.users.post.save               73µs [mongoose]
     hook.type=post, hook.operation=save, hook.model=User, db.mongodb.collection=users

✓ mongoose.users.create                  35ms [mongoose]
     db.system=mongoose, db.operation=create, db.mongodb.collection=users

✅ User created with ID: 6970e2e1b200e3eee674d2e4
📊 Trace ID: 5bc53378d5ac334224e0635506bdf5ef
✓ createUser                             35ms [app]
     user.email=Alice_Example-c8ffa410..., user.name=Alice, operation.name=createUser

# ═══════════════════════════════════════════════════════════════════════════════
# INSTANCE METHOD - doc.save() (vs Model.create())
# ═══════════════════════════════════════════════════════════════════════════════

📝 Creating user with doc.save(): Charlie.Example-da38dcb9-250c-4179-b767-b7df29232a@hotmail.com
🪝 [user pre-save] normalizing charlie.example-da38dcb9-250c-4179-b767-b7df29232a@hotmail.com
✓ mongoose.users.pre.save                25ms [mongoose]
     hook.type=pre, hook.operation=save, hook.model=User

🪝 [user post-save] persisted charlie.example-da38dcb9-250c-4179-b767-b7df29232a@hotmail.com
✓ mongoose.users.post.save               48µs [mongoose]
     hook.type=post, hook.operation=save, hook.model=User

✓ mongoose.users.save                    28ms [mongoose]
     db.system=mongoose, db.operation=save, db.mongodb.collection=users

✅ User created with doc.save(): 6970e2e1b200e3eee674d2e9
✓ createUserWithSave                     28ms [app]
     user.email=Charlie.Example-da38dcb9..., operation.name=createUserWithSave

# ═══════════════════════════════════════════════════════════════════════════════
# CUSTOM STATICS / INSTANCE METHODS / QUERY HELPERS (Automatic)
# Defined in schema.ts with NO trace() calls — wrapped at model compile time.
# Note: a static that returns a Query (findByEmail) becomes the PARENT of the
# underlying operation span (findOne), and call parameters are redacted.
# ═══════════════════════════════════════════════════════════════════════════════

🧩 Exercising custom statics/methods/query helpers for: Alice_Example-dbca4ba6-...@hotmail.com

✓ findOne users                           1ms [autotel-mongoose]
     db.system.name=mongodb, db.operation.name=findOne, db.collection.name=users, db.query.text={"condition":{"email":"A***@***.com"},...
✓ mongoose.User.findByEmail               2ms [autotel-mongoose]
     db.system.name=mongodb, code.function.name=findByEmail, mongoose.method.name=findByEmail, mongoose.method.type=static, mongoose.method.model=User, db.collection.name=users, mongoose.method.parameter_count=1, mongoose.method.parameters=["A***@***.com"]

✓ mongoose.User.describe                 27µs [autotel-mongoose]
     db.system.name=mongodb, code.function.name=describe, mongoose.method.name=describe, mongoose.method.type=instance, mongoose.method.model=User, db.collection.name=users, mongoose.method.parameter_count=0
  👤 describe(): Alice <alice_example-dbca4ba6-...@hotmail.com>

✓ countDocuments users                    2ms [autotel-mongoose]
     db.system.name=mongodb, db.operation.name=countDocuments, db.collection.name=users, db.query.text={"condition":{"email":{}},"options":{}}
✓ mongoose.User.countByDomain             2ms [autotel-mongoose]
     db.system.name=mongodb, code.function.name=countByDomain, mongoose.method.name=countByDomain, mongoose.method.type=static, mongoose.method.model=User, db.collection.name=users, mongoose.method.parameter_count=1, mongoose.method.parameters=["hotmail.com"]
  🔢 countByDomain(hotmail.com): 6

✓ mongoose.User.byEmailDomain            82µs [autotel-mongoose]
     db.system.name=mongodb, code.function.name=byEmailDomain, mongoose.method.name=byEmailDomain, mongoose.method.type=query, mongoose.method.model=User, db.collection.name=users, mongoose.method.parameter_count=1, mongoose.method.parameters=["hotmail.com"]
  🔍 byEmailDomain(hotmail.com) found: 5

✓ demoCustomMethods                        6ms [app]
     search.email=Alice_Example-dbca4ba6-..., search.domain=hotmail.com, operation.name=demoCustomMethods, operation.success=true

# ═══════════════════════════════════════════════════════════════════════════════
# FIND & UPDATE with hooks
# ═══════════════════════════════════════════════════════════════════════════════

✏️  Updating user: 6970e2e1b200e3eee674d2e4
🪝 [user pre-findOneAndUpdate] criteria: { _id: new ObjectId('6970e2e1b200e3eee674d2e4') }
✓ mongoose.users.pre.findOneAndUpdate   210µs [mongoose]
     hook.type=pre, hook.operation=findOneAndUpdate, hook.model=User

🪝 [user post-findOneAndUpdate] updated alice_example-c8ffa410-cf54-49f2-b880-deace04177d4@yahoo.com
✓ mongoose.users.post.findOneAndUpdate    45µs [mongoose]
     hook.type=post, hook.operation=findOneAndUpdate, hook.model=User

✓ mongoose.users.findOneAndUpdate         5ms [mongoose]
     db.system=mongoose, db.operation=findOneAndUpdate, db.mongodb.collection=users

✅ User updated
✓ updateUser                              5ms [app]
     user.id=6970e2e1b200e3eee674d2e4, updates={"name":"Alice Smith"}

# ═══════════════════════════════════════════════════════════════════════════════
# AGGREGATION PIPELINE
# ═══════════════════════════════════════════════════════════════════════════════

📊 Getting user statistics
✓ mongoose.users.aggregate               18ms [mongoose]
     db.system=mongoose, db.operation=aggregate, db.mongodb.collection=users

✅ Retrieved stats for 31 users
✓ getUserStats                           18ms [app]
     operation.name=getUserStats

# ═══════════════════════════════════════════════════════════════════════════════
# BULK OPERATIONS - insertMany & bulkWrite
# ═══════════════════════════════════════════════════════════════════════════════

📦 Bulk creating 3 posts for user 6970e2e1b200e3eee674d2e9
✓ mongoose.posts.insertMany               8ms [mongoose]
     db.system=mongoose, db.operation=insertMany, db.mongodb.collection=posts

✅ Created 3 posts via insertMany
✓ createPostsBulk                         8ms [app]
     user.id=6970e2e1b200e3eee674d2e9, posts.count=3, operation.name=createPostsBulk

📦 Bulk updating 3 posts
✓ mongoose.posts.bulkWrite                7ms [mongoose]
     db.system=mongoose, db.operation=bulkWrite, db.mongodb.collection=posts

✅ Bulk write: 3 modified
✓ bulkUpdatePosts                         8ms [app]
     operations.count=3, operation.name=bulkUpdatePosts

# ═══════════════════════════════════════════════════════════════════════════════
# TRANSACTIONS - with session.withTransaction()
# (requires replica set - graceful fallback for standalone)
# ═══════════════════════════════════════════════════════════════════════════════

# With replica set (port 27019):
🔄 Transferring post 6970e353c0f9c386750fb9fc from 6970e352c0f9c386750fb9f5 to 6970e353c0f9c386750fb9f8
✓ mongoose.posts.findOneAndUpdate         2ms [mongoose]
     db.system=mongoose, db.operation=findOneAndUpdate, db.mongodb.collection=posts

  📝 Post "Getting Started with Mongoose" transferred
✅ Transfer completed in transaction
✓ transferPostOwnership                   6ms [app]
     post.id=..., from.userId=..., to.userId=..., operation.success=true

# With standalone MongoDB (port 27017 - graceful fallback):
🔄 Transferring post 6970e2e1b200e3eee674d2eb from 6970e2e1b200e3eee674d2e4 to 6970e2e1b200e3eee674d2e7
✗ transferPostOwnership                   8ms [app]
     exception.type=MongoServerError, exception.message=Transaction numbers are only allowed on a replica set...

  ℹ️  Transaction skipped: requires MongoDB replica set (standalone mode detected)

# ═══════════════════════════════════════════════════════════════════════════════
# ERROR HANDLING - Errors automatically recorded in spans
# ═══════════════════════════════════════════════════════════════════════════════

🔍 Finding user (with error handling): nonexistent@example.com
✓ mongoose.users.findOne                  6ms [mongoose]
     db.system=mongoose, db.operation=findOne, db.mongodb.collection=users

❌ Error recorded in span: User not found: nonexistent@example.com
✗ findUserOrFail                          6ms [app]
     search.email=nonexistent@example.com, operation.name=findUserOrFail
     operation.success=false, error=true
     exception.type=Error, exception.message=User not found: nonexistent@example.com
     Error: User not found: nonexistent@example.com

  ℹ️  Error was captured in span (expected behavior)

# ═══════════════════════════════════════════════════════════════════════════════
# DELETE with post hook
# ═══════════════════════════════════════════════════════════════════════════════

🗑️  Deleting post: 6970e2e1b200e3eee674d2ef
🪝 [post post-deleteOne] post removed
✓ mongoose.posts.post.deleteOne          43µs [mongoose]
     hook.type=post, hook.operation=deleteOne, hook.model=Post

✓ mongoose.posts.deleteOne                1ms [mongoose]
     db.system=mongoose, db.operation=deleteOne, db.mongodb.collection=posts

✅ Post deleted
✓ deletePost                              1ms [app]
     post.id=6970e2e1b200e3eee674d2ef, operation.name=deletePost

# ═══════════════════════════════════════════════════════════════════════════════
# PARENT SPAN - All operations nested under runScenario
# ═══════════════════════════════════════════════════════════════════════════════

✓ runScenario                           210ms [app]
     scenario.name=mongoose-demo, scenario.runId=87dc5a3d-c313-48e7-8d68-58265c62b1a0

✅ Example completed successfully!
📊 Check your observability backend for traces
👋 Disconnected from MongoDB
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
  instrumentHooks: true,
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

### Automatic Custom-Function Spans

Statics, instance methods, and query helpers are wrapped automatically. Call
parameters are captured and redacted by default:

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

### Parent-Child Relationships

Hooks are automatically nested under their parent operation, and a custom static
that returns a Query becomes the parent of the underlying operation span:

```
createUser (custom span)
└─ mongoose.users.create (operation span)
   ├─ mongoose.users.pre.save (hook span)
   └─ mongoose.users.post.save (hook span)

demoCustomMethods (custom span)
└─ mongoose.User.findByEmail (custom static span)
   └─ findOne users (operation span)
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

  // Trace user-defined statics/methods/query helpers (default: true).
  // Scope it down for privacy/compliance — anything not disabled stays on:
  customMethods: {
    statics: { exclude: ['chargeCard'] }, // opt-out specific statics
    methods: ['describe'], //               opt-in: only these instance methods
    query: false, //                        no query helpers
    captureParameters: false, //            trace calls without serializing args
  },
  // Or disable entirely: customMethods: false
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
MONGOOSE_EXAMPLE_MONGO_URL=mongodb://db.example.com:27017/production
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

MongoDB will be available at `mongodb://localhost:27017` (default port), and this example uses the database `autotel-example` by default.

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
