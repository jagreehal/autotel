# BigQuery Plugin for Autotel

OpenTelemetry instrumentation for Google Cloud BigQuery. This plugin provides comprehensive tracing for all BigQuery operations with support for query sanitization, job tracking, and flexible configuration.

## Installation

```bash
npm install autotel-plugins @google-cloud/bigquery
# or
yarn add autotel-plugins @google-cloud/bigquery
# or
pnpm add autotel-plugins @google-cloud/bigquery
```

Note: `@google-cloud/bigquery` is an optional peer dependency. The plugin will only activate when BigQuery is present in your project.

## Quick Start

```typescript
import { BigQuery } from '@google-cloud/bigquery';
import { init } from 'autotel';
import { instrumentBigQuery } from 'autotel-plugins/bigquery';

// Initialize autotel first
init({ service: 'my-service' });

// Create BigQuery client
const bigquery = new BigQuery({
  projectId: 'my-project',
  location: 'US',
});

// Instrument it - all subsequent operations are traced
instrumentBigQuery(bigquery);

// Use BigQuery normally - spans are created automatically
const [rows] = await bigquery.query('SELECT * FROM my_dataset.users');
```

## How It Works

The plugin uses **runtime patching** (not module hooks) to instrument BigQuery operations. This approach:

- ✅ Works with ESM and CommonJS
- ✅ No build step required
- ✅ Idempotent - safe to call multiple times
- ✅ Minimal overhead

When you call `instrumentBigQuery()`, the plugin wraps methods on:

- `BigQuery` class (query, createQueryJob)
- `Table` class (insert, getRows, load, copy, extract)
- `Job` class (getQueryResults)
- `Dataset` class (create, delete - optional)

Each wrapped method creates an OpenTelemetry span with:

- Operation type (SELECT, INSERT, LOAD, etc.)
- Target table/dataset information
- Project and location metadata
- Query text (configurable sanitization)
- Row counts
- Job IDs for async operations

## Configuration

```typescript
import { instrumentBigQuery } from 'autotel-plugins/bigquery';

instrumentBigQuery(bigquery, {
  // Custom tracer name (default: "autotel-plugins/bigquery")
  tracerName: 'my-tracer',

  // GCP Project ID (auto-detected from BigQuery instance if not provided)
  projectId: 'my-project',

  // Default location (auto-detected if not provided)
  location: 'US',

  // Query text capture mode (default: "summary")
  // - "never": Don't capture query text
  // - "summary": Low-cardinality summary (e.g., "SELECT users")
  // - "sanitized": Replace literals with ? placeholders
  // - "raw": Full query text (not recommended for production)
  captureQueryText: 'sanitized',

  // Max query text length (default: 1000)
  maxQueryTextLength: 2000,

  // Include query hash for exact matching (default: true)
  includeQueryHash: true,

  // Instrument admin operations (default: false)
  // When enabled, traces dataset/table create/delete operations
  instrumentAdminOps: false,
});
```

## Usage Examples

### Basic Query

```typescript
const bigquery = new BigQuery();
instrumentBigQuery(bigquery);

// Creates span: "SELECT my_dataset.users"
const [rows] = await bigquery.query(
  'SELECT * FROM my_dataset.users WHERE age > 18',
);
```

### Parameterized Queries

```typescript
// With sanitized mode, literals are replaced with ?
// Query: "SELECT * FROM users WHERE id = 123"
// Span attribute: "SELECT * FROM users WHERE id = ?"
const [rows] = await bigquery.query({
  query: 'SELECT * FROM users WHERE id = @id',
  params: { id: 123 },
});
```

### Streaming Inserts

```typescript
const dataset = bigquery.dataset('my_dataset');
const table = dataset.table('my_table');

// Creates span: "INSERT my_dataset.my_table"
// Includes row count attribute
await table.insert([
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
]);
```

### Batch Loads

```typescript
// Creates span: "LOAD my_dataset.my_table"
const [job] = await table.createLoadJob('gs://bucket/data.csv', {
  sourceFormat: 'CSV',
});

// Job ID captured in span attributes
console.log(job.id); // e.g., "load-job-abc123"
```

### Copy and Extract

```typescript
// Copy table
const [copyJob] = await sourceTable.createCopyJob(destTable);

// Extract to GCS
const [extractJob] = await table.createExtractJob('gs://bucket/output.csv', {
  destinationFormat: 'CSV',
});
```

### Async Queries with Job Tracking

```typescript
// Creates query job (span: "SELECT_JOB ...")
const [job] = await bigquery.createQueryJob({
  query: 'SELECT * FROM large_table',
  destination: dataset.table('results'),
});

// Wait for completion and get results
// Creates span: "GET_QUERY_RESULTS" with job ID attribute
const [rows] = await job.getQueryResults();
```

## Semantic Conventions

This plugin follows OpenTelemetry semantic conventions for databases:

### Standard Attributes

| Attribute            | Value               | Description                                 |
| -------------------- | ------------------- | ------------------------------------------- |
| `db.system.name`     | `"gcp.bigquery"`    | Database system identifier                  |
| `db.operation.name`  | `"SELECT"`          | Operation type (SELECT, INSERT, LOAD, etc.) |
| `db.query.summary`   | `"SELECT users"`    | Low-cardinality query summary               |
| `db.query.text`      | `"SELECT * FROM ?"` | Query text (sanitized or raw)               |
| `db.namespace`       | `"my_dataset"`      | Dataset ID                                  |
| `db.collection.name` | `"my_table"`        | Table ID                                    |

### BigQuery-Specific Attributes

| Attribute                        | Example           | Description                    |
| -------------------------------- | ----------------- | ------------------------------ |
| `gcp.bigquery.job.id`            | `"job-abc123"`    | BigQuery job identifier        |
| `gcp.bigquery.job.location`      | `"US"`            | Job processing location        |
| `gcp.bigquery.project.id`        | `"my-project"`    | GCP project ID                 |
| `gcp.bigquery.destination.table` | `"dataset.table"` | Destination for loads/queries  |
| `gcp.bigquery.query.hash`        | `"abc123"`        | Query fingerprint for matching |
| `gcp.bigquery.rows.affected`     | `100`             | Rows inserted/loaded           |
| `gcp.bigquery.rows.returned`     | `50`              | Rows returned from query       |

### Span Names

Span names follow the pattern `{operation} {target}`:

- `SELECT my_dataset.users` - Query operations
- `INSERT my_dataset.events` - Streaming inserts
- `LOAD my_dataset.imports` - Batch loads
- `COPY source_dataset.table` - Table copies
- `EXTRACT my_dataset.exports` - Data extracts
- `GET_QUERY_RESULTS` - Result retrieval

## Security & Privacy

### Query Sanitization

By default, the plugin captures only a **summary** of queries (low cardinality). You can configure this:

```typescript
// Safest - no query text
instrumentBigQuery(bigquery, { captureQueryText: 'never' });

// Default - summary only
instrumentBigQuery(bigquery, { captureQueryText: 'summary' });

// Sanitized - literals replaced with ?
instrumentBigQuery(bigquery, { captureQueryText: 'sanitized' });

// Full text - NOT recommended for production (may contain PII)
instrumentBigQuery(bigquery, { captureQueryText: 'raw' });
```

The **sanitized** mode replaces:

- String literals: `'secret'` → `'?'`
- Numbers: `123` → `?`
- Booleans: `true` → `?`
- NULL values: `NULL` → `?`

### Query Hashing

Enable query hashing to identify identical queries without storing the text:

```typescript
instrumentBigQuery(bigquery, {
  captureQueryText: 'never', // Don't store text
  includeQueryHash: true, // But include hash for grouping
});
```

## Advanced Usage

### Conditional Instrumentation

```typescript
// Only in production
if (process.env.NODE_ENV === 'production') {
  instrumentBigQuery(bigquery, {
    captureQueryText: 'sanitized',
    includeQueryHash: true,
  });
}
```

### Admin Operations

```typescript
// Also trace dataset/table lifecycle
instrumentBigQuery(bigquery, {
  instrumentAdminOps: true,
});

// Now these create spans:
await dataset.create(); // "CREATE_DATASET my_dataset"
await table.create(); // "CREATE_TABLE my_dataset.my_table"
await table.delete(); // "DELETE_TABLE my_dataset.my_table"
```

### Custom Attributes

You can add custom attributes to spans using OpenTelemetry APIs:

```typescript
import { context, trace } from '@opentelemetry/api';

const span = trace.getActiveSpan();
if (span) {
  span.setAttribute('custom.attribute', 'value');
}
```

## Troubleshooting

### "Property X does not exist on type Y"

The plugin uses TypeScript type definitions from `@google-cloud/bigquery`. If you see type errors, ensure the package is installed:

```bash
npm install --save-dev @types/node
```

### Double Instrumentation

The plugin is idempotent - calling `instrumentBigQuery()` multiple times is safe. However, if you see duplicate spans:

```typescript
// Check if already instrumented
if (!(bigquery as any).__autotelBigQueryInstrumented) {
  instrumentBigQuery(bigquery);
}
```

### Missing Spans

If spans aren't appearing:

1. Ensure `init()` from `autotel` is called before instrumentation
2. Check that your exporter is configured correctly
3. Verify the BigQuery client is instrumented before use

## Gaps vs @google-cloud/bigquery

Compared to the [nodejs-bigquery](https://github.com/googleapis/nodejs-bigquery) client, the following operations are **not** currently instrumented:

| API          | Method                                     | Notes                                                                   |
| ------------ | ------------------------------------------ | ----------------------------------------------------------------------- |
| **BigQuery** | `createDataset(id, options)`               | Create dataset at client level (we only instrument `dataset.create()`). |
| **BigQuery** | `getDatasets` / `getDatasetsStream`        | List datasets.                                                          |
| **BigQuery** | `getJobs` / `getJobsStream`                | List jobs.                                                              |
| **BigQuery** | `createQueryStream`                        | Streaming query (stream creation).                                      |
| **BigQuery** | `createJob`                                | Generic job creation (low-level; query/load/copy/extract use it).       |
| **Job**      | `get` (getMetadata)                        | Get job metadata.                                                       |
| **Job**      | `delete`                                   | Delete job.                                                             |
| **Job**      | `cancel`                                   | Cancel job.                                                             |
| **Table**    | `createCopyFromJob`                        | Copy from source table(s) (we instrument `createCopyJob` only).         |
| **Table**    | `createReadStream`                         | Streaming read.                                                         |
| **Table**    | `createWriteStream` / `createInsertStream` | Streaming insert.                                                       |
| **Dataset**  | `getTables` / `getTablesStream`            | List tables.                                                            |
| **Dataset**  | `getModels` / `getModelsStream`            | List models (optional via `instrumentBqmlOps`).                         |
| **Dataset**  | `createRoutine` / routine ops              | Routines (optional via `instrumentRoutineOps`).                         |

Adding instrumentation for **BigQuery.createDataset** (when `instrumentAdminOps` is true) is recommended so that `bigquery.createDataset('id')` is traced like `dataset.create()`.

## Testing

The plugin includes comprehensive tests. To run them:

```bash
cd packages/autotel-plugins
pnpm test
```

Tests use mock BigQuery classes to verify instrumentation without requiring real BigQuery access.

## Contributing

This plugin is part of the [autotel](https://github.com/jagreehal/autotel) monorepo. See the main repository for contribution guidelines.

## License

MIT - see [LICENSE](../../LICENSE) for details.
