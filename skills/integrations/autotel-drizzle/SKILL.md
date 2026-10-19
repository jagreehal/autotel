---
name: autotel-drizzle
description: >
  Use this skill when adding OpenTelemetry tracing to a Drizzle ORM database instance — the only autotel instrumentation package needed for Drizzle, since no official OTel package exists for it.
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
  explain?: 'plan' | 'analyze' | false; // Postgres query plan on each span (default: false)
  semconv?: 'legacy' | 'stable' | 'dup'; // Attribute names (default: from OTEL_SEMCONV_STABILITY_OPT_IN, else 'legacy')
  spanNaming?: 'drizzle' | 'semconv'; // 'drizzle.select' vs 'SELECT comments' (default: 'drizzle')
  traceTransactions?: boolean; // Span around each db.transaction() callback (default: true)
  tracerProvider?: TracerProvider; // Default: the global provider
}
```

### Span attributes set on every span

Legacy names shown; `semconv: 'stable'` emits the stable name instead, `'dup'` emits both.

| Attribute (legacy / stable)          | Source                                                           |
| ------------------------------------ | ---------------------------------------------------------------- |
| `db.system` / `db.system.name`       | `config.dbSystem` (default: `'postgresql'`)                      |
| `db.operation` / `db.operation.name` | SQL keyword extracted from query text (e.g., `SELECT`, `INSERT`) |
| `db.name` / `db.namespace`           | `config.dbName` (if set)                                         |
| `db.statement` / `db.query.text`     | Sanitised, truncated SQL text (if `captureQueryText: true`)      |
| `db.collection.name`                 | First table the statement touches (if parsed)                    |
| `net.peer.name`                      | `config.peerName` (if set)                                       |
| `net.peer.port`                      | `config.peerPort` (if set)                                       |

Span names follow the pattern `drizzle.<operation>` (e.g., `drizzle.select`, `drizzle.insert`) or `drizzle.query` when the operation cannot be determined. With `spanNaming: 'semconv'` they become `{operation} {table}`, e.g. `SELECT comments`.

Every query span also carries `db.statement.hash`, even when text capture is off, so repeated statements group.

### Query plans (Postgres)

```typescript
instrumentDrizzleClient(db, { dbSystem: 'postgresql', explain: 'plan' });
```

Spans gain `db.plan.*` from `autotel-db`: `stages`, `full_scan` (a `Seq Scan`), `blocking_sort`, `indexes`, `cost`, `rows_estimated`, and with `'analyze'` `rows_examined`, `rows_returned` and `execution_ms`. `db.plan.status` records `captured`, `failed` (sanitised reason in `db.plan.error`) or `unsupported` (DDL, other dialects).

- `'analyze'` executes reads only; writes are planned with plain `EXPLAIN`.
- Inside `db.transaction()` statements run exactly as without instrumentation. With `drizzle(pool)` the plan comes from a separate pooled connection, rolled back, with a lock timeout; with `drizzle(client)` those statements record `unsupported`.
- Use it in development, CI, or on a sample of traffic: it adds a round trip per query.

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
- Prepared queries (`prepareQuery`): all execution methods: `all`, `execute`, `get`, `run`, `values`
- Transactions: a `drizzle.transaction` span wraps the callback (unless `traceTransactions: false`); statements inside it carry `db.transaction: true`

### Idempotency

Both functions are idempotent. Calling them more than once on the same instance is safe; the `__autotelDrizzleInstrumented` flag prevents double-wrapping.

## Common Mistakes

### HIGH: Calling `instrumentDrizzleClient` after queries have already run

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

### HIGH: Using autotel-drizzle for databases that have official OTel packages

```typescript
// Wrong: autotel-drizzle is for Drizzle, not for pg directly
import { instrumentDrizzle } from 'autotel-drizzle';
instrumentDrizzle(pgPool); // unnecessary if you're not using Drizzle

// Correct: use the official package for pg
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
init({ instrumentations: [new PgInstrumentation()] });
```

For PostgreSQL (`pg`/`postgres`), MySQL (`mysql2`), SQLite, MongoDB, and Redis, official OTel instrumentation packages exist and should be preferred.

### MEDIUM: Not setting `dbSystem` for non-PostgreSQL databases

```typescript
// Wrong: dbSystem defaults to 'postgresql' even for SQLite
instrumentDrizzleClient(sqliteDb);

// Correct: set dbSystem to match the actual database
instrumentDrizzleClient(sqliteDb, { dbSystem: 'sqlite' });
```

The `db.system` span attribute will be wrong if the default is not overridden.

### MEDIUM: Passing `captureQueryText: true` without reviewing SQL for PII

SQL statements built by Drizzle may embed user-supplied values (e.g., email addresses in `WHERE` clauses). Either disable capture or review what Drizzle sends before enabling in production.

## Version

Targets autotel-drizzle v0.3.6 with drizzle-orm >= 0.45.4 (peer dep). Requires autotel as a dependency.
