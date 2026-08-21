# Autotel Drizzle

OpenTelemetry instrumentation for Drizzle ORM.

## Compatibility

- **Requires `drizzle-orm >= 0.45.2`** (declared as a peer dependency).
- Node runtime only. For Drizzle running on Cloudflare D1 in a Worker, instrument the binding directly via `autotel-cloudflare/bindings`'s `instrumentD1` instead.

If you are pinned to an older Drizzle (for example 0.38.x):

- npm/pnpm will warn on install but the package will still resolve; the public callable surface (`instrumentDrizzleClient`, `instrumentDrizzle`) targets shapes that exist on 0.45+ and may misbehave on older versions.
- Either upgrade Drizzle, or skip this package and emit spans manually around your queries with `span()` from `autotel` (see the [autotel README](../autotel#span)).
- A backport is not currently planned: track the version in `package.json`.

## Philosophy

**autotel-drizzle only includes instrumentation for Drizzle ORM.**

1. **Has NO official OpenTelemetry package** (e.g., Drizzle ORM).

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

- **PostgreSQL** → [`@opentelemetry/instrumentation-pg`](https://www.npmjs.com/package/@opentelemetry/instrumentation-pg)
- **MySQL** → [`@opentelemetry/instrumentation-mysql2`](https://www.npmjs.com/package/@opentelemetry/instrumentation-mysql2)
- **SQLite** → [`@opentelemetry/instrumentation-sqlite`](https://www.npmjs.com/package/@opentelemetry/instrumentation-sqlite)

## Installation

Install the package and **autotel**:

```bash
npm install autotel autotel-drizzle
```

### Drizzle ORM

Instrument Drizzle database operations with OpenTelemetry tracing. Drizzle doesn't have official instrumentation, so we provide it here.

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { instrumentDrizzleClient } from 'autotel-drizzle';

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
  explain?: 'plan' | 'analyze' | false // Capture the postgres query plan (default: false)
}
```

**Span Attributes:**

- `db.system` - Database type (postgresql, mysql, sqlite)
- `db.operation` - Operation name (SELECT, INSERT, UPDATE, DELETE)
- `db.name` - Database name
- `db.statement` - SQL query text (if `captureQueryText: true`)
- `db.statement.hash` - Stable hash of the statement, present even when the text is suppressed
- `net.peer.name` - Database host
- `net.peer.port` - Database port

## Drivers

Tested against postgres 16, mysql 8, and sqlite, driving each through drizzle's
own query builder, its relational API, and raw `db.execute`. Every driver below
emits one span per query, names the operation, and tags `db.collection.name`.

| Driver | Queries | Transaction span | Query plans |
| --- | --- | --- | --- |
| `node-postgres` | yes | yes | yes |
| `postgres.js` | yes | yes | yes |
| `pglite` | yes | yes | yes |
| `mysql2` | yes | yes | postgres only |
| `better-sqlite3` | yes | yes, synchronous | postgres only |
| `libsql` | yes | yes | postgres only |

Nothing about the instrumentation is dialect-specific except `explain`, which
sends postgres syntax and so turns itself off unless `dbSystem` is
`'postgresql'`. Table names are read from double-quoted, backtick-quoted, and
unquoted identifiers alike, so mysql groups by table the same way postgres does.

better-sqlite3 runs transactions synchronously and rejects a callback that
returns a promise. That is the driver's own rule and applies with or without
instrumentation; the wrapper keeps synchronous calls synchronous so those
transactions still commit.

## Query Plans

A span records what you asked postgres for. It does not record what postgres
did. Add an index and `db.statement` is unchanged, byte for byte, with the same
`db.statement.hash`; the duration moves and nothing on the span says why.

`explain` puts the planner's answer on the span:

```typescript
instrumentDrizzleClient(db, {
  dbSystem: 'postgresql',
  explain: 'analyze', // or 'plan' to plan without executing
});
```

The same query, before and after `CREATE INDEX`:

| Attribute | Before | After |
| --- | --- | --- |
| `db.statement.hash` | `372269a8881e921a` | `372269a8881e921a` |
| `db.plan.hash` | `0b50591ce9f68f51` | `eb8765b8d1c4af5a` |
| `db.plan.node` | `Seq Scan` | `Bitmap Heap Scan` |
| `db.plan.indexes` | | `idx_comments_post_id` |
| `db.plan.seq_scan` | `true` | `false` |
| `db.plan.rows_examined` | `200199` | `1001` |
| `db.plan.rows_returned` | `1001` | `1001` |
| `db.plan.blocks` | `1861` | `1005` |
| `db.plan.cost` | | planner's total cost estimate |
| `db.plan.rows_estimated` | | rows the planner expected |
| `db.plan.execution_ms` | | measured time (`'analyze'` only) |

An unchanged statement hash beside a changed plan hash is a planner decision.
Grouping `db.plan.indexes` by `db.statement.hash` answers which queries an index
is serving.

`rows_examined` counts at the leaves of the plan, and counts the rows a scan
read and discarded. A parent node reports the rows its children handed up, so
summing every level counts one row per level; and the rows an index saves you
from reading never appear in the rows the query returns. `blocks` counts cached
and disk reads together, because a scan that walks a table already in memory
still walked the table.

### Cost and safety

Both modes add a round trip per query, and `'analyze'` executes the statement a
second time to measure it. Both are off by default. Use them in development, in
CI, or behind a sample of production traffic.

- `'analyze'` runs on read-only statements only, so a traced insert never runs
  twice. A leading `WITH` qualifies only when no writing keyword appears
  anywhere in the statement, because `WITH gone AS (DELETE ... RETURNING *)
  SELECT` opens exactly like a read.
- The plan is collected before the span opens, so the extra round trip stays out
  of the duration the span reports.
- A failed `EXPLAIN` is swallowed. The query still runs and still gets its span.
- Ignored unless `dbSystem` is `'postgresql'`.
- Inside a transaction the plan is taken on the transaction's own connection, so
  it sees the rows the query will see.

## Security Considerations

### Query Text Capture

By default, Drizzle instrumentation captures SQL text which may contain sensitive data:

```typescript
// Disable SQL capture to prevent PII leakage
instrumentDrizzleClient(db, {
  captureQueryText: false,
});
```

## See also

- [autotel](../autotel): Node SDK that this package builds on
- [autotel-cloudflare](../autotel-cloudflare): instrument D1 directly when running Drizzle on Workers
- [autotel-edge](../autotel-edge): vendor-agnostic edge foundation

## License

Apache-2.0
