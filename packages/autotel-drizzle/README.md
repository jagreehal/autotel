# Autotel Drizzle

OpenTelemetry instrumentation for Drizzle ORM.

## Compatibility

- **Requires `drizzle-orm >= 0.45.2`** (declared as a peer dependency).
- Node runtime only. For Drizzle running on Cloudflare D1 in a Worker, instrument the binding directly via `autotel-cloudflare/bindings`'s `instrumentD1` instead.

If you are pinned to an older Drizzle (for example 0.38.x):

- npm/pnpm will warn on install but the package will still resolve; the public callable surface (`instrumentDrizzleClient`, `instrumentDrizzle`) targets shapes that exist on 0.45+ and may misbehave on older versions.
- Either upgrade Drizzle, or skip this package and emit spans manually around your queries with `span()` from `autotel` (see the [autotel README](../autotel#span)).
- A backport is not currently planned — track the version in `package.json`.

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
}
```

**Span Attributes:**

- `db.system` - Database type (postgresql, mysql, sqlite)
- `db.operation` - Operation name (SELECT, INSERT, UPDATE, DELETE)
- `db.name` - Database name
- `db.statement` - SQL query text (if `captureQueryText: true`)
- `net.peer.name` - Database host
- `net.peer.port` - Database port

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

- [autotel](../autotel) — Node SDK that this package builds on
- [autotel-cloudflare](../autotel-cloudflare) — instrument D1 directly when running Drizzle on Workers
- [autotel-edge](../autotel-edge) — vendor-agnostic edge foundation

## License

MIT
