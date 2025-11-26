# Postgres + Autotel Example

This example shows how to pair the official [`@opentelemetry/instrumentation-pg`](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/plugins/node/instrumentation-pg) package with [autotel](../../packages/autotel/README.md) to capture spans for Postgres clients that use the widely adopted `pg` driver.

## Key Pattern: Official Instrumentation + `--import` bootstrap

- ✅ Loads instrumentation **before** your app with the standard `--import` flag
- ✅ Keeps your application code 100% static-import friendly
- ✅ Emits spans for both `pg.connect` and every `pg.query` (including parameterized SQL)
- ✅ Mirrors the same structure used by other OpenTelemetry examples in this repo

## What Gets Traced

1. **Automatic pg spans** from the official instrumentation:
   - `pg.connect` spans with `db.system=postgresql`
   - `pg.query` spans that include SQL text and bound parameters (when `enhancedDatabaseReporting` is enabled)
   - Connection attributes such as host, port, user, and database name
2. **Manual traces (optional)**:
   - Wrap app-specific logic with `trace()` if you need additional context around Postgres operations

## Quick Start

```bash
# Install dependencies
pnpm install

# (optional) start the dockerized Postgres that the repo uses elsewhere
pnpm docker:up

# Run the instrumented sample
pnpm start
```

The script runs `tsx --import ./src/instrumentation.mjs src/index.ts`, which ensures instrumentation is registered before `pg` loads.

## How It Works

### 1. Separate Instrumentation File

`src/instrumentation.mjs` initializes autotel and the official pg instrumentation before anything else:

```javascript
import { init } from 'autotel';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

init({
  service: 'example-pg',
  debug: true,
  instrumentations: [
    new PgInstrumentation({
      enhancedDatabaseReporting: true,
    }),
  ],
});
```

### 2. Static Imports in the App

Because instrumentation loads first, `src/index.ts` can use normal static imports:

```typescript
import pg from 'pg';

const client = new pg.Client({ connectionString });
await client.connect();
await client.query('SELECT NOW()');
await client.query('SELECT $1::text as message', ['Hello from autotel!']);
```

The instrumentation automatically wraps every `connect` and `query` call emitted by the `pg` client.

### 3. Flush and Shutdown

After the sample queries, the app calls `shutdown()` from autotel to flush spans before exiting, ensuring your OTLP exporter receives the captured data.

## Running Under CommonJS

Need to verify the loader approach for CJS? Use `src/test-cjs.cjs`:

```bash
node src/test-cjs.cjs
```

This script demonstrates that you can `require()` instrumentation **before** `pg` in a CommonJS environment and still get the same spans—no experimental loaders required.

## Production Notes

- Set env vars such as `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, and exporter headers instead of hardcoding them. Autotel automatically reads these values.
- Disable `debug: true` in production to avoid verbose console logs.
- Consider lowering data volume by turning off `enhancedDatabaseReporting` if you do not need bound parameter values in spans.

## See Also

- [`apps/example-mongoose`](../example-mongoose/README.md) – similar pattern for MongoDB
- [autotel documentation](../../packages/autotel/README.md)
- [Official pg instrumentation](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/plugins/node/instrumentation-pg)
- [OpenTelemetry JS instrumentation guide](https://opentelemetry.io/docs/languages/js/instrumentation/)
