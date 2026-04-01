---
name: autotel-drizzle
description: >
  Use this skill when adding OpenTelemetry tracing to a Drizzle ORM database instance — the only autotel instrumentation package needed for Drizzle, since no official OTel package exists for it.
type: integration
library: autotel-drizzle
library_version: '0.0.3'
sources:
  - jagreehal/autotel:packages/autotel-drizzle/README.md
---

# autotel-drizzle

OpenTelemetry instrumentation for Drizzle ORM. Drizzle has no official OTel package, so this package fills that gap by patching the Drizzle session and client at runtime to create spans for every query, prepared statement, and transaction.

**Only use this package for Drizzle.** For databases with working official instrumentation (PostgreSQL via `pg`, MySQL via `mysql2`, SQLite, Redis, MongoDB, Kafka), use the official `@opentelemetry/instrumentation-*` packages directly with the `--import` pattern instead.

## Setup

```bash
npm install autotel autotel-drizzle
```

```typescript
// src/instrumentation.mts
import 'autotel/register';
import { init } from 'autotel';

init({ service: 'my-app' });
```

```bash
node --import ./src/instrumentation.mts dist/index.js
```

## Core Patterns

### Instrument a Drizzle database instance (recommended)

`instrumentDrizzleClient` patches the Drizzle `db` object returned by `drizzle()`. This is the primary API for most use cases.

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { instrumentDrizzleClient } from 'autotel-drizzle';

const queryClient = postgres(process.env.DATABASE_URL!);
const db = drizzle({ client: queryClient });

instrumentDrizzleClient(db, {
  dbSystem: 'postgresql',
  dbName: 'myapp',
  peerName: 'db.example.com',
  peerPort: 5432,
});

// All queries, prepared statements, and transactions are now traced
await db.select().from(users).where(eq(users.id, 123));
```

### Instrument a raw database client/pool

`instrumentDrizzle` patches a lower-level client object (e.g., a `pg.Pool`). Use this when you have the raw client but not a Drizzle instance.

```typescript
import { Pool } from 'pg';
import { instrumentDrizzle } from 'autotel-drizzle';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
instrumentDrizzle(pool, { dbSystem: 'postgresql', dbName: 'myapp' });
```

### Configuration reference (`InstrumentDrizzleConfig`)

```typescript
interface InstrumentDrizzleConfig {
  tracerName?: string; // Default: 'autotel-plugins/drizzle'
  dbSystem?: string; // Default: 'postgresql'. Also: 'mysql', 'sqlite'
  dbName?: string; // Sets db.name on every span
  captureQueryText?: boolean; // Capture SQL text in db.statement (default: true)
  maxQueryTextLength?: number; // Truncate SQL at this length (default: 1000)
  peerName?: string; // Sets net.peer.name
  peerPort?: number; // Sets net.peer.port
}
```

### Span attributes set on every span

| Attribute       | Source                                                           |
| --------------- | ---------------------------------------------------------------- |
| `db.system`     | `config.dbSystem` (default: `'postgresql'`)                      |
| `db.operation`  | SQL keyword extracted from query text (e.g., `SELECT`, `INSERT`) |
| `db.name`       | `config.dbName` (if set)                                         |
| `db.statement`  | Truncated SQL text (if `captureQueryText: true`)                 |
| `net.peer.name` | `config.peerName` (if set)                                       |
| `net.peer.port` | `config.peerPort` (if set)                                       |

Span names follow the pattern `drizzle.<operation>` (e.g., `drizzle.select`, `drizzle.insert`) or `drizzle.query` when the operation cannot be determined.

### Disabling SQL capture (PII safety)

```typescript
instrumentDrizzleClient(db, {
  captureQueryText: false,
});
```

SQL text may contain user-supplied values. Disable capture or truncate aggressively when PII is a concern.

### Supported databases

- PostgreSQL (`drizzle-orm/node-postgres`, `drizzle-orm/postgres-js`)
- MySQL (`drizzle-orm/mysql2`)
- SQLite (`drizzle-orm/better-sqlite3`, `drizzle-orm/libsql`)

### What is instrumented

- Session `query()` and `execute()` methods
- Prepared queries (`prepareQuery`) — all execution methods: `all`, `execute`, `get`, `run`, `values`
- Transactions — the callback receives an already-instrumented transaction object, spans carry `db.transaction: true`

### Idempotency

Both functions are idempotent. Calling them more than once on the same instance is safe; the `__autotelDrizzleInstrumented` flag prevents double-wrapping.

### Using semantic convention exports

The package re-exports OTel semconv constants for use in custom instrumentation:

```typescript
import {
  SEMATTRS_DB_SYSTEM,
  SEMATTRS_DB_STATEMENT,
  SEMATTRS_DB_OPERATION,
} from 'autotel-drizzle';
```

## Common Mistakes

### HIGH — Calling `instrumentDrizzleClient` after queries have already run

```typescript
// Wrong: some early queries miss instrumentation
const db = drizzle({ client });
await db.select().from(users); // not instrumented

instrumentDrizzleClient(db);

// Correct: instrument immediately after creating the db instance
const db = drizzle({ client });
instrumentDrizzleClient(db, { dbSystem: 'postgresql' });

await db.select().from(users); // instrumented
```

Patching works by mutating method references on the live object. Any query that ran before patching has no span.

### HIGH — Using autotel-drizzle for databases that have official OTel packages

```typescript
// Wrong: autotel-drizzle is for Drizzle, not for pg directly
import { instrumentDrizzle } from 'autotel-drizzle';
instrumentDrizzle(pgPool); // unnecessary if you're not using Drizzle

// Correct: use the official package for pg
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
init({ instrumentations: [new PgInstrumentation()] });
```

For PostgreSQL (`pg`/`postgres`), MySQL (`mysql2`), SQLite, MongoDB, and Redis, official OTel instrumentation packages exist and should be preferred.

### MEDIUM — Not setting `dbSystem` for non-PostgreSQL databases

```typescript
// Wrong: dbSystem defaults to 'postgresql' even for SQLite
instrumentDrizzleClient(sqliteDb);

// Correct: set dbSystem to match the actual database
instrumentDrizzleClient(sqliteDb, { dbSystem: 'sqlite' });
```

The `db.system` span attribute will be wrong if the default is not overridden.

### MEDIUM — Passing `captureQueryText: true` without reviewing SQL for PII

SQL statements built by Drizzle may embed user-supplied values (e.g., email addresses in `WHERE` clauses). Either disable capture or review what Drizzle sends before enabling in production.

## Version

Targets autotel-drizzle v0.0.3 with drizzle-orm >= 0.45.1 (peer dep). Requires autotel as a dependency.
