# example-sentry

Demonstrates Autotel exporting OpenTelemetry traces and pino logs to Sentry's OTLP ingestion endpoint, with captured errors landing on the active trace.

## How it works

```
Autotel (OTel SDK) ──OTLP──> Sentry (traces + pino logs)
Sentry SDK ─────────────────> Sentry (errors, on the active trace)
```

1. `sentryOtlpConfig(dsn)` parses your Sentry DSN into an OTLP endpoint and auth headers
2. Sentry SDK is initialized with `skipOpenTelemetrySetup: true` so Autotel owns the OTel setup
3. `Sentry.setOpenTelemetryContextAsyncContextStrategy()` makes Sentry read the active OTel span, so captured errors carry its `trace_id` and `span_id`
4. Autotel exports traces via OTLP to Sentry's ingestion endpoint
5. Pino is auto-instrumented (`autoInstrumentations: ['pino']`, `logs: true`), so each log line also goes to Sentry as a log on its trace

## Setup

### 1. Create a `.env` file

```bash
cp .env.example .env
```

Then fill in your Sentry DSN:

```env
SENTRY_DSN=https://<public-key>@o<org-id>.ingest.us.sentry.io/<project-id>
```

You can find your DSN in **Sentry > Settings > Projects > [your project] > Client Keys (DSN)**.

### 2. Install dependencies

```bash
pnpm install
```

### 3. Run

```bash
# Basic run: sends a trace with a child span
pnpm start

# With error capture: also sends a linked error to Sentry
THROW_FOR_DEMO=1 pnpm start

# With debug logging
AUTOTEL_DEBUG=1 pnpm start
```

## What you'll see

### Console output

```
{"level":30,"name":"example-sentry","demo":true,"trace_id":"...","span_id":"...","trace_flags":"01","msg":"trace started"}
{"level":30,"name":"example-sentry","source":"mock-api","trace_id":"...","span_id":"...","trace_flags":"01","msg":"data fetched"}
{"level":30,"name":"example-sentry","demo":true,"trace_id":"...","span_id":"...","trace_flags":"01","msg":"trace finished"}
```

### In Sentry

- **Traces**: An `example-sentry-demo` transaction with a `fetch-data` child span
- **Logs**: the three pino lines, each on the trace
- **Errors** (with `THROW_FOR_DEMO=1`): A "Demo error for Sentry" error on the same trace, and the root span marked as failed

## Environment variables

| Variable         | Required | Description                        |
| ---------------- | -------- | ---------------------------------- |
| `SENTRY_DSN`     | Yes      | Sentry project DSN                 |
| `THROW_FOR_DEMO` | No       | Set to `1` to capture a demo error |
| `AUTOTEL_DEBUG`  | No       | Set to `1` for debug logging       |

## Key code

```typescript
import { sentryOtlpConfig } from 'autotel-sentry';

const config = sentryOtlpConfig(process.env.SENTRY_DSN!);

Sentry.init({ dsn: config.dsn, skipOpenTelemetrySetup: true });
Sentry.setOpenTelemetryContextAsyncContextStrategy();
init({
  service: 'example-sentry',
  endpoint: config.endpoint,
  headers: config.headers,
  autoInstrumentations: ['pino'],
  logs: true,
});
```

## References

- [autotel-sentry](../../packages/autotel-sentry): the DSN helper used in this example
- [Sentry OTLP Integration spec](https://develop.sentry.dev/sdk/telemetry/traces/otlp/)
- [Sentry OTLP docs](https://docs.sentry.io/concepts/otlp/)
